import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../lib/api';
import {
  manualCommandKey,
  readManualReceipt,
  uploadManualReceipt,
  decideManualPayment,
  manualFailureMessage,
  retryManualConfirmation,
  recordManualSettlement,
} from './manual-payments.api';
import { toMoneyWire } from '@homeservicemarketplace/contracts';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => mock.restore());

describe('R30 authenticated private receipt client (HTTP contract doubles)', () => {
  it('reserves, uploads raw bytes through the API, then finalizes the same asset', async () => {
    const file = new File(['synthetic receipt'], 'receipt.png', { type: 'image/png' });
    mock.onPost('/v1/money/manual/intents/intent%2Fa/receipts').reply(201, {
      receiptVersionId: 'rv',
      mediaAssetId: 'asset/a',
      version: 2,
      expiresAt: '2026-10-23T20:00:00Z',
      maxBytes: 500,
    });
    mock.onPut('/v1/money/manual/receipts/asset%2Fa/content').reply(204);
    mock
      .onPost('/v1/money/manual/receipts/asset%2Fa/finalize')
      .reply(200, { paymentIntentId: 'intent/a' });
    expect(await uploadManualReceipt('intent/a', file, 1, 'command-one')).toEqual({
      paymentIntentId: 'intent/a',
    });
    expect(JSON.parse(mock.history.post[0].data)).toEqual({
      contentType: 'image/png',
      sizeBytes: file.size,
      expectedVersion: 1,
      filename: 'receipt.png',
    });
    expect(mock.history.post[0].headers?.['Idempotency-Key']).toBe('command-one');
    expect(mock.history.put[0].data).toBe(file);
    expect(mock.history.put[0].headers?.['Content-Type']).toBe('image/png');
    expect(api.defaults.withCredentials).toBe(true);
  });
  it('does not finalize or claim upload success after an upload failure', async () => {
    mock
      .onPost('/v1/money/manual/intents/i/receipts')
      .reply(201, { mediaAssetId: 'a', maxBytes: 500 });
    mock.onPut('/v1/money/manual/receipts/a/content').reply(503);
    await expect(
      uploadManualReceipt(
        'i',
        new File(['fixture'], 'r.png', { type: 'image/png' }),
        2,
        'retry-key',
      ),
    ).rejects.toThrow();
    expect(mock.history.post).toHaveLength(1);
  });
  it('never sends bytes after reservation is refused', async () => {
    mock.onPost('/v1/money/manual/intents/i/receipts').reply(403);
    await expect(
      uploadManualReceipt(
        'i',
        new File(['fixture'], 'r.png', { type: 'image/png' }),
        2,
        'retry-key',
      ),
    ).rejects.toThrow();
    expect(mock.history.put).toHaveLength(0);
  });
  it('reads private content with its inspection identity and an abort signal', async () => {
    const blob = new Blob(['synthetic'], { type: 'image/png' });
    mock
      .onGet('/v1/money/manual/receipts/a/content')
      .reply(200, blob, { 'x-receipt-inspection-id': 'inspection-one' });
    const controller = new AbortController();
    expect(await readManualReceipt('a', controller.signal)).toEqual({
      blob,
      inspectionId: 'inspection-one',
    });
    expect(mock.history.get[0].signal).toBe(controller.signal);
    expect(mock.history.get[0].responseType).toBe('blob');
  });
  it('submits expected revision and inspection proof separately from internal notes', async () => {
    const request = {
      expectedVersion: 4,
      receiptVersionId: 'rv4',
      inspectionId: 'inspection4',
      action: 'REQUEST_REPLACEMENT' as const,
      providerMessage: 'Please include the full reference.',
      internalNote: 'Internal comparison note',
    };
    mock
      .onPost('/v1/money/manual/review/intents/i/decisions')
      .reply(200, { status: 'REPLACEMENT_REQUESTED' });
    await decideManualPayment('i', request, 'review-key');
    expect(JSON.parse(mock.history.post[0].data)).toEqual(request);
    expect(mock.history.post[0].headers?.['Idempotency-Key']).toBe('review-key');
  });
  it('retains the command key across an unresolved retry and changes it for a changed payload', () => {
    const holder = { current: null as { payload: string; key: string } | null };
    const one = manualCommandKey(holder, { expectedVersion: 1, action: 'REJECT' });
    expect(manualCommandKey(holder, { expectedVersion: 1, action: 'REJECT' })).toBe(one);
    expect(manualCommandKey(holder, { expectedVersion: 2, action: 'REJECT' })).not.toBe(one);
  });
  it('retries only the existing confirmation at its expected version with an idempotency key', async () => {
    mock.onPost('/v1/money/manual/review/intents/i/retry').reply(202, { status: 'CONFIRMING' });
    expect(await retryManualConfirmation('i', 9, 'recovery-key')).toEqual({ status: 'CONFIRMING' });
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ expectedVersion: 9 });
    expect(mock.history.post[0].headers?.['Idempotency-Key']).toBe('recovery-key');
  });
  it('reloads the authoritative review after the settlement command returns only its identity', async () => {
    const input = {
      reference: 'SIMULATED-DEPOSIT',
      amount: toMoneyWire({ amountMinor: 1000n, currency: 'XTS' }),
      occurredAt: '2026-10-23T08:00:35.000Z',
      evidenceSource: 'SANDBOX_OPERATOR_SIMULATION' as const,
    };
    const refreshed = {
      paymentIntentId: 'i',
      availableActions: [],
      settlements: [{ id: 'deposit-one', canApprove: false }],
    };
    mock.onPost('/v1/money/manual/review/intents/i/settlements').reply(201, { id: 'deposit-one' });
    mock.onGet('/v1/money/manual/review/intents/i').reply(200, refreshed);
    expect(await recordManualSettlement('i', input, 'settlement-key')).toEqual(refreshed);
    expect(JSON.parse(mock.history.post[0].data)).toEqual(input);
    expect(mock.history.post[0].headers?.['Idempotency-Key']).toBe('settlement-key');
    expect(mock.history.get).toHaveLength(1);
    expect(mock.history.get[0].url).toBe('/v1/money/manual/review/intents/i');
  });
  it('shows safe conflict text rather than raw backend details', () => {
    const text = manualFailureMessage(
      { response: { status: 409, data: { message: 'private SQL / storage coordinates' } } },
      'en',
    );
    expect(text).toContain('changed');
    expect(text).not.toContain('SQL');
  });
  it('does not infer a disabled payment method from a transient service failure', () => {
    expect(manualFailureMessage({ response: { status: 503 } }, 'en')).toBe(
      'The request could not be confirmed. Refresh the status before trying again.',
    );
  });
});
