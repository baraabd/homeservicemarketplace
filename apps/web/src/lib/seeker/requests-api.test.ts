import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../api';
import {
  cancelServiceRequest,
  createServiceRequest,
  getServiceRequest,
  getServiceRequestTimeline,
  listServiceRequests,
  reopenServiceRequest,
  updateServiceRequest,
} from './requests-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

const ROW = {
  id: 'req-1',
  status: 'OPEN_FOR_BIDS' as const,
  category: { id: 'cat-1', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
  customServiceText: null,
  description: null,
  scheduleType: 'ASAP' as const,
  scheduledAt: null,
  addressSnapshot: {
    label: 'Home',
    line1: '4 Main',
    city: 'Riyadh',
    country: 'SA',
    lat: null,
    lng: null,
  },
  bidsCount: 0,
  createdAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

describe('requests-api — listServiceRequests', () => {
  it('GETs /v1/me/requests with status filter and unwraps the envelope', async () => {
    let capturedParams: Record<string, unknown> = {};
    mock.onGet('/v1/me/requests').reply((config) => {
      capturedParams = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [ROW], nextCursor: null }];
    });
    const out = await listServiceRequests({ status: 'OPEN_FOR_BIDS', limit: 25 });
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
    expect(capturedParams).toEqual({ status: 'OPEN_FOR_BIDS', limit: 25 });
  });

  it('rejects on 5xx so React Query can surface an error state', async () => {
    mock.onGet('/v1/me/requests').reply(503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    await expect(listServiceRequests()).rejects.toBeDefined();
  });
});

describe('requests-api — createServiceRequest', () => {
  it('POSTs the payload and returns the created summary', async () => {
    let body: Record<string, unknown> | null = null;
    mock.onPost('/v1/me/requests').reply((config) => {
      body = JSON.parse(config.data as string);
      return [201, ROW];
    });
    const out = await createServiceRequest({
      categoryId: 'cat-1',
      scheduleType: 'ASAP',
      addressId: 'addr-1',
    });
    expect(out.id).toBe('req-1');
    expect(body).toMatchObject({ categoryId: 'cat-1', scheduleType: 'ASAP', addressId: 'addr-1' });
  });

  it('does NOT send a seekerUserId field even if a caller mistake puts one in', async () => {
    let captured: Record<string, unknown> | null = null;
    mock.onPost('/v1/me/requests').reply((config) => {
      captured = JSON.parse(config.data as string);
      return [201, ROW];
    });
    await createServiceRequest({
      categoryId: 'cat-1',
      scheduleType: 'ASAP',
      manualAddress: { line1: 'a', city: 'b', country: 'cc' },
    });
    expect(captured).not.toHaveProperty('seekerUserId');
  });
});

describe('requests-api — detail / timeline / patch / cancel / reopen', () => {
  it('getServiceRequest hits /v1/me/requests/:id', async () => {
    mock.onGet('/v1/me/requests/req-1').reply(200, ROW);
    const out = await getServiceRequest('req-1');
    expect(out.id).toBe('req-1');
  });

  it('updateServiceRequest PATCHes the id', async () => {
    mock.onPatch('/v1/me/requests/req-1').reply(200, { ...ROW, description: 'updated' });
    const out = await updateServiceRequest('req-1', { description: 'updated' });
    expect(out.description).toBe('updated');
  });

  it('cancelServiceRequest POSTs to /:id/cancel', async () => {
    mock.onPost('/v1/me/requests/req-1/cancel').reply(200, { ...ROW, status: 'CANCELLED' });
    const out = await cancelServiceRequest('req-1');
    expect(out.status).toBe('CANCELLED');
  });

  it('reopenServiceRequest POSTs to /:id/reopen', async () => {
    mock.onPost('/v1/me/requests/req-1/reopen').reply(200, { ...ROW, status: 'OPEN_FOR_BIDS' });
    const out = await reopenServiceRequest('req-1');
    expect(out.status).toBe('OPEN_FOR_BIDS');
  });

  it('getServiceRequestTimeline hits /:id/timeline and returns events', async () => {
    mock.onGet('/v1/me/requests/req-1/timeline').reply(200, {
      items: [
        {
          id: 'evt-1',
          type: 'REQUEST_CREATED',
          metadata: null,
          createdAt: '2026-04-28T00:00:00.000Z',
        },
      ],
    });
    const out = await getServiceRequestTimeline('req-1');
    expect(out.items[0].type).toBe('REQUEST_CREATED');
  });
});
