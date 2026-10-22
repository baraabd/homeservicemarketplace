import type { Prisma, PrismaTx } from '@homeservicemarketplace/database';
import type { PrismaService } from '../../prisma/prisma.service';
import { ServiceRequestRepository } from './service-request.repository';

describe('seeker page booking and bid projections', () => {
  function setup() {
    const client = { serviceRequest: { findMany: jest.fn() }, $queryRaw: jest.fn() };
    return { client, repo: new ServiceRequestRepository({ client } as unknown as PrismaService) };
  }

  it('counts only authorized page IDs, preserves ordering and returns zero for no visible bids', async () => {
    const { client, repo } = setup();
    client.serviceRequest.findMany.mockResolvedValue([{ id: 'owned-a' }, { id: 'owned-b' }]);
    const updatedAt = new Date('2026-10-01T12:00:00Z');
    client.$queryRaw.mockResolvedValue([
      {
        requestId: 'owned-b',
        bidCount: 0n,
        bookingId: null,
        bookingStatus: null,
        bookingUpdatedAt: null,
      },
      {
        requestId: 'owned-a',
        bidCount: 2n,
        bookingId: 'latest',
        bookingStatus: 'IN_PROGRESS',
        bookingUpdatedAt: updatedAt,
      },
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
    expect(client.serviceRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { seekerUserId: 'owner', deletedAt: null, status: 'OPEN_FOR_BIDS' },
        take: 2,
        cursor: { id: 'prior' },
        skip: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { category: true },
      }),
    );
    expect(rows[0].bookings).toEqual([{ id: 'latest', status: 'IN_PROGRESS', updatedAt }]);
    expect(rows[1].bookings).toEqual([]);
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    const projection = client.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(projection.values).toEqual(['owned-a', 'owned-b']);
    expect(projection.sql).toContain('bid."requestId" = page."requestId"');
    expect(projection.sql).toContain('bid."deletedAt" IS NULL');
    expect(projection.sql).toContain('bid."status" <> \'WITHDRAWN\'');
    expect(projection.sql).toContain('booking."deletedAt" IS NULL');
    expect(projection.sql).toContain('ORDER BY booking."updatedAt" DESC, booking."id" DESC');
  });

  it('does not scan bids for an empty or unauthorized page', async () => {
    const { client, repo } = setup();
    client.serviceRequest.findMany.mockResolvedValue([]);
    expect(await repo.listForSeeker({ seekerUserId: 'other', take: 20 })).toEqual([]);
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses the supplied transaction for both the page and enrichment, never the global connection', async () => {
    const { client, repo } = setup();
    const tx = {
      serviceRequest: { findMany: jest.fn().mockResolvedValue([{ id: 'tx-row' }]) },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          requestId: 'tx-row',
          bidCount: 0n,
          bookingId: null,
          bookingStatus: null,
          bookingUpdatedAt: null,
        },
      ]),
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
});
