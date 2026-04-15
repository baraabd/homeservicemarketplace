import { PermissionRepository } from './permission.repository';

function mkClient() {
  return {
    permission: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

describe('PermissionRepository', () => {
  it('upsertByKey writes description on update and create branches', async () => {
    const client = mkClient();
    client.permission.upsert.mockResolvedValueOnce({ id: 'p', key: 'user:read:self' });
    const repo = new PermissionRepository({ client } as unknown as never);
    await repo.upsertByKey({ key: 'user:read:self', description: 'self read' });
    expect(client.permission.upsert).toHaveBeenCalledWith({
      where: { key: 'user:read:self' },
      update: { description: 'self read' },
      create: { key: 'user:read:self', description: 'self read' },
    });
  });

  it('listAll orders by key ascending', async () => {
    const client = mkClient();
    const repo = new PermissionRepository({ client } as unknown as never);
    await repo.listAll();
    expect(client.permission.findMany).toHaveBeenCalledWith({ orderBy: { key: 'asc' } });
  });
});
