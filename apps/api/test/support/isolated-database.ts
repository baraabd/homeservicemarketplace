/* eslint-disable @typescript-eslint/no-require-imports -- Load Prisma only in DB-gated setup. */
import type { PrismaClient } from '@homeservicemarketplace/database';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

export interface IsolatedDatabase {
  prisma: PrismaClient;
  dispose(): Promise<void>;
}

/**
 * Whole-table tests need a database boundary: rollback hides their writes,
 * but their row locks still block unrelated suites. Apply the real migrations
 * to a new database, without changing DATABASE_URL or the application singleton.
 * Only the generated database successfully created here can ever be dropped.
 */
export async function createIsolatedDatabase(suite: string): Promise<IsolatedDatabase> {
  if (process.env.RUN_DB_INTEGRATION !== '1' || process.env.NODE_ENV === 'production') {
    throw new Error('Isolated databases require the non-production DB integration gate.');
  }
  if (!/^[a-z][a-z0-9_]{0,19}$/.test(suite)) {
    throw new Error('Use a short lowercase identifier for the isolated database suite.');
  }
  if (!process.env.DATABASE_URL) throw new Error('Isolated databases require DATABASE_URL.');

  const db =
    require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
  const name = `hsm_it_${suite}_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(process.env.DATABASE_URL);
  adminUrl.searchParams.set('connection_limit', '1');
  const targetUrl = new URL(process.env.DATABASE_URL);
  targetUrl.pathname = `/${name}`;
  targetUrl.searchParams.set('schema', 'public');
  targetUrl.searchParams.set('connection_limit', '5');
  const admin = new db.PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  let prisma: PrismaClient | undefined;
  let created = false;

  async function dispose(): Promise<void> {
    try {
      await prisma?.$disconnect();
    } finally {
      try {
        if (created) {
          await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
          created = false;
        }
      } finally {
        await admin.$disconnect();
      }
    }
  }

  try {
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created = true;
    } finally {
      await admin.$disconnect();
    }
    const databaseDir = path.resolve(__dirname, '../../../../packages/database');
    const prismaEntry = require.resolve('prisma/build/index.js', { paths: [databaseDir] });
    // Async spawning keeps timers/other connections live while migrations run.
    // Resolve the pinned CLI's JS entry so Windows needs no shell/.cmd shim.
    await promisify(execFile)(
      process.execPath,
      [
        prismaEntry,
        'migrate',
        'deploy',
        '--schema',
        path.join(databaseDir, 'prisma/schema.prisma'),
      ],
      { env: { ...process.env, DATABASE_URL: targetUrl.toString() }, timeout: 45_000 },
    );
    prisma = new db.PrismaClient({ datasources: { db: { url: targetUrl.toString() } } });
    return { prisma, dispose };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Isolated database setup and cleanup failed.',
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
