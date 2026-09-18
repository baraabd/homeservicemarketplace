import type { PrismaTx } from '@homeservicemarketplace/database';
import { seedPrimarySpecialty } from './primary-specialty-default';

const category = (id: string, sortOrder = 0, extra = {}) => ({
  id,
  sortOrder,
  isLeaf: true,
  isActive: true,
  deletedAt: null,
  slug: id,
  labelEn: id,
  labelAr: id,
  ...extra,
});

function fixture(profile: unknown, count = 1) {
  const findUnique = jest.fn().mockResolvedValue(profile);
  const updateMany = jest.fn().mockResolvedValue({ count });
  const db = { providerProfile: { findUnique, updateMany } } as unknown as PrismaTx;
  return { db, findUnique, updateMany };
}

const empty = { primaryServiceCategoryId: null, serviceCategories: [], categoryApplications: [] };

describe('server-owned primary specialty default', () => {
  it('uses a live pending selection without approving it', async () => {
    const painting = category('painting');
    const f = fixture({ ...empty, categoryApplications: [{ serviceCategory: painting }] });
    await expect(seedPrimarySpecialty(f.db, 'provider')).resolves.toEqual(painting);
    expect(f.updateMany.mock.calls[0][0].data).toEqual({ primaryServiceCategoryId: 'painting' });
  });

  it('requests only non-superseded pending applications', async () => {
    const f = fixture(empty);
    await seedPrimarySpecialty(f.db, 'provider');
    expect(f.findUnique.mock.calls[0][0].select.categoryApplications.where).toEqual({
      status: 'PENDING',
      supersededAt: null,
    });
  });

  it('does not replace an explicit primary', async () => {
    const f = fixture({ ...empty, primaryServiceCategoryId: 'chosen' });
    await expect(seedPrimarySpecialty(f.db, 'provider')).resolves.toBeNull();
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it.each([null, empty])('does not invent a selection for %p', async (profile) => {
    const f = fixture(profile);
    await expect(seedPrimarySpecialty(f.db, 'provider')).resolves.toBeNull();
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { isLeaf: false },
    { isActive: false },
    { deletedAt: new Date('2026-01-01') },
  ])('does not default to an ineligible category: %p', async (extra) => {
    const f = fixture({
      ...empty,
      categoryApplications: [{ serviceCategory: category('excluded', 0, extra) }],
    });
    await expect(seedPrimarySpecialty(f.db, 'provider')).resolves.toBeNull();
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it('uses stable catalogue order for approved and pending selections', async () => {
    const first = category('a', 1);
    const f = fixture({
      ...empty,
      serviceCategories: [{ serviceCategory: category('z', 5) }],
      categoryApplications: [{ serviceCategory: category('b', 1) }, { serviceCategory: first }],
    });
    await expect(seedPrimarySpecialty(f.db, 'provider')).resolves.toEqual(first);
  });

  it('does not claim a write when a concurrent change wins', async () => {
    const f = fixture({
      ...empty,
      categoryApplications: [{ serviceCategory: category('painting') }],
    }, 0);
    await expect(seedPrimarySpecialty(f.db, 'provider')).resolves.toBeNull();
    expect(f.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'provider', primaryServiceCategoryId: null,
      OR: [
        { serviceCategories: { some: { serviceCategoryId: 'painting' } } },
        { categoryApplications: { some: {
          serviceCategoryId: 'painting', status: 'PENDING', supersededAt: null,
          serviceCategory: { isLeaf: true, isActive: true, deletedAt: null },
        } } },
      ],
    });
  });
});
