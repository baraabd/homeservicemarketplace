import { RoleRepository } from './role.repository';

function mkClient() {
  return {
    role: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    rolePermission: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('RoleRepository', () => {
  it('findByName ignores soft-deleted roles', async () => {
    const client = mkClient();
    const repo = new RoleRepository({ client } as unknown as never);
    await repo.findByName('admin');
    expect(client.role.findFirst).toHaveBeenCalledWith({
      where: { name: 'admin', deletedAt: null },
    });
  });

  it('attachPermission upserts and ignores existing rows', async () => {
    const client = mkClient();
    client.rolePermission.upsert.mockResolvedValueOnce({});
    const repo = new RoleRepository({ client } as unknown as never);
    await repo.attachPermission('r1', 'p1');
    expect(client.rolePermission.upsert).toHaveBeenCalledWith({
      where: { roleId_permissionId: { roleId: 'r1', permissionId: 'p1' } },
      update: {},
      create: { roleId: 'r1', permissionId: 'p1' },
    });
  });

  it('update refuses to target soft-deleted rows (deletedAt:null filter on where)', async () => {
    const client = mkClient();
    const repo = new RoleRepository({ client } as unknown as never);
    await repo.update('r1', { description: 'x' });
    const call = client.role.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'r1', deletedAt: null });
  });

  it('softDelete writes deletedAt timestamp', async () => {
    const client = mkClient();
    const repo = new RoleRepository({ client } as unknown as never);
    await repo.softDelete('r1');
    const call = client.role.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'r1' });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });
});
