import type { Prisma, PrismaTx } from '@homeservicemarketplace/database';
import type { PrismaService } from '../../prisma/prisma.service';
import { BookingRepository } from './booking.repository';

const time = new Date('2026-10-01T12:34:56.789Z');
const row = {
  id: 'booking',
  requestId: 'request',
  bidId: 'bid',
  providerId: 'provider',
  seekerUserId: 'seeker',
  status: 'COMPLETED',
  scheduledAt: null,
  createdAt: time,
  updatedAt: time,
  deletedAt: null,
  priceAmount: 1357,
  currency: 'SEK',
  addressSnapshot: { city: 'Test city', line1: 'Accepted booking address' },
  customServiceText: null,
  categorySlug: 'plumbing',
  categoryLabelEn: 'Plumbing',
  categoryLabelAr: 'سباكة',
  pricingType: 'HOURLY',
  bidNote: 'Original bid note',
  seekerId: 'seeker',
  seekerFirstName: 'Layla',
  providerDisplayName: 'Provider',
  providerUserId: 'provider-user',
  providerEmail: 'synthetic@example.test',
};

describe('bounded booking list projections', () => {
  function setup() {
    const client = { $queryRaw: jest.fn().mockResolvedValue([row]) };
    return { client, repo: new BookingRepository({ client } as unknown as PrismaService) };
  }

  it('returns the provider summary fields in one read without another profile or private identity', async () => {
    const { client, repo } = setup();
    const [actual] = await repo.listForProvider({ providerId: 'provider', take: 51 });
    expect(actual).toEqual({
      id: row.id,
      requestId: row.requestId,
      bidId: row.bidId,
      status: row.status,
      scheduledAt: null,
      priceAmount: 1357,
      currency: 'SEK',
      createdAt: time,
      updatedAt: time,
      request: {
        addressSnapshot: row.addressSnapshot,
        customServiceText: null,
        category: { slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
      },
      bid: { pricingType: 'HOURLY', note: 'Original bid note' },
      seeker: { id: 'seeker', firstName: 'Layla' },
    });
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    const query = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toEqual(['provider', 51, 0]);
    expect(query.text).not.toMatch(/ProviderProfile|email|passwordHash/);
    expect(query.text).toContain('booking."deletedAt" IS NULL');
  });

  it('parameterizes provider, status and cursor while retaining inclusive skip-one ordering', async () => {
    const { client, repo } = setup();
    const providerId = "provider' OR TRUE --";
    const cursor = "cursor' OR TRUE --";
    await repo.listForProvider({ providerId, cursor, status: 'COMPLETED', take: 6 });
    const query = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toEqual([cursor, providerId, 'COMPLETED', providerId, 'COMPLETED', 6, 1]);
    expect(query.text).not.toContain(providerId);
    expect(query.text).not.toContain(cursor);
    expect(query.text).toContain('booking."scheduledAt" DESC NULLS LAST');
    expect(query.text).toContain('booking."scheduledAt" IS NOT DISTINCT FROM cursor."scheduledAt"');
    expect(query.text).toContain('booking.id <= cursor.id');
  });

  it('retains admin currency, amount, dates and permitted identities without loading a bid', async () => {
    const { client, repo } = setup();
    const [actual] = await repo.listCompletedBookingsForAdmin({ take: 31 });
    expect(actual).toEqual({
      id: 'booking',
      priceAmount: 1357,
      currency: 'SEK',
      updatedAt: time,
      request: {
        addressSnapshot: row.addressSnapshot,
        customServiceText: null,
        category: { slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
      },
      provider: {
        id: 'provider',
        displayName: 'Provider',
        user: { id: 'provider-user', email: 'synthetic@example.test' },
      },
      seeker: { id: 'seeker', firstName: 'Layla' },
    });
    expect(actual.updatedAt).toBe(time);
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    const query = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.text).not.toMatch(/"Bid"|Ledger/);
    expect(query.text).toContain("booking.status = 'COMPLETED'");
    expect(query.text).toContain('booking."deletedAt" IS NULL');
    expect(query.values).toEqual([31, 0]);
  });

  it('preserves null category, custom service and unlinked provider user', async () => {
    const { client, repo } = setup();
    client.$queryRaw.mockResolvedValue([
      {
        ...row,
        categorySlug: null,
        categoryLabelEn: null,
        categoryLabelAr: null,
        customServiceText: 'Custom service',
        providerUserId: null,
        providerEmail: null,
        seekerFirstName: null,
      },
    ]);
    const [actual] = await repo.listCompletedBookingsForAdmin({ take: 5 });
    expect(actual.request.category).toBeNull();
    expect(actual.request.customServiceText).toBe('Custom service');
    expect(actual.provider.user).toBeNull();
    expect(actual.seeker.firstName).toBeNull();
  });

  it('binds the financial cursor and keeps its existing updatedAt/id position', async () => {
    const { client, repo } = setup();
    const cursor = "cursor' OR TRUE --";
    await repo.listCompletedBookingsForAdmin({ take: 21, cursor });
    const query = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toEqual([cursor, 21, 1]);
    expect(query.text).not.toContain(cursor);
    expect(query.text).toContain(
      '(booking."updatedAt", booking.id) <= (cursor."updatedAt", cursor.id)',
    );
  });

  it.each(['provider', 'admin'] as const)(
    '%s list uses the caller transaction only',
    async (kind) => {
      const { client, repo } = setup();
      const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
      const actual =
        kind === 'provider'
          ? await repo.listForProvider(
              { providerId: 'provider', take: 5 },
              tx as unknown as PrismaTx,
            )
          : await repo.listCompletedBookingsForAdmin({ take: 5 }, tx as unknown as PrismaTx);
      expect(actual).toEqual([]);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(client.$queryRaw).not.toHaveBeenCalled();
    },
  );

  it.each(['provider', 'admin'] as const)('%s list propagates storage failure', async (kind) => {
    const { client, repo } = setup();
    const failure = new Error('unavailable');
    client.$queryRaw.mockRejectedValue(failure);
    const operation =
      kind === 'provider'
        ? repo.listForProvider({ providerId: 'provider', take: 5 })
        : repo.listCompletedBookingsForAdmin({ take: 5 });
    await expect(operation).rejects.toBe(failure);
  });
});
