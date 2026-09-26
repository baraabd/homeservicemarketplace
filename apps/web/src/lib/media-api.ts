// Request-media transport. All-or-nothing refers to the returned URL set;
// storage rollback/ownership still require backend authority, not this helper.
import { api } from './api';
import { MAX_REQUEST_MEDIA_ITEMS } from './request-media/constants';
import { MAX_REQUEST_UPLOAD_BYTES, validateUploadReservations } from './request-media/upload-policy';

export const ALLOWED_UPLOAD_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/webm',
] as const;
export type AllowedUploadType = (typeof ALLOWED_UPLOAD_TYPES)[number];
export function isAllowedUploadType(value: string): value is AllowedUploadType {
  return (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(value);
}
interface PresignItemRequest {
  contentType: AllowedUploadType;
  sizeBytes: number;
  filename?: string;
}
export interface PresignedItem {
  uploadUrl: string;
  fileUrl: string;
  expiresAt: string;
}

/** Auth and CSRF apply to reservation; binary PUTs carry only the signature. */
export async function requestPresignedUploads(items: PresignItemRequest[], signal?: AbortSignal): Promise<PresignedItem[]> {
  const { data } = await api.post<unknown>('/v1/media/presigned-url', { items }, { signal });
  return validateUploadReservations(data, items.length);
}

export async function uploadFileToPresignedUrl(file: File, uploadUrl: string, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
      signal,
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    if (signal?.aborted) throw new DOMException('Media upload cancelled.', 'AbortError');
    throw new Error('Media upload could not reach storage.');
  }
  if (!response.ok) throw new Error(`Media upload failed: HTTP ${response.status}`);
}

/** No partial URL list can reach request publication; a failed PUT aborts peers. */
export async function uploadAll(files: File[], signal?: AbortSignal): Promise<string[]> {
  if (signal?.aborted) throw new DOMException('Media upload cancelled.', 'AbortError');
  if (files.length === 0) return [];
  if (files.length > MAX_REQUEST_MEDIA_ITEMS || files.some((file) =>
    !isAllowedUploadType(file.type) || file.size < 1 || file.size > MAX_REQUEST_UPLOAD_BYTES)) {
    throw new Error('Selected media exceeds the supported type, size or file-count limits.');
  }
  const batch = new AbortController();
  const abort = () => batch.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const presigned = await requestPresignedUploads(files.map((file) => ({
      contentType: file.type as AllowedUploadType, sizeBytes: file.size, filename: file.name,
    })), batch.signal);
    if (batch.signal.aborted) throw new DOMException('Media upload cancelled.', 'AbortError');
    await Promise.all(presigned.map((item, index) => uploadFileToPresignedUrl(files[index], item.uploadUrl, batch.signal)));
    return presigned.map((item) => item.fileUrl);
  } catch (error) {
    batch.abort();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
