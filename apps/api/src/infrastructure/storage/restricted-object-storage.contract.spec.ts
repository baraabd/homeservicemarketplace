import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';

import { LocalDiskRestrictedStorageAdapter } from './local-disk-restricted-storage.adapter';
import { S3RestrictedStorageAdapter } from './s3-restricted-storage.adapter';
import type { RestrictedObjectStoragePort } from './restricted-object-storage.port';

// Sprint 9B.3 — ONE behavioural contract, asserted against BOTH backends.
//
// This file exists because Sprint 9A's restricted read worked only on local
// disk: it injected LocalDiskStorageAdapter and resolved a filesystem path,
// which has no meaning when STORAGE_DRIVER=s3. The bug was invisible because
// every test ran on the local backend. So the fix is not just a port — it is a
// suite that runs the same expectations twice, and would have failed on the S3
// side from the day the defect was introduced.
//
// The S3 side drives the REAL command objects (PutObjectCommand and friends)
// against an in-memory transport, substituted through the adapter's
// `createClient` seam. That keeps the assertions about this adapter's
// behaviour rather than about a mock's.

const KEY = 'verification/case-1/asset-1.pdf';
const BYTES = Buffer.from('%PDF-1.4 hello');

function configStub(over: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'public-bucket',
    S3_RESTRICTED_BUCKET: 'restricted-bucket',
    ...over,
  };
  return { get: (k: string) => values[k] } as never;
}

/** A minimal in-memory S3 that understands the four commands this port uses. */
function fakeS3(): { client: S3Client; objects: Map<string, Buffer>; fail?: boolean } {
  const objects = new Map<string, Buffer>();
  const state = { fail: false };
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = command.constructor.name;
      const key = command.input.Key as string;
      if (state.fail) {
        throw Object.assign(new Error('boom'), {
          name: 'InternalError',
          $metadata: { httpStatusCode: 500 },
          // A realistic backend error carries the bucket. The adapter must not
          // let it reach a caller.
          message: 'AccessDenied for bucket restricted-bucket with key AKIAsecret',
        });
      }
      if (name === 'PutObjectCommand') {
        const body = command.input.Body as Readable;
        const chunks: Buffer[] = [];
        for await (const c of body) chunks.push(Buffer.from(c as Buffer));
        objects.set(key, Buffer.concat(chunks));
        return {};
      }
      if (name === 'HeadObjectCommand') {
        const found = objects.get(key);
        if (!found) throw Object.assign(new Error('nope'), { name: 'NotFound' });
        return { ContentLength: found.length };
      }
      if (name === 'GetObjectCommand') {
        const found = objects.get(key);
        if (!found) throw Object.assign(new Error('nope'), { name: 'NoSuchKey' });
        return { Body: Readable.from([found]) };
      }
      if (name === 'DeleteObjectCommand') {
        objects.delete(key);
        return {};
      }
      throw new Error(`unexpected command ${name}`);
    },
  } as unknown as S3Client;
  return {
    client,
    objects,
    get fail() {
      return state.fail;
    },
    set fail(v: boolean) {
      state.fail = v;
    },
  } as never;
}

class FakeS3RestrictedAdapter extends S3RestrictedStorageAdapter {
  constructor(
    config: never,
    private readonly injected: S3Client,
  ) {
    super(config);
    // The base constructor already called createClient(); rebind to the fake.
    (this as unknown as { client: S3Client }).client = this.injected;
  }
  protected createClient(): S3Client {
    // Called during super() before `injected` is assigned, so return a stub
    // the constructor immediately replaces.
    return {} as S3Client;
  }
}

async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

interface Backend {
  name: string;
  make: () => { port: RestrictedObjectStoragePort; cleanup: () => void; failNext: () => void };
  stage: (bytes: Buffer) => string;
}

const tmpRoots: string[] = [];
function stagingFile(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'hsm-stage-'));
  tmpRoots.push(dir);
  const p = join(dir, 'staged.bin');
  writeFileSync(p, bytes);
  return p;
}

const BACKENDS: Backend[] = [
  {
    name: 'local disk',
    make: () => {
      const root = mkdtempSync(join(tmpdir(), 'hsm-restricted-'));
      tmpRoots.push(root);
      const port = new LocalDiskRestrictedStorageAdapter(
        configStub({ RESTRICTED_STORAGE_DIR: root }),
      );
      return {
        port,
        cleanup: () => rmSync(root, { recursive: true, force: true }),
        failNext: () => {
          // Make the root unusable by replacing it with a file, so a write
          // must fail the way a real backend outage would.
          rmSync(root, { recursive: true, force: true });
          writeFileSync(root, 'not a directory');
        },
      };
    },
    stage: stagingFile,
  },
  {
    name: 's3-compatible',
    make: () => {
      const fake = fakeS3();
      const port = new FakeS3RestrictedAdapter(configStub() as never, fake.client);
      return {
        port,
        cleanup: () => undefined,
        failNext: () => {
          (fake as unknown as { fail: boolean }).fail = true;
        },
      };
    },
    stage: stagingFile,
  },
];

afterAll(() => {
  for (const p of tmpRoots) rmSync(p, { recursive: true, force: true });
});

describe.each(BACKENDS)('$name restricted object storage', (backend) => {
  it('stores a complete object and reads it back byte-for-byte', async () => {
    const { port, cleanup } = backend.make();
    await port.putObjectFromFile({
      key: KEY,
      sourcePath: backend.stage(BYTES),
      contentType: 'application/pdf',
      sizeBytes: BYTES.length,
    });

    expect(await drain(await port.openReadStream(KEY))).toEqual(BYTES);
    cleanup();
  });

  it('reports trusted metadata through head', async () => {
    const { port, cleanup } = backend.make();
    await port.putObjectFromFile({
      key: KEY,
      sourcePath: backend.stage(BYTES),
      contentType: 'application/pdf',
      sizeBytes: BYTES.length,
    });

    await expect(port.head(KEY)).resolves.toEqual({ sizeBytes: BYTES.length });
    cleanup();
  });

  it('returns null from head for a missing object rather than throwing', async () => {
    // "Missing" is an ordinary answer during finalize, not an exception.
    const { port, cleanup } = backend.make();
    await expect(port.head('verification/case-1/never-written.pdf')).resolves.toBeNull();
    cleanup();
  });

  it('throws when reading a missing object', async () => {
    const { port, cleanup } = backend.make();
    await expect(port.openReadStream('verification/case-1/gone.pdf')).rejects.toBeDefined();
    cleanup();
  });

  it('deletes an object', async () => {
    const { port, cleanup } = backend.make();
    await port.putObjectFromFile({
      key: KEY,
      sourcePath: backend.stage(BYTES),
      contentType: 'application/pdf',
      sizeBytes: BYTES.length,
    });
    await port.deleteObject(KEY);
    await expect(port.head(KEY)).resolves.toBeNull();
    cleanup();
  });

  it('treats deleting a missing object as success', async () => {
    // Cleanup runs on failure paths, where "never created" and "now removed"
    // are the same desired end state. Throwing would turn a successful
    // rollback into a second error.
    const { port, cleanup } = backend.make();
    await expect(port.deleteObject('verification/case-1/absent.pdf')).resolves.toBeUndefined();
    cleanup();
  });

  it('refuses a traversal key', async () => {
    const { port, cleanup } = backend.make();
    await expect(port.head('verification/../../etc/passwd')).rejects.toBeDefined();
    cleanup();
  });

  it.each(['/verification/abs.pdf', 'verification/nul .pdf', 'verification/./dot.pdf'])(
    'refuses the malformed key %p',
    async (badKey) => {
      const { port, cleanup } = backend.make();
      await expect(port.head(badKey)).rejects.toBeDefined();
      cleanup();
    },
  );

  it('preserves the restricted namespace in the stored key', async () => {
    const { port, cleanup } = backend.make();
    await port.putObjectFromFile({
      key: KEY,
      sourcePath: backend.stage(BYTES),
      contentType: 'application/pdf',
      sizeBytes: BYTES.length,
    });
    // Readable under the exact restricted key, and nothing else.
    await expect(port.head(KEY)).resolves.not.toBeNull();
    await expect(port.head('case-1/asset-1.pdf')).resolves.toBeNull();
    cleanup();
  });

  it('does not leak bucket names, keys or credentials in a backend error', async () => {
    const { port, cleanup, failNext } = backend.make();
    failNext();
    const err = await port
      .putObjectFromFile({
        key: KEY,
        sourcePath: backend.stage(BYTES),
        contentType: 'application/pdf',
        sizeBytes: BYTES.length,
      })
      .then(() => null)
      .catch((e: Error) => e);

    // Shape, not `instanceof`: fs and the AWS SDK construct errors in their own
    // module realms, so a constructor-identity check compares two different
    // `Error` classes and fails for a reason that has nothing to do with the
    // property under test. What matters is that it threw, and what the text
    // contains.
    expect(err).not.toBeNull();
    expect(typeof (err as Error).message).toBe('string');
    const text = `${(err as Error).message} ${(err as Error).stack ?? ''}`;
    expect(text).not.toContain('restricted-bucket');
    expect(text).not.toContain('AKIAsecret');
    cleanup();
  });
});

describe('restricted code never depends on the local adapter directly', () => {
  // The Sprint 9A defect, as a guardrail. evidence-read.controller.ts imported
  // LocalDiskStorageAdapter and called absolutePathForKey(), which has no
  // meaning under STORAGE_DRIVER=s3 — restricted reads were broken in every
  // production configuration and no test noticed, because every test ran local.
  it('no file under provider/verification imports LocalDiskStorageAdapter', () => {
    const root = join(__dirname, '..', '..', 'modules', 'provider', 'verification');

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        for (const line of readFileSync(full, 'utf8').split('\n')) {
          const trimmed = line.trim();
          const isImport = trimmed.startsWith('import ') || trimmed.startsWith('} from ');
          if (isImport && line.includes('LocalDiskStorageAdapter')) offenders.push(full);
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});
