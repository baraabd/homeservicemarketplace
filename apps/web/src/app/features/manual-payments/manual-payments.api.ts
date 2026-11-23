import type {
  ManualPaymentDetailV1,
  ManualPaymentQueuePageV1,
  ManualReceiptReservationRequestV1,
  ManualReceiptReservationV1,
  ManualReviewDecisionRequestV1,
  ManualReviewDetailV1,
  ManualSettlementRequestV1,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
import { MANUAL_PAYMENT_COPY, type ManualPaymentLanguage } from './manual-payments.copy';

const BASE = '/v1/money/manual';
const segment = encodeURIComponent;
const command = (idempotencyKey: string, signal?: AbortSignal) => ({
  headers: { 'Idempotency-Key': idempotencyKey },
  signal,
});

export async function getManualPayment(
  id: string,
  signal?: AbortSignal,
): Promise<ManualPaymentDetailV1> {
  return (await api.get<ManualPaymentDetailV1>(`${BASE}/intents/${segment(id)}`, { signal })).data;
}
export async function getManualReview(
  id: string,
  signal?: AbortSignal,
): Promise<ManualReviewDetailV1> {
  return (await api.get<ManualReviewDetailV1>(`${BASE}/review/intents/${segment(id)}`, { signal }))
    .data;
}
export async function listManualReviews(
  cursor?: string,
  signal?: AbortSignal,
): Promise<ManualPaymentQueuePageV1> {
  return (
    await api.get<ManualPaymentQueuePageV1>(`${BASE}/review/intents`, {
      params: cursor ? { cursor } : undefined,
      signal,
    })
  ).data;
}
export async function reserveManualReceipt(
  id: string,
  input: ManualReceiptReservationRequestV1,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ManualReceiptReservationV1> {
  return (
    await api.post<ManualReceiptReservationV1>(
      `${BASE}/intents/${segment(id)}/receipts`,
      input,
      command(idempotencyKey, signal),
    )
  ).data;
}
export async function uploadManualReceipt(
  id: string,
  file: File,
  expectedVersion: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ManualPaymentDetailV1> {
  const reservation = await reserveManualReceipt(
    id,
    { contentType: file.type, sizeBytes: file.size, expectedVersion, filename: file.name },
    idempotencyKey,
    signal,
  );
  if (file.size > reservation.maxBytes) throw new Error('Receipt exceeds reserved size');
  // Restricted bytes always pass through the authenticated API. No public or signed URL.
  await api.put(`${BASE}/receipts/${segment(reservation.mediaAssetId)}/content`, file, {
    headers: { 'Content-Type': file.type },
    // This endpoint consumes bytes; never apply the shared JSON serialization.
    transformRequest: [(bytes) => bytes],
    signal,
  });
  return (
    await api.post<ManualPaymentDetailV1>(
      `${BASE}/receipts/${segment(reservation.mediaAssetId)}/finalize`,
      {},
      command(`${idempotencyKey}:finalize`, signal),
    )
  ).data;
}
export async function submitManualReceipt(
  id: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<ManualPaymentDetailV1> {
  return (
    await api.post<ManualPaymentDetailV1>(
      `${BASE}/intents/${segment(id)}/submit`,
      { expectedVersion },
      command(idempotencyKey),
    )
  ).data;
}
export async function decideManualPayment(
  id: string,
  input: ManualReviewDecisionRequestV1,
  idempotencyKey: string,
): Promise<ManualReviewDetailV1> {
  return (
    await api.post<ManualReviewDetailV1>(
      `${BASE}/review/intents/${segment(id)}/decisions`,
      input,
      command(idempotencyKey),
    )
  ).data;
}
export async function recordManualSettlement(
  id: string,
  input: ManualSettlementRequestV1,
  idempotencyKey: string,
): Promise<ManualReviewDetailV1> {
  await api.post<{ id: string }>(
    `${BASE}/review/intents/${segment(id)}/settlements`,
    input,
    command(idempotencyKey),
  );
  // The command returns only its record identity. Reload the authorized view
  // so actions, actor eligibility and immutable history remain server-owned.
  return getManualReview(id);
}
export async function retryManualConfirmation(
  id: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<ManualReviewDetailV1> {
  return (
    await api.post<ManualReviewDetailV1>(
      `${BASE}/review/intents/${segment(id)}/retry`,
      { expectedVersion },
      command(idempotencyKey),
    )
  ).data;
}
export async function readManualReceipt(
  assetId: string,
  signal: AbortSignal,
): Promise<{ blob: Blob; inspectionId: string | null }> {
  const response = await api.get<Blob>(`${BASE}/receipts/${segment(assetId)}/content`, {
    responseType: 'blob',
    signal,
    timeout: 30_000,
  });
  const inspection = response.headers['x-receipt-inspection-id'];
  return {
    blob: response.data,
    inspectionId:
      typeof inspection === 'string' && inspection.length > 0 && inspection.length <= 200
        ? inspection
        : null,
  };
}

/** One unresolved command retains its key; changing the payload creates a new command. */
export function manualCommandKey(
  holder: { current: { payload: string; key: string } | null },
  payload: unknown,
): string {
  const serialized = JSON.stringify(payload);
  if (holder.current?.payload !== serialized)
    holder.current = { payload: serialized, key: crypto.randomUUID() };
  return holder.current.key;
}
export function manualFailureMessage(error: unknown, lang: ManualPaymentLanguage): string {
  const status =
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'status' in error.response
      ? error.response.status
      : null;
  const t = MANUAL_PAYMENT_COPY[lang];
  if (status === 401 || status === 403) return t.denied;
  if (status === 404) return t.unavailable;
  if (status === 409) return t.conflict;
  // Only the authoritative detail's availability declares a disabled method.
  // A transient service failure leaves the command outcome unresolved.
  return t.failure;
}
