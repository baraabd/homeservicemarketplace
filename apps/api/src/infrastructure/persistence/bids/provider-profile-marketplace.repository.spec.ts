import type { Prisma, PrismaTx } from '@homeservicemarketplace/database';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProviderProfileRepository } from './provider-profile.repository';

describe('marketplace profile projection', () => {
  function setup() {
    const client = { $queryRaw: jest.fn() };
    return { client, repo: new ProviderProfileRepository({ client } as unknown as PrismaService) };
  }

  it('loads only matching coordinates and configured category IDs in one read', async () => {
    const { client, repo } = setup();
    const profile = {
      id: 'provider',
      userId: 'owner',
      serviceAreaLat: 36.2,
      serviceAreaLng: 37.16,
      serviceAreaRadiusKm: 10,
      serviceAreaCity: 'Aleppo',
      serviceAreaCityKey: 'aleppo',
    };
    client.$queryRaw.mockResolvedValue([{ ...profile, categoryIds: ['category-a', 'category-b'] }]);
    expect(await repo.findMarketplaceProfileByUserId('owner')).toEqual({
      ...profile,
      serviceCategories: [{ serviceCategoryId: 'category-a' }, { serviceCategoryId: 'category-b' }],
    });
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    const query = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.text).toContain('profile."deletedAt" IS NULL');
    expect(query.text).not.toMatch(/ProviderCategoryApplication|passwordHash|email/);
    expect(query.values).toEqual(['owner']);
  });

  it('returns null for a missing or soft-deleted profile', async () => {
    const { client, repo } = setup();
    client.$queryRaw.mockResolvedValue([]);
    expect(await repo.findMarketplaceProfileByUserId('missing')).toBeNull();
  });

  it('uses the caller transaction and preserves an empty category set', async () => {
    const { client, repo } = setup();
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'provider', categoryIds: [] }]) };
    expect(await repo.findMarketplaceProfileByUserId('owner', tx as unknown as PrismaTx)).toEqual({
      id: 'provider',
      serviceCategories: [],
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });

  it('binds an adversarial identity and fails closed when the read fails', async () => {
    const { client, repo } = setup();
    const identity = "owner' OR TRUE --";
    const failure = new Error('unavailable');
    client.$queryRaw.mockRejectedValue(failure);
    await expect(repo.findMarketplaceProfileByUserId(identity)).rejects.toBe(failure);
    const query = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.text).not.toContain(identity);
    expect(query.values).toEqual([identity]);
  });
});
