import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_SETTINGS_SCHEMA,
  CURRENT_PUBLICATION_ACK_VERSION,
} from '@homeservicemarketplace/contracts';
import type {
  CreateProviderPortfolioItemRequest,
  ProviderPortfolioItem,
  ProviderPortfolioListResponse,
  UpdateProviderPortfolioItemRequest,
} from '@homeservicemarketplace/contracts';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PlatformSettingRepository } from '../../../infrastructure/persistence/settings/platform-setting.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AppConfigService } from '../../../config/app-config.service';
import {
  PORTFOLIO_MAX_FILE_BYTES_KEY,
  PORTFOLIO_MAX_ITEMS_KEY,
  PortfolioPolicyError,
  assertHasRoom,
  assertPublicationRight,
  assertPublishableContentType,
  assertPublishableKey,
  assertWithinFileLimit,
  portfolioOwnerRef,
  resolvePublicationAckText,
  resolveReorder,
} from './portfolio-policy';

// Sprint 9B.10 — the provider's public gallery.
//
// docs/sprint-09b10/PROVIDER_PORTFOLIO.md
//
// OWNERSHIP IS A WHERE CLAUSE, NEVER A CHECK
//
// Every read and every write in this file is scoped to the caller's own
// providerProfileId inside the query. Not "load it, then compare the owner" —
// that pattern has an if-statement someone can forget, and its failure mode is
// editing a stranger's gallery. A row that is not yours simply is not found,
// and "not found" and "not yours" are the same 404 so the surface cannot be
// probed for which items exist.
//
// PUBLIC MEDIA, AND ONLY PUBLIC MEDIA
//
// The MediaAsset this creates is `visibility: 'PUBLIC'` and its key lives under
// the portfolio prefix. Portfolio never reads, writes or references anything in
// the RESTRICTED evidence namespace — see portfolio-policy.ts for the checks
// and the reason they are on the key rather than only on the column.

const PORTFOLIO_DELETION_REASON = 'PROVIDER_REMOVED_PORTFOLIO_ITEM';

/** The columns the wire needs. Named so a later `include` cannot widen the
 *  projection by accident. */
const ITEM_SELECT = {
  id: true,
  title: true,
  description: true,
  serviceCategoryId: true,
  position: true,
  moderationState: true,
  moderationReason: true,
  createdAt: true,
  mediaAsset: { select: { storageKey: true, declaredMimeType: true } },
} as const;

interface PortfolioLimits {
  maxItems: number;
  maxFileBytes: number;
}

@Injectable()
export class ProviderPortfolioService {
  private readonly log = new Logger(ProviderPortfolioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingRepository,
    private readonly tx: TransactionRunner,
    private readonly config: AppConfigService,
  ) {}

  async list(userId: string): Promise<ProviderPortfolioListResponse> {
    const profileId = await this.requireProfile(userId);
    const limits = await this.limits();
    const rows = await this.prisma.client.providerPortfolioItem.findMany({
      where: { providerProfileId: profileId, deletedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: ITEM_SELECT,
    });
    return this.page(rows, limits);
  }

  /**
   * Publish an uploaded image.
   *
   * Idempotent on the STORAGE KEY, which is unique on MediaAsset. A client
   * retrying after a network timeout still holds the same key, so the retry
   * returns the item the first attempt created rather than a duplicate — and
   * the guarantee is the database's, not this method's memory of it.
   */
  async create(
    userId: string,
    input: CreateProviderPortfolioItemRequest,
  ): Promise<ProviderPortfolioItem> {
    const profileId = await this.requireProfile(userId);
    const limits = await this.limits();

    let ackText: string;
    try {
      assertPublicationRight(input.publicationRightAck);
      // Sprint 9B.22 — WHICH wording, not merely that a box was ticked.
      ackText = resolvePublicationAckText(input.publicationRightAckVersion);
      assertPublishableKey(input.storageKey, this.ownerRef(userId));
      assertPublishableContentType(input.contentType);
      assertWithinFileLimit(input.sizeBytes, limits.maxFileBytes);
    } catch (err) {
      throw toAppError(err);
    }

    // The idempotent replay, checked BEFORE the limit. A retry of a create
    // that already succeeded must not be refused for having filled the last
    // slot it itself occupies.
    const existing = await this.prisma.client.providerPortfolioItem.findFirst({
      where: {
        providerProfileId: profileId,
        deletedAt: null,
        mediaAsset: { storageKey: input.storageKey },
      },
      select: ITEM_SELECT,
    });
    if (existing) return this.toItem(existing);

    const count = await this.prisma.client.providerPortfolioItem.count({
      where: { providerProfileId: profileId, deletedAt: null },
    });
    try {
      assertHasRoom(count, limits.maxItems);
    } catch (err) {
      throw toAppError(err);
    }

    const created = await this.tx.run(async (trx) => {
      const client = trx as unknown as typeof this.prisma.client;
      const asset = await client.mediaAsset.create({
        data: {
          visibility: 'PUBLIC',
          storageKey: input.storageKey,
          declaredMimeType: input.contentType,
          sizeBytes: input.sizeBytes,
          ownerUserId: userId,
          uploadCompletedAt: new Date(),
        },
      });
      return client.providerPortfolioItem.create({
        data: {
          providerProfileId: profileId,
          mediaAssetId: asset.id,
          title: input.title ?? null,
          description: input.description ?? null,
          serviceCategoryId: input.serviceCategoryId ?? null,
          publicationRightAckAt: new Date(),
          // The VERSION of the wording, resolved above — or the pre-9B.22
          // sentinel when the client did not name one.
          publicationRightAckText: ackText,
          // New work goes to the END of the gallery. Prepending would silently
          // reorder a gallery the provider arranged deliberately.
          position: count,
        },
        select: ITEM_SELECT,
      });
    });

    this.log.log({ msg: 'portfolio.item.created', providerProfileId: profileId });
    return this.toItem(created);
  }

  /** Caption and metadata only. Media is immutable: replacing the image behind
   *  an approved item would launder unmoderated content through a moderation
   *  decision that was made about something else. */
  async update(
    userId: string,
    itemId: string,
    input: UpdateProviderPortfolioItemRequest,
  ): Promise<ProviderPortfolioItem> {
    const profileId = await this.requireProfile(userId);

    // Ownership is in the WHERE. updateMany rather than update so a row that
    // is not the caller's simply does not match, instead of being loaded and
    // then compared.
    const { count } = await this.prisma.client.providerPortfolioItem.updateMany({
      where: { id: itemId, providerProfileId: profileId, deletedAt: null },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.serviceCategoryId !== undefined
          ? { serviceCategoryId: input.serviceCategoryId }
          : {}),
      },
    });
    if (count !== 1) throw notFound();

    const row = await this.prisma.client.providerPortfolioItem.findFirst({
      where: { id: itemId, providerProfileId: profileId, deletedAt: null },
      select: ITEM_SELECT,
    });
    if (!row) throw notFound();
    return this.toItem(row);
  }

  async reorder(userId: string, itemIds: string[]): Promise<ProviderPortfolioListResponse> {
    const profileId = await this.requireProfile(userId);
    const limits = await this.limits();

    const rows = await this.tx.run(async (trx) => {
      const client = trx as unknown as typeof this.prisma.client;
      const live = await client.providerPortfolioItem.findMany({
        where: { providerProfileId: profileId, deletedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      const positions = resolveReorder(
        itemIds,
        live.map((r: { id: string }) => r.id),
      );

      for (const [id, position] of positions) {
        // Each write re-asserts ownership. Inside a transaction that already
        // proved it, this is belt and braces — and it is the cheap kind.
        await client.providerPortfolioItem.updateMany({
          where: { id, providerProfileId: profileId, deletedAt: null },
          data: { position },
        });
      }

      return client.providerPortfolioItem.findMany({
        where: { providerProfileId: profileId, deletedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: ITEM_SELECT,
      });
    });

    return this.page(rows, limits);
  }

  /**
   * Remove an item, and mark its bytes for cleanup.
   *
   * SOFT delete, and the media is marked rather than erased. Two reasons, and
   * the second is the one that matters: a moderation decision was recorded
   * against this image, and destroying the bytes the moment a provider taps
   * delete would leave a moderation record about a file nobody can look at
   * again. The retention sweep owns the bytes; this owns the intent.
   *
   * Idempotent: deleting an already-deleted item is a no-op, not a 404. A
   * double-tap on a phone must not produce an error the provider cannot act
   * on.
   */
  async remove(userId: string, itemId: string): Promise<void> {
    const profileId = await this.requireProfile(userId);

    await this.tx.run(async (trx) => {
      const client = trx as unknown as typeof this.prisma.client;
      const now = new Date();

      const item = await client.providerPortfolioItem.findFirst({
        where: { id: itemId, providerProfileId: profileId },
        select: { id: true, deletedAt: true, mediaAssetId: true },
      });
      // Not found AND not yours produce the same answer, so the surface cannot
      // be probed for which item ids exist.
      if (!item) throw notFound();
      if (item.deletedAt) return;

      await client.providerPortfolioItem.updateMany({
        where: { id: itemId, providerProfileId: profileId, deletedAt: null },
        data: { deletedAt: now },
      });
      await client.mediaAsset.updateMany({
        // Scoped to a PUBLIC asset owned by this user. A portfolio delete must
        // never be able to mark a RESTRICTED evidence asset for cleanup, even
        // if a mis-linked row pointed at one.
        where: { id: item.mediaAssetId, ownerUserId: userId, visibility: 'PUBLIC' },
        data: { deletedAt: now, deletionReason: PORTFOLIO_DELETION_REASON },
      });

      // Close the gap the removal left, so positions stay dense and a client
      // can keep rendering by index.
      const live = await client.providerPortfolioItem.findMany({
        where: { providerProfileId: profileId, deletedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      for (const [index, row] of live.entries()) {
        await client.providerPortfolioItem.updateMany({
          where: { id: row.id, providerProfileId: profileId },
          data: { position: index },
        });
      }
    });

    this.log.log({ msg: 'portfolio.item.removed', providerProfileId: profileId });
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** The opaque owner segment the presign step put in the key. Recomputed
   *  rather than stored: one function owns the derivation, so the two sides
   *  cannot drift. */
  private ownerRef(userId: string): string {
    return portfolioOwnerRef(userId, String(this.config.get('JWT_ACCESS_SECRET')));
  }

  private async requireProfile(userId: string): Promise<string> {
    const profile = await this.prisma.client.providerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!profile) throw notFound();
    return profile.id;
  }

  private async limits(): Promise<PortfolioLimits> {
    return {
      maxItems: await this.boundedSetting(PORTFOLIO_MAX_ITEMS_KEY),
      maxFileBytes: await this.boundedSetting(PORTFOLIO_MAX_FILE_BYTES_KEY),
    };
  }

  /** Same shape as VerificationSettingsService.boundedInteger: a limit that can
   *  only ever REFUSE falls back to its schema default rather than failing
   *  closed, because a settings outage must not empty every provider's
   *  gallery. */
  private async boundedSetting(key: string): Promise<number> {
    const spec = ADMIN_SETTINGS_SCHEMA.find((f) => f.key === key);
    const fallback = spec?.default as number;
    try {
      const row = await this.settings.findByKey(key);
      const value = row?.value;
      if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
      if (spec && 'min' in spec && typeof spec.min === 'number' && value < spec.min) {
        return fallback;
      }
      if (spec && 'max' in spec && typeof spec.max === 'number' && value > spec.max) {
        return spec.max;
      }
      return value;
    } catch (err) {
      this.log.warn({ msg: 'portfolio.setting.read.failed', key, err: (err as Error).message });
      return fallback;
    }
  }

  private page(rows: PortfolioRow[], limits: PortfolioLimits): ProviderPortfolioListResponse {
    return {
      items: rows.map((r) => this.toItem(r)),
      // Never negative: an operator who lowered the ceiling below what a
      // provider already has must see "no room", not a negative number the UI
      // renders as text.
      remainingSlots: Math.max(0, limits.maxItems - rows.length),
      maxItems: limits.maxItems,
    };
  }

  private toItem(row: PortfolioRow): ProviderPortfolioItem {
    return {
      id: row.id,
      media: {
        url: publicUrlFor(row.mediaAsset.storageKey),
        contentType: row.mediaAsset.declaredMimeType,
      },
      title: row.title,
      description: row.description,
      serviceCategoryId: row.serviceCategoryId,
      position: row.position,
      moderationState: row.moderationState as ProviderPortfolioItem['moderationState'],
      // Only surfaced on a rejection. A pending or approved item has no reason
      // to show, and an empty string in the UI reads as a missing translation.
      moderationReason: row.moderationState === 'REJECTED' ? row.moderationReason : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

interface PortfolioRow {
  id: string;
  title: string | null;
  description: string | null;
  serviceCategoryId: string | null;
  position: number;
  moderationState: string;
  moderationReason: string | null;
  createdAt: Date;
  mediaAsset: { storageKey: string; declaredMimeType: string };
}

/** The public read path the media module already serves. Composed here rather
 *  than stored, so moving the CDN is a one-line change instead of a backfill. */
function publicUrlFor(storageKey: string): string {
  return `/v1/media/files/${storageKey}`;
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'That portfolio item does not exist.', 404);
}

/** Policy refusals become safe, stable client errors. The `reason` code is what
 *  the UI maps to localised copy; the message is a fallback, never the
 *  contract. */
function toAppError(err: unknown): AppError {
  if (err instanceof PortfolioPolicyError) {
    // A stale publication acknowledgement is a CONFLICT rather than a bad
    // request: what the client sent was valid until the wording moved, and the
    // fix is to reload and re-read it, not to correct a field.
    if (err.code === 'STALE_PUBLICATION_ACK') {
      return new AppError('CONFLICT', err.message, 409, {
        reason: err.code,
        currentVersion: CURRENT_PUBLICATION_ACK_VERSION,
      });
    }
    return new AppError('VALIDATION_ERROR', err.message, 400, { reason: err.code });
  }
  return err as AppError;
}
