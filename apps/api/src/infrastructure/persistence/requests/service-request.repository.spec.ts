import type { PrismaTx } from '@homeservicemarketplace/database';
import type { PrismaService } from '../../prisma/prisma.service';
import { ServiceRequestRepository } from './service-request.repository';

describe('seeker page bid counts', () => {
  function setup() {
    const client = { serviceRequest: { findMany: jest.fn() }, bid: { groupBy: jest.fn() } };
    return { client, repo: new ServiceRequestRepository({ client } as unknown as PrismaService) };
  }

  it('counts only authorized page IDs, preserves ordering and returns zero for no visible bids', async () => {
    const { client, repo } = setup();
    client.serviceRequest.findMany.mockResolvedValue([{ id: 'owned-a' }, { id: 'owned-b' }]);
    client.bid.groupBy.mockResolvedValue([{ requestId: 'owned-a', _count: { _all: 2 } }]);
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
      }),
    );
    expect(client.bid.groupBy).toHaveBeenCalledTimes(1);
    expect(client.bid.groupBy).toHaveBeenCalledWith({
      by: ['requestId'],
      where: {
        requestId: { in: ['owned-a', 'owned-b'] },
        deletedAt: null,
        status: { not: 'WITHDRAWN' },
      },
      _count: { _all: true },
    });
  });

  it('does not scan bids for an empty or unauthorized page', async () => {
    const { client, repo } = setup();
    client.serviceRequest.findMany.mockResolvedValue([]);
    expect(await repo.listForSeeker({ seekerUserId: 'other', take: 20 })).toEqual([]);
    expect(client.bid.groupBy).not.toHaveBeenCalled();
  });

  it('uses the supplied transaction for both the page and count, never the global connection', async () => {
    const { client, repo } = setup();
    const tx = {
      serviceRequest: { findMany: jest.fn().mockResolvedValue([{ id: 'tx-row' }]) },
      bid: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const rows = await repo.listForSeeker(
      { seekerUserId: 'owner', take: 1 },
      tx as unknown as PrismaTx,
    );
    expect(rows[0]._count?.bids).toBe(0);
    expect(tx.serviceRequest.findMany).toHaveBeenCalledTimes(1);
    expect(tx.bid.groupBy).toHaveBeenCalledTimes(1);
    expect(client.serviceRequest.findMany).not.toHaveBeenCalled();
    expect(client.bid.groupBy).not.toHaveBeenCalled();
  });
});
