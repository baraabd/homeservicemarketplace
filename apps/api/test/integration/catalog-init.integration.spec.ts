import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@homeservicemarketplace/database';

const run = promisify(execFile);
const enabled = process.env.RUN_DB_INTEGRATION === '1';
(enabled ? describe : describe.skip)('catalog:init CLI on an isolated PostgreSQL schema', () => {
  jest.setTimeout(60_000);
  const schema = 'catalog_' + randomUUID().replaceAll('-', '');
  let original: PrismaClient;
  let isolated: PrismaClient;
  let url: URL;
  const cli = join(dirname(require.resolve('@homeservicemarketplace/database')), 'catalog-init.js');
  const slugs = ['plumbing', 'electrical', 'ac-repair', 'cleaning', 'carpentry', 'painting'];

  async function invoke(args: string[], allowWrite = false) {
    const { stdout } = await run(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: url.href,
        ALLOW_CATALOG_INIT: String(allowWrite),
      },
    });
    return JSON.parse(stdout) as { categories: { slug: string; state: string }[] };
  }

  beforeAll(async () => {
    url = new URL(process.env.DATABASE_URL!);
    original = new PrismaClient();
    // The test role owns this disposable schema. Only the category table
    // exists in it. Any attempt to seed identities or roles fails the test.
    await original.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await original.$executeRawUnsafe(
      `CREATE TABLE "${schema}"."ServiceCategory" (LIKE "ServiceCategory" INCLUDING ALL)`,
    );
    url.searchParams.set('schema', schema);
    isolated = new PrismaClient({ datasourceUrl: url.href });
  });

  afterAll(async () => {
    await isolated?.$disconnect();
    if (original) {
      await original.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await original.$disconnect();
    }
  });

  it('only previews by default and rejects ambiguous or unconfirmed writes', async () => {
    expect((await invoke([])).categories).toEqual(
      slugs.map((slug) => ({ slug, state: 'MISSING' })),
    );
    for (const args of [['--apply'], ['--aply', 'plumbing'], ['--apply', 'unknown']]) {
      await expect(invoke(args, true)).rejects.toThrow();
    }
    await expect(invoke(['--apply', 'plumbing'])).rejects.toThrow();
    expect(await isolated.serviceCategory.count()).toBe(0);
  });

  it('respects selection, preserves admin edits and stays idempotent under concurrent retries', async () => {
    expect((await invoke(['--apply', 'plumbing'], true)).categories).toEqual([
      { slug: 'plumbing', state: 'CREATED' },
    ]);
    const archived = await isolated.serviceCategory.update({
      where: { slug: 'plumbing' },
      data: { isActive: false, deletedAt: new Date(), labelAr: 'فئة مؤرشفة' },
    });
    const runs = await Promise.all([
      invoke(['--apply', ...slugs], true),
      invoke(['--apply', ...slugs], true),
    ]);
    expect(
      runs.flatMap((result) => result.categories).filter((row) => row.state === 'CREATED'),
    ).toHaveLength(5);
    expect(await isolated.serviceCategory.count()).toBe(6);
    expect(await isolated.serviceCategory.findUnique({ where: { slug: 'plumbing' } })).toEqual(
      archived,
    );
    const repeat = await invoke(['--apply', ...slugs], true);
    expect(repeat.categories.map((row) => row.state)).toEqual([
      'HIDDEN',
      'ACTIVE',
      'ACTIVE',
      'ACTIVE',
      'ACTIVE',
      'ACTIVE',
    ]);
  });
});
