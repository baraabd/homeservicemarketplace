import { createHmac } from 'node:crypto';

/** Service-request attachments live under their own server-owned namespace. */
export const REQUEST_ATTACHMENT_PREFIX = 'requests/';

export function isRequestAttachmentKey(key: string): boolean {
  return key.startsWith(REQUEST_ATTACHMENT_PREFIX);
}

/**
 * An opaque, stable reference to the uploading user, for use inside a storage
 * key.
 *
 * A request attachment URL is handed to every provider who can see the
 * request. A raw user id in that URL would publish an internal identifier, so
 * the key carries an HMAC of it instead. Authorization never parses this
 * value: ownership is `MediaAsset.ownerUserId`.
 */
export function requestAttachmentOwnerRef(userId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`request-attachment-owner:${userId}`)
    .digest('hex')
    .slice(0, 24);
}
