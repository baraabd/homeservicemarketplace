import { createIsolatedDatabase } from './isolated-database';

const mockEvents: string[] = [];
let mockMigrationError: Error | null = null;
const mockAdmin = {
  $executeRawUnsafe: jest.fn(async (sql: string) => {
    mockEvents.push(sql);
    return 0;
  }),
  $disconnect: jest.fn(async () => {
    mockEvents.push('admin-disconnected');
  }),
};
const mockClient = {
  $disconnect: jest.fn(async () => {
    mockEvents.push('client-disconnected');
  }),
};
const mockConstructor = jest.fn();

jest.mock('@homeservicemarketplace/database', () => ({
  PrismaClient: jest.fn((...args: unknown[]) => mockConstructor(...args)),
}));
jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    mockEvents.push('migration');
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
    callback(mockMigrationError, '', '');
  },
}));

describe('isolated database cleanup boundaries', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env.RUN_DB_INTEGRATION = '1';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://fixture:fixture@localhost:5432/bootstrap';
    mockEvents.length = 0;
    mockMigrationError = null;
    mockConstructor.mockReset().mockReturnValueOnce(mockAdmin).mockReturnValue(mockClient);
    mockAdmin.$executeRawUnsafe.mockReset().mockImplementation(async (sql: string) => {
      mockEvents.push(sql);
      return 0;
    });
    mockAdmin.$disconnect.mockClear();
    mockClient.$disconnect.mockClear();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env))
      if (!(key in originalEnvironment)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  });

  function createdName(): string {
    const statement = mockAdmin.$executeRawUnsafe.mock.calls[0][0];
    const match = /^CREATE DATABASE "(hsm_it_cleanup_[a-f0-9]{32})"$/.exec(statement);
    expect(match).not.toBeNull();
    return match![1];
  }

  it('disconnects its client before dropping only the database it created without FORCE', async () => {
    const fixture = await createIsolatedDatabase('cleanup');
    const name = createdName();
    await fixture.dispose();
    expect(mockEvents).toEqual([
      `CREATE DATABASE "${name}"`,
      'admin-disconnected',
      'migration',
      'client-disconnected',
      `DROP DATABASE "${name}"`,
      'admin-disconnected',
    ]);
  });

  it('does not terminate leaked sessions or suppress a refused drop, and can retry cleanup', async () => {
    const fixture = await createIsolatedDatabase('cleanup');
    const name = createdName();
    const busy = new Error('database is still used by a client');
    mockAdmin.$executeRawUnsafe.mockRejectedValueOnce(busy);
    await expect(fixture.dispose()).rejects.toBe(busy);
    expect(mockAdmin.$executeRawUnsafe).toHaveBeenLastCalledWith(`DROP DATABASE "${name}"`);
    expect(mockAdmin.$disconnect).toHaveBeenCalledTimes(2);
    await fixture.dispose();
    expect(mockAdmin.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    await fixture.dispose();
    expect(mockAdmin.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it('cleans up its created database when migration fails', async () => {
    mockMigrationError = new Error('migration failed');
    await expect(createIsolatedDatabase('cleanup')).rejects.toBe(mockMigrationError);
    expect(mockAdmin.$executeRawUnsafe).toHaveBeenLastCalledWith(
      `DROP DATABASE "${createdName()}"`,
    );
    expect(mockClient.$disconnect).not.toHaveBeenCalled();
    expect(mockAdmin.$disconnect).toHaveBeenCalledTimes(2);
  });

  it('never drops a database when creation failed', async () => {
    const denied = new Error('creation denied');
    mockAdmin.$executeRawUnsafe.mockRejectedValueOnce(denied);
    await expect(createIsolatedDatabase('cleanup')).rejects.toBe(denied);
    expect(mockAdmin.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(mockEvents).not.toContain('migration');
  });

  it('retains both migration and cleanup failures', async () => {
    mockMigrationError = new Error('migration failed');
    const cleanupError = new Error('cleanup denied');
    mockAdmin.$executeRawUnsafe.mockResolvedValueOnce(0).mockRejectedValueOnce(cleanupError);
    try {
      await createIsolatedDatabase('cleanup');
      throw new Error('Expected setup to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([mockMigrationError, cleanupError]);
    }
  });

  it.each([
    { RUN_DB_INTEGRATION: '0', NODE_ENV: 'test' },
    { RUN_DB_INTEGRATION: '1', NODE_ENV: 'production' },
  ])('refuses unapproved environments: %j', async (environment) => {
    Object.assign(process.env, environment);
    await expect(createIsolatedDatabase('cleanup')).rejects.toThrow('non-production');
    expect(mockConstructor).not.toHaveBeenCalled();
  });
});
