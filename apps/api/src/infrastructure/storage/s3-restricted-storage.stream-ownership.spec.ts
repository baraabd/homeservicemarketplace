import { promises as fsp } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';

import { S3RestrictedStorageAdapter } from './s3-restricted-storage.adapter';

// Sprint 9B.3 — who owns the file stream when the upload fails.
//
// This is a regression test for a defect that did not fail in the suite that
// caused it. `putObjectFromFile` built its `Body` inline:
//
//     Body: createReadStream(input.sourcePath)
//
// `createReadStream` schedules its open() immediately, so the stream is going
// to touch the file whether or not anybody reads it. When `send()` REJECTS
// before consuming the body — a backend outage, which the contract suite
// deliberately simulates — that stream is orphaned: never consumed, never
// destroyed, and carrying no 'error' listener.
//
// The contract suite then removes its staging directory in afterAll. The
// orphaned open() lands on a file that no longer exists, emits 'error' with
// ENOENT, and an 'error' event with no listener is an uncaught exception. It
// does not fail the suite that created it, because by then that suite is over.
// It fails whatever happens to be running.
//
// In CI it surfaced as:
//
//     FAIL test/e2e/admin-verification.e2e.spec.ts
//     ENOENT: no such file or directory, open '/tmp/hsm-stage-.../staged.bin'
//
// — an admin authentication suite blamed for a storage adapter's stream. The
// two assertions below pin the fix from both ends: the stream is settled
// deterministically, and deleting the staging directory afterwards produces no
// uncaught error.

/**
 * An S3 whose send() always rejects BEFORE touching the command body.
 *
 * It records the Body it was handed first, which is the stream the adapter
 * owns. Capturing it here rather than by spying on node:fs keeps the test on
 * the same seam the adapter actually uses.
 */
function alwaysFailingClient(captured?: { body?: unknown }): S3Client {
  return {
    async send(command: { input?: Record<string, unknown> }) {
      if (captured) captured.body = command?.input?.Body;
      throw Object.assign(new Error('boom'), {
        name: 'InternalError',
        $metadata: { httpStatusCode: 500 },
        message: 'AccessDenied for bucket restricted-bucket with key AKIAsecret',
      });
    },
  } as unknown as S3Client;
}

function configStub() {
  const values: Record<string, unknown> = {
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'public-bucket',
    S3_RESTRICTED_BUCKET: 'restricted-bucket',
  };
  return { get: (k: string) => values[k] } as never;
}

class FakeS3RestrictedAdapter extends S3RestrictedStorageAdapter {
  constructor(
    config: never,
    private readonly injected: S3Client,
  ) {
    super(config);
    (this as unknown as { client: S3Client }).client = this.injected;
  }
  protected createClient(): S3Client {
    return {} as S3Client;
  }
}

/**
 * Let every pending fs operation land.
 *
 * Not a sleep: the awaited `stat` is a real round trip through libuv's thread
 * pool, so when it resolves any open() queued before it has already completed
 * or failed. The setImmediate turns then let the resulting 'error' event be
 * delivered. A fixed delay would be guesswork; this is a barrier.
 */
async function settleFilesystem(): Promise<void> {
  await fsp.stat(tmpdir()).catch(() => undefined);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

describe('S3RestrictedStorageAdapter — source stream ownership', () => {
  const roots: string[] = [];

  function stage(bytes: Buffer): string {
    const dir = mkdtempSync(join(tmpdir(), 'hsm-stage-own-'));
    roots.push(dir);
    const p = join(dir, 'staged.bin');
    writeFileSync(p, bytes);
    return p;
  }

  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('destroys the source stream when the backend rejects before reading it', async () => {
    const captured: { body?: unknown } = {};
    const port = new FakeS3RestrictedAdapter(configStub(), alwaysFailingClient(captured));
    const sourcePath = stage(Buffer.from('%PDF-1.4 evidence'));

    await expect(
      port.putObjectFromFile({
        key: 'verification/case-1/asset-1.pdf',
        sourcePath,
        contentType: 'application/pdf',
        sizeBytes: 17,
      }),
    ).rejects.toBeDefined();

    // The body handed to the SDK is the stream the adapter opened. After a
    // rejected send it must be settled. Asserted synchronously after the
    // rejection, so this cannot pass merely by being slow.
    const body = captured.body as { destroyed?: boolean } | undefined;
    expect(body).toBeDefined();
    expect(body?.destroyed).toBe(true);
  });

  it('leaves no uncaught error when the staging directory is removed afterwards', async () => {
    const uncaught: Error[] = [];
    const onUncaught = (e: Error): void => {
      uncaught.push(e);
    };
    // With a listener attached, Node reports rather than aborts — so a
    // regression shows up as a failed assertion instead of killing the worker.
    process.on('uncaughtException', onUncaught);

    try {
      const port = new FakeS3RestrictedAdapter(configStub(), alwaysFailingClient());
      const sourcePath = stage(Buffer.from('%PDF-1.4 evidence'));

      await expect(
        port.putObjectFromFile({
          key: 'verification/case-1/asset-2.pdf',
          sourcePath,
          contentType: 'application/pdf',
          sizeBytes: 17,
        }),
      ).rejects.toBeDefined();

      // Exactly what the contract suite's afterAll does, and what turned an
      // orphaned stream into someone else's failure.
      rmSync(join(sourcePath, '..'), { recursive: true, force: true });
      await settleFilesystem();

      expect(uncaught.map((e) => e.message)).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });

  it('still reports a sanitised error, with no bucket, key or credential', async () => {
    // The ownership fix must not change what the caller is told.
    const port = new FakeS3RestrictedAdapter(configStub(), alwaysFailingClient());
    const sourcePath = stage(Buffer.from('%PDF-1.4 evidence'));

    const err = await port
      .putObjectFromFile({
        key: 'verification/case-1/asset-3.pdf',
        sourcePath,
        contentType: 'application/pdf',
        sizeBytes: 17,
      })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).not.toBeNull();
    const text = `${(err as Error).message} ${(err as Error).stack ?? ''}`;
    expect(text).not.toContain('restricted-bucket');
    expect(text).not.toContain('AKIAsecret');
    expect(text).not.toContain(sourcePath);
  });
});
