import { UserRepository } from './user.repository';
import type { PrismaService } from '../../prisma/prisma.service';

function mkClient() {
  return {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userRole: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

function mkRepo(client = mkClient()) {
  const prisma = { client } as unknown as PrismaService;
  return { repo: new UserRepository(prisma), client };
}

describe('UserRepository', () => {
  it('findById excludes soft-deleted users', async () => {
    const { repo, client } = mkRepo();
    client.user.findFirst.mockResolvedValueOnce({ id: 'u1' });
    await repo.findById('u1');
    expect(client.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u1', deletedAt: null },
    });
  });

  it('findByEmail excludes soft-deleted users', async () => {
    const { repo, client } = mkRepo();
    await repo.findByEmail('a@b.com');
    expect(client.user.findFirst).toHaveBeenCalledWith({
      where: { email: 'a@b.com', deletedAt: null },
    });
  });

  it('list clamps take to [1, 200] and filters deleted', async () => {
    const { repo, client } = mkRepo();
    await repo.list({ take: 9999 });
    const arg = client.user.findMany.mock.calls[0][0];
    expect(arg.take).toBe(200);
    expect(arg.where).toEqual({ deletedAt: null });
  });

  it('list with cursor sets skip:1', async () => {
    const { repo, client } = mkRepo();
    await repo.list({ cursor: 'abc' });
    const arg = client.user.findMany.mock.calls[0][0];
    expect(arg.cursor).toEqual({ id: 'abc' });
    expect(arg.skip).toBe(1);
  });

  it('list uses compound orderBy [createdAt desc, id desc] so cursor-by-id is deterministic', async () => {
    // Regression: a prior version used `orderBy: { createdAt: "desc" }` alone,
    // which breaks cursor pagination when two rows share the same createdAt
    // (Prisma may skip or duplicate rows on the page boundary).
    const { repo, client } = mkRepo();
    await repo.list({ cursor: 'abc' });
    const arg = client.user.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('update refuses to target soft-deleted rows (deletedAt:null filter on where)', async () => {
    const { repo, client } = mkRepo();
    await repo.update('u1', { firstName: 'x' });
    const call = client.user.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'u1', deletedAt: null });
  });

  it('softDelete sets deletedAt and isActive=false', async () => {
    const { repo, client } = mkRepo();
    await repo.softDelete('u1');
    const call = client.user.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'u1' });
    expect(call.data.isActive).toBe(false);
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it('assignRole upserts the join row', async () => {
    const { repo, client } = mkRepo();
    client.userRole.upsert.mockResolvedValueOnce({});
    await repo.assignRole('u1', 'r1');
    expect(client.userRole.upsert).toHaveBeenCalledWith({
      where: { userId_roleId: { userId: 'u1', roleId: 'r1' } },
      update: {},
      create: { userId: 'u1', roleId: 'r1' },
    });
  });

  it('uses the supplied transaction client when provided', async () => {
    const { repo, client } = mkRepo();
    const tx = mkClient();
    await repo.findById('u1', tx as never);
    expect(tx.user.findFirst).toHaveBeenCalled();
    expect(client.user.findFirst).not.toHaveBeenCalled();
  });
});
