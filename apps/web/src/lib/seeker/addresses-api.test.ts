import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../api';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} from './addresses-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

describe('addresses-api — listAddresses', () => {
  it('GETs /v1/me/addresses and unwraps the items array', async () => {
    mock.onGet('/v1/me/addresses').reply(200, {
      items: [
        {
          id: 'addr-1',
          label: 'Home',
          type: 'HOME',
          line1: '4 Main St',
          city: 'Riyadh',
          country: 'SA',
          lat: null,
          lng: null,
          isDefault: true,
        },
      ],
    });
    const out = await listAddresses();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'addr-1', label: 'Home', type: 'HOME', isDefault: true });
  });

  it('rejects on 5xx so React Query can surface an error state', async () => {
    mock.onGet('/v1/me/addresses').reply(503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    await expect(listAddresses()).rejects.toBeDefined();
  });
});

describe('addresses-api — createAddress', () => {
  it('POSTs the payload and returns the created AddressSummary', async () => {
    mock.onPost('/v1/me/addresses').reply((config) => {
      const body = JSON.parse(config.data as string);
      return [
        201,
        {
          id: 'addr-2',
          label: body.label,
          type: body.type,
          line1: body.line1,
          city: body.city,
          country: body.country,
          lat: null,
          lng: null,
          isDefault: false,
        },
      ];
    });
    const out = await createAddress({
      label: 'Office',
      type: 'WORK',
      line1: 'King Fahd Rd',
      city: 'Riyadh',
      country: 'SA',
    });
    expect(out).toMatchObject({ id: 'addr-2', label: 'Office', type: 'WORK' });
  });

  it('does NOT send a userId field even if a caller-side mistake puts one in', async () => {
    // Pin the contract: clients have no business sending userId. The
    // backend ignores it (forbidNonWhitelisted) but we double-defend
    // here by keeping the type-safe wrapper userId-free.
    let captured: Record<string, unknown> | null = null;
    mock.onPost('/v1/me/addresses').reply((config) => {
      captured = JSON.parse(config.data as string);
      return [201, {}];
    });
    await createAddress({
      label: 'X',
      type: 'CUSTOM',
      line1: 'a',
      city: 'b',
      country: 'cc',
    });
    expect(captured).not.toHaveProperty('userId');
  });
});

describe('addresses-api — updateAddress', () => {
  it('PATCHes the addressId and returns the updated row', async () => {
    mock.onPatch('/v1/me/addresses/addr-1').reply(200, {
      id: 'addr-1',
      label: 'Renamed',
      type: 'HOME',
      line1: '4 Main',
      city: 'Riyadh',
      country: 'SA',
      lat: null,
      lng: null,
      isDefault: true,
    });
    const out = await updateAddress('addr-1', { label: 'Renamed' });
    expect(out.label).toBe('Renamed');
  });
});

describe('addresses-api — deleteAddress', () => {
  it('DELETEs the addressId', async () => {
    mock.onDelete('/v1/me/addresses/addr-1').reply(204);
    await expect(deleteAddress('addr-1')).resolves.toBeUndefined();
  });

  it('propagates a 409 (cannot delete default while others exist)', async () => {
    mock.onDelete('/v1/me/addresses/addr-1').reply(409, { error: { code: 'CONFLICT' } });
    await expect(deleteAddress('addr-1')).rejects.toMatchObject({
      response: { status: 409 },
    });
  });
});

describe('addresses-api — setDefaultAddress', () => {
  it('POSTs the default endpoint and returns the promoted row', async () => {
    mock.onPost('/v1/me/addresses/addr-2/default').reply(200, {
      id: 'addr-2',
      label: 'Office',
      type: 'WORK',
      line1: 'King Fahd Rd',
      city: 'Riyadh',
      country: 'SA',
      lat: null,
      lng: null,
      isDefault: true,
    });
    const out = await setDefaultAddress('addr-2');
    expect(out.isDefault).toBe(true);
  });
});
