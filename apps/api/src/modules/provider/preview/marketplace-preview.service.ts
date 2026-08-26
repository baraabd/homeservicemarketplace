import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { ADMIN_SETTINGS_SCHEMA } from '@homeservicemarketplace/contracts';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PlatformSettingRepository } from '../../../infrastructure/persistence/settings/platform-setting.repository';
import { AppConfigService } from '../../../config/app-config.service';
import {
  PREVIEW_CELL_KM_KEY,
  PREVIEW_ENABLED_KEY,
  PREVIEW_MAX_ITEMS_KEY,
  PREVIEW_PAGE_SIZE_KEY,
  resolvePreviewPolicy,
  type ResolvedPreviewPolicy,
} from './preview-policy';
import { redactForPreview, type PreviewItem, type PreviewSourceRow } from './preview-redaction';

// Sprint 9B.9 — serving the redacted preview.
//
// docs/sprint-09b9/REDACTED_MARKETPLACE_PREVIEW.md
//
// THE SELECT IS THE FIRST LINE OF DEFENCE
//
// The query below names every column it reads, and the sensitive ones are not
// among them: no description, no mediaUrls, no seekerUserId, no addressSnapshot,
// no addressId, no exact locationLat/Lng beyond what the redactor snaps, no bid
// counts. A mapping bug therefore cannot leak them, because they were never
// loaded. Response-shape allowlists are good; not having the data in memory is
// better, and the two together mean two independent mistakes are needed rather
// than one.
//
// (locationLat/locationLng ARE selected, because the redactor needs a point to
// snap. They are consumed inside redactForPreview and never reach the wire —
// asserted by preview-redaction.spec.ts and again at the HTTP boundary.)

export interface PreviewPage {
  items: PreviewItem[];
  /** Opaque offset cursor. Null when the policy's reach is exhausted. */
  nextCursor: string | null;
  /** How many items this preview will EVER show, so the client can say so
   *  honestly rather than implying an endless feed. */
  totalReach: number;
  cellKm: number;
}

/** Off-state, returned rather than thrown: "the preview is not available" is a
 *  normal answer, not an error, and the copy layer needs to render it. */
export const PREVIEW_DISABLED = { disabled: true } as const;

@Injectable()
export class MarketplacePreviewService {
  private readonly log = new Logger(MarketplacePreviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingRepository,
    private readonly config: AppConfigService,
  ) {}

  /** Resolve the policy from the settings rows, failing closed. */
  async policy(): Promise<ResolvedPreviewPolicy> {
    try {
      const [enabled, cellKm, pageSize, maxItems] = await Promise.all([
        this.settings.findByKey(PREVIEW_ENABLED_KEY),
        this.settings.findByKey(PREVIEW_CELL_KM_KEY),
        this.settings.findByKey(PREVIEW_PAGE_SIZE_KEY),
        this.settings.findByKey(PREVIEW_MAX_ITEMS_KEY),
      ]);
      return resolvePreviewPolicy({
        enabled: enabled?.value ?? defaultFor(PREVIEW_ENABLED_KEY),
        cellKm: cellKm?.value ?? defaultFor(PREVIEW_CELL_KM_KEY),
        pageSize: pageSize?.value ?? defaultFor(PREVIEW_PAGE_SIZE_KEY),
        maxItems: maxItems?.value ?? defaultFor(PREVIEW_MAX_ITEMS_KEY),
      });
    } catch (err) {
      // A settings outage disables the preview. Every other reader in this
      // codebase falls back to its default because those limits only refuse;
      // this one discloses, so the failure direction is inverted on purpose.
      this.log.warn({ msg: 'preview.policy.read.failed', err: (err as Error).message });
      return { enabled: false };
    }
  }

  /**
   * One page of the redacted preview.
   *
   * `cursor` is an offset, not a keyset, and that is deliberate: a keyset
   * cursor carries a real row's sort key, which is a piece of the data the
   * preview exists to withhold. An integer offset carries nothing, and the
   * reach cap makes deep paging impossible anyway.
   */
  async page(
    viewerUserId: string,
    input: { cursor?: string | null },
    now = new Date(),
  ): Promise<PreviewPage | typeof PREVIEW_DISABLED> {
    const policy = await this.policy();
    if (!policy.enabled) return PREVIEW_DISABLED;

    const offset = parseOffset(input.cursor);
    // THE ANTI-SCRAPING CEILING. Without it a small page size only slows a
    // harvest instead of bounding it: 200 pages of 10 is still the whole
    // marketplace.
    if (offset >= policy.maxItems) {
      return { items: [], nextCursor: null, totalReach: policy.maxItems, cellKm: policy.cellKm };
    }
    const take = Math.min(policy.pageSize, policy.maxItems - offset);

    const rows = (await this.prisma.client.serviceRequest.findMany({
      where: { status: 'OPEN_FOR_BIDS', deletedAt: null },
      // Named columns only. See the note at the top of this file: what is not
      // selected cannot leak.
      select: {
        id: true,
        categoryId: true,
        scheduleType: true,
        locationCityKey: true,
        locationLat: true,
        locationLng: true,
        createdAt: true,
        category: { select: { slug: true, labelEn: true, labelAr: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take,
    })) as PreviewSourceRow[];

    const salt = this.viewerSalt(viewerUserId);
    const items = rows.map((r) => redactForPreview(r, policy, salt, now));

    const nextOffset = offset + rows.length;
    const nextCursor =
      rows.length === take && nextOffset < policy.maxItems ? String(nextOffset) : null;

    // Audit WITHOUT PII. No user id, no request ids, no coordinates, no city —
    // a log line that recorded which listings a named provider was shown would
    // recreate, in the log store, exactly the correlation the redaction spends
    // its whole effort preventing. What is recorded is the shape of the
    // disclosure and the policy that governed it.
    this.log.log({
      msg: 'marketplace.preview.served',
      items: items.length,
      offset,
      policyFingerprint: policy.fingerprint,
      cellKm: policy.cellKm,
    });

    return { items, nextCursor, totalReach: policy.maxItems, cellKm: policy.cellKm };
  }

  /**
   * A per-viewer salt for the opaque refs.
   *
   * Derived from the server secret and the viewer id, so it is stable for one
   * provider across requests and processes without being stored, and differs
   * between providers so two colluding preview users cannot align what they
   * harvested. The viewer id goes through an HMAC rather than being used
   * directly, so the salt cannot be reversed into a user id if it ever escapes.
   */
  private viewerSalt(viewerUserId: string): string {
    const secret = this.config.get('JWT_ACCESS_SECRET') as unknown as string;
    return createHmac('sha256', String(secret)).update(`preview:${viewerUserId}`).digest('hex');
  }
}

function defaultFor(key: string): unknown {
  return ADMIN_SETTINGS_SCHEMA.find((f) => f.key === key)?.default;
}

/** Offsets only. A non-numeric, negative or absurd cursor restarts at zero
 *  rather than erroring: a malformed cursor is not worth an error surface, and
 *  restarting discloses strictly less than continuing. */
function parseOffset(cursor?: string | null): number {
  if (!cursor) return 0;
  const n = Number(cursor);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 0;
  return n;
}
