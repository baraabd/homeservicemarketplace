import { createHmac } from 'node:crypto';

import { ALLOWED_IMAGE_TYPES } from '../../../infrastructure/storage/content-type';

// Sprint 9B.10 — the portfolio rules, with no database in sight.
//
// docs/sprint-09b10/PROVIDER_PORTFOLIO.md
//
// THE SEPARATION THAT MATTERS MOST
//
// Portfolio media is PUBLIC. Verification evidence is RESTRICTED. They share a
// MediaAsset table and nothing else, and the one direction that must be
// impossible is a portfolio item pointing at an evidence asset: a provider who
// managed that would publish their own identity documents to the marketplace.
//
// So the storage KEY is checked, not just the visibility column. A key is the
// one property that is fixed at upload time, written by the server, and cannot
// be changed later by any route — whereas a visibility column is a field, and
// fields get updated by code nobody re-reads. `assertPublishableKey` is what
// stands between the two namespaces.

/** Where portfolio uploads live. Distinct prefix so a cleanup job, a bucket
 *  policy and a CDN rule can all scope to it without parsing anything. */
export const PORTFOLIO_KEY_PREFIX = 'portfolio/';

/** The evidence namespace, named here so the refusal below is explicit about
 *  what it is refusing rather than merely defaulting. */
export const EVIDENCE_KEY_PREFIX = 'verification/';

/**
 * The owner segment of a portfolio storage key.
 *
 * An HMAC of the user id, NOT the user id. Portfolio images are public: their
 * URL is handed to every customer who views the gallery, and a raw user id in
 * that URL is an internal identifier published to the world — it correlates a
 * provider across every other surface that ever exposes one.
 *
 * Deterministic, so the ownership check can recompute it rather than store it,
 * and one-way, so a URL cannot be walked back to an account.
 */
export function portfolioOwnerRef(userId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`portfolio-owner:${userId}`)
    .digest('hex')
    .slice(0, 24);
}

export const PORTFOLIO_MAX_ITEMS_KEY = 'provider_portfolio_max_items';
export const PORTFOLIO_MAX_FILE_BYTES_KEY = 'provider_portfolio_max_file_bytes';

export type PortfolioRefusal =
  | 'LIMIT_REACHED'
  | 'FILE_TOO_LARGE'
  | 'DISALLOWED_FORMAT'
  | 'NOT_A_PORTFOLIO_KEY'
  | 'PUBLICATION_RIGHT_NOT_ACKNOWLEDGED';

export class PortfolioPolicyError extends Error {
  constructor(
    readonly code: PortfolioRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'PortfolioPolicyError';
  }
}

/**
 * Only images, and only the ones the platform already allows.
 *
 * Video is deliberately excluded even though the shared content-type module
 * permits it: a portfolio is a gallery, videos need transcoding and a poster
 * frame that nothing here produces, and shipping the type without the pipeline
 * would put an unplayable file in front of a customer.
 */
export function assertPublishableContentType(contentType: string): void {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
    throw new PortfolioPolicyError(
      'DISALLOWED_FORMAT',
      'Portfolio items must be an image in a supported format.',
    );
  }
}

/**
 * The key must be one the presign step minted for THIS provider's portfolio.
 *
 * Three refusals in one, and the order is the point: the evidence prefix is
 * named explicitly so the intent survives a future refactor that changes what
 * "portfolio" means, and the ownership segment is checked so one provider
 * cannot publish another's uploaded file by guessing a key.
 */
export function assertPublishableKey(key: string, ownerRef: string): void {
  // The OPAQUE ref, never the raw user id — see portfolioOwnerRef.
  const expectedPrefix = `${PORTFOLIO_KEY_PREFIX}${ownerRef}/`;

  if (key.startsWith(EVIDENCE_KEY_PREFIX)) {
    throw new PortfolioPolicyError('NOT_A_PORTFOLIO_KEY', 'That file is not a portfolio image.');
  }
  if (!key.startsWith(expectedPrefix)) {
    throw new PortfolioPolicyError('NOT_A_PORTFOLIO_KEY', 'That file is not a portfolio image.');
  }
  // Traversal, absolute paths and null bytes. The presign endpoint synthesises
  // keys and never echoes a filename, so a key containing any of these did not
  // come from it — refusing is cheap and the alternative is a path written
  // outside the namespace everything else assumes.
  if (key.includes('..') || key.includes('\0') || key.includes('//')) {
    throw new PortfolioPolicyError('NOT_A_PORTFOLIO_KEY', 'That file is not a portfolio image.');
  }
}

export function assertWithinFileLimit(sizeBytes: number, maxFileBytes: number): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxFileBytes) {
    throw new PortfolioPolicyError('FILE_TOO_LARGE', 'That image is too large to publish.');
  }
}

/**
 * Room for one more?
 *
 * A LOWERED limit does not delete anything. An operator tightening the ceiling
 * must not silently unpublish work providers already showed to customers — the
 * limit refuses additions, and the existing gallery stands.
 */
export function assertHasRoom(currentCount: number, maxItems: number): void {
  if (currentCount >= maxItems) {
    throw new PortfolioPolicyError(
      'LIMIT_REACHED',
      'You have reached the maximum number of portfolio items.',
    );
  }
}

export function assertPublicationRight(ack: unknown): void {
  // Strictly `true`. A truthy check would accept the string "false".
  if (ack !== true) {
    throw new PortfolioPolicyError(
      'PUBLICATION_RIGHT_NOT_ACKNOWLEDGED',
      'You must confirm you may publish this image.',
    );
  }
}

/**
 * The new order, given the ids the provider asked for and the ids that exist.
 *
 * Returns a DENSE, 0-based position for every live item. Three properties, all
 * of which have bitten someone before:
 *
 *   ids the provider does not own, or that are already deleted, are ignored
 *   rather than erroring — a stale tab reordering a gallery someone deleted
 *   from on another device should not fail, it should converge;
 *
 *   live ids the request OMITTED keep their relative order and land after the
 *   named ones, so a partial list cannot silently drop items out of the
 *   gallery;
 *
 *   duplicates in the request are collapsed, because two positions for one id
 *   is not an order.
 */
export function resolveReorder(requestedIds: string[], liveIds: string[]): Map<string, number> {
  const live = new Set(liveIds);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const id of requestedIds) {
    if (!live.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const id of liveIds) {
    if (!seen.has(id)) ordered.push(id);
  }

  return new Map(ordered.map((id, index) => [id, index]));
}
