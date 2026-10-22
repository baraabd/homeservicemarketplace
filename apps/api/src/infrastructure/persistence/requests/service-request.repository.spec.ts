import type { Prisma, PrismaTx, ServiceCategory } from '@homeservicemarketplace/database';
import type { PrismaService } from '../../prisma/prisma.service';
import { ServiceRequestRepository } from './service-request.repository';

const category: ServiceCategory = {
  id: 'category-a',
  slug: 'plumbing',
  labelEn: 'Plumbing',
  labelAr: 'سباكة',
  icon: 'wrench',
  sortOrder: 0,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  deletedAt: null,
  parentId: null,
  isLeaf: true,
};

describe('seeker page category and bid counts', () => {
  function setup() {
    const client = { serviceRequest: { findMany: jest.fn() }, $queryRaw: jest.fn() };
    return { client, repo: new ServiceRequestRepository({ client } as unknown as PrismaService) };
  }

  it('counts only authorized page IDs, preserves ordering and returns zero for no visible bids', async () => {
    const { client, repo } = setup();
    client.serviceRequest.findMany.mockResolvedValue([
      { id: 'owned-a', categoryId: category.id },
      { id: 'owned-b', categoryId: null },
    ]);
    // SQL result order deliberately differs from the authorized page order.
    client.$queryRaw.mockResolvedValue([
      { requestId: 'owned-b', id: null, bidsCount: 0n },
      { requestId: 'owned-a', ...category, bidsCount: 2n },
    ]);
    const rows = await repo.listForSeeker({
      seekerUserId: 'owner',
      take: 2,
      cursor: 'prior',
      status: 'OPEN_FOR_BIDS',
    });
    expect(rows.map((r) => [r.id, r._count?.bids])).toEqual([
      ['owned-a', 2],
      ['owned-b', 0],
    ]);
    expect(rows[0].category).toEqual(category);
    expect(rows[1].category).toBeNull();
    expect(client.serviceRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { seekerUserId: 'owner', deletedAt: null, status: 'OPEN_FOR_BIDS' },
        take: 2,
        cursor: { id: 'prior' },
        skip: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          bookings: {
            where: { deletedAt: null },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { id: true, status: true, updatedAt: true },
          },
        },
      }),
    );
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    const query = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toEqual(['owned-a', category.id, 'owned-b', null]);
    expect(query.text).toContain('bid."requestId" = page."requestId"');
    expect(query.text).toContain('bid."deletedAt" IS NULL');
    expect(query.text).toContain("bid.status <> 'WITHDRAWN'");
  });

  it('does not scan bids or categories for an empty or unauthorized page', async () => {
    const { client, repo } = setup();
    client.serviceRequest.findMany.mockResolvedValue([]);
    expect(await repo.listForSeeker({ seekerUserId: 'other', take: 20 })).toEqual([]);
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses the supplied transaction for the page and enrichment, never the global connection', async () => {
    const { client, repo } = setup();
    const tx = {
      serviceRequest: {
        findMany: jest.fn().mockResolvedValue([{ id: 'tx-row', categoryId: null }]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ requestId: 'tx-row', id: null, bidsCount: 0n }]),
    };
    const rows = await repo.listForSeeker(
      { seekerUserId: 'owner', take: 1 },
      tx as unknown as PrismaTx,
    );
    expect(rows[0]._count?.bids).toBe(0);
    expect(tx.serviceRequest.findMany).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(client.serviceRequest.findMany).not.toHaveBeenCalled();
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });

  it('binds page identities as data and propagates enrichment failure instead of a false zero', async () => {
    const { client, repo } = setup();
    const id = "page' OR TRUE --";
    client.serviceRequest.findMany.mockResolvedValue([{ id, categoryId: null }]);
    const failure = new Error('unavailable');
    client.$queryRaw.mockRejectedValue(failure);
    await expect(repo.listForSeeker({ seekerUserId: 'owner', take: 1 })).rejects.toBe(failure);
    const query = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.text).not.toContain(id);
    expect(query.values).toEqual([id, null]);
  });
});
