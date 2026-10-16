/* eslint-disable @typescript-eslint/no-require-imports -- adapters and the AWS SDK load only inside the R20 real-storage gate. */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';

import {
  adapterConfig,
  sdk,
  anonymousGet,
  bucketName,
  client,
  createBucket,
  createPrincipal,
  destroyBucket,
  endpoint,
  headRaw,
  putRaw,
  r20Enabled,
  readAll,
  removePrincipal,
  versionsOf,
  type Credentials,
} from './r20-s3-fixture';

// R20 — the storage adapters against REAL S3-compatible storage (emulator
// evidence; see r20-s3-fixture.ts for what this does and does not prove).

const d = r20Enabled ? describe : describe.skip;
jest.setTimeout(120_000);

const REPO = resolve(__dirname, '../../../../..');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('r20-synthetic-png-body-only'),
]);
const PDF = Buffer.from('%PDF-1.4\nR20 synthetic restricted fixture only.\n%%EOF');

d('R20 storage adapters — real S3-compatible service', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let S3StorageAdapter: any;
  let S3RestrictedStorageAdapter: any;
  let ports: any;
  let diagnostics: any;
  let inventoryMod: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  let admin: S3Client;
  let stageDir: string;
  const PUB = bucketName('pub');
  const STAGE = bucketName('stage');
  const RESTR = bucketName('restr');
  const LOCKED = bucketName('locked');
  const RESTORED = bucketName('restored');
  const buckets = { public: PUB, staging: STAGE, restricted: RESTR };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const publicAdapter = (cfg = adapterConfig(buckets)): any => new S3StorageAdapter(cfg);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const restrictedAdapter = (cfg = adapterConfig(buckets)): any =>
    new S3RestrictedStorageAdapter(cfg);

  async function stage(body: Buffer): Promise<string> {
    const file = join(stageDir, `${randomUUID()}.bin`);
    await writeFile(file, body);
    return file;
  }

  type EvidenceWriter = {
    putObjectFromFile(input: {
      key: string;
      sourcePath: string;
      contentType: string;
      sizeBytes: number;
    }): Promise<void>;
  };

  async function putEvidence(adapter: EvidenceWriter, key: string, body = PDF) {
    await adapter.putObjectFromFile({
      key,
      sourcePath: await stage(body),
      contentType: 'application/pdf',
      sizeBytes: body.length,
    });
  }

  beforeAll(async () => {
    ({ S3StorageAdapter } = require('../../../src/infrastructure/storage/s3-storage.adapter'));
    ({
      S3RestrictedStorageAdapter,
    } = require('../../../src/infrastructure/storage/s3-restricted-storage.adapter'));
    ports = require('../../../src/infrastructure/storage/restricted-object-storage.port');
    diagnostics = require('../../../src/infrastructure/storage/storage-diagnostics');
    inventoryMod = require('../../../src/infrastructure/storage/storage-inventory');
    admin = client();
    stageDir = await mkdtemp(join(tmpdir(), 'hsm-r20-stage-'));
    await createBucket(admin, PUB, { versioning: true, marker: 'public' });
    await createBucket(admin, STAGE, { versioning: true, marker: 'portfolio-staging' });
    await createBucket(admin, RESTR, { versioning: true, marker: 'restricted' });
    await createBucket(admin, LOCKED, { objectLock: true, marker: 'restricted' });
    await createBucket(admin, RESTORED, { versioning: true });
  });

  afterAll(async () => {
    for (const b of [PUB, STAGE, RESTR, LOCKED, RESTORED]) await destroyBucket(admin, b);
    admin?.destroy();
    if (stageDir) await rm(stageDir, { recursive: true, force: true });
  });

  // ── 1. browser-direct upload contract (public namespace) ────────────────

  describe('presigned upload contract', () => {
    const requestKey = () => `requests/r20ref/${randomUUID()}.png`;
    const avatarKey = () => `avatars/r20ref/${randomUUID()}.png`;

    async function put(url: string, body: Buffer, headers: Record<string, string>) {
      const res = await fetch(url, { method: 'PUT', body, headers });
      await res.arrayBuffer();
      return res.status;
    }

    it('accepts the exact signed upload and the finalize read sees the real bytes', async () => {
      const key = requestKey();
      const adapter = publicAdapter();
      const presigned = await adapter.presignUpload({
        key,
        contentType: 'image/png',
        sizeBytes: PNG.length,
      });
      expect(presigned.uploadUrl).not.toContain(rootCredentialsSecretMarker());
      expect(
        await put(presigned.uploadUrl, PNG, { 'Content-Type': 'image/png', 'If-None-Match': '*' }),
      ).toBe(200);
      const head = await adapter.readObjectHead(key, 8);
      expect(head.sizeBytes).toBe(PNG.length);
      expect(Buffer.from(head.head)).toEqual(PNG.subarray(0, 8));
      expect(await readAll(await adapter.readObjectStream(key))).toEqual(PNG);
    });

    it('request attachments are write-once: a replayed signed PUT cannot replace verified bytes', async () => {
      const key = requestKey();
      const p = await publicAdapter().presignUpload({
        key,
        contentType: 'image/png',
        sizeBytes: PNG.length,
      });
      const headers = { 'Content-Type': 'image/png', 'If-None-Match': '*' };
      expect(await put(p.uploadUrl, PNG, headers)).toBe(200);
      const swapped = Buffer.from(PNG);
      swapped[PNG.length - 1] ^= 0xff;
      expect(await put(p.uploadUrl, swapped, headers)).toBe(412);
      // Dropping the precondition does not help: if-none-match is a SIGNED
      // header (MinIO answers 400 for the missing signed header; AWS 403).
      const dropped = await put(p.uploadUrl, swapped, { 'Content-Type': 'image/png' });
      expect(dropped).toBeGreaterThanOrEqual(400);
      expect(dropped).toBeLessThan(500);
      expect(await readAll(await publicAdapter().readObjectStream(key))).toEqual(PNG);
    });

    it('duplicate concurrent uploads to one write-once key: exactly one wins', async () => {
      const key = requestKey();
      const p = await publicAdapter().presignUpload({
        key,
        contentType: 'image/png',
        sizeBytes: PNG.length,
      });
      const headers = { 'Content-Type': 'image/png', 'If-None-Match': '*' };
      const statuses = await Promise.all(
        Array.from({ length: 6 }, () => put(p.uploadUrl, PNG, headers)),
      );
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s !== 200).every((s) => s === 412 || s === 409)).toBe(true);
    });

    it('an S3 avatar presign is write-once, including after finalization', async () => {
      const key = avatarKey();
      const p = await publicAdapter().presignUpload({
        key,
        contentType: 'image/png',
        sizeBytes: PNG.length,
      });
      expect(
        await put(p.uploadUrl, PNG, { 'Content-Type': 'image/png', 'If-None-Match': '*' }),
      ).toBe(200);
      const swapped = Buffer.from(PNG);
      swapped[PNG.length - 1] ^= 0xff;
      expect(
        await put(p.uploadUrl, swapped, { 'Content-Type': 'image/png', 'If-None-Match': '*' }),
      ).toBe(412);
      expect(await readAll((await publicAdapter().readObjectStream(key))!)).toEqual(PNG);
    });

    it('refuses a different MIME type than the one signed', async () => {
      const key = requestKey();
      const p = await publicAdapter().presignUpload({
        key,
        contentType: 'image/png',
        sizeBytes: PNG.length,
      });
      expect(
        await put(p.uploadUrl, PNG, { 'Content-Type': 'image/gif', 'If-None-Match': '*' }),
      ).toBe(403);
      expect(await headRaw(admin, PUB, key)).toBeNull();
    });

    it('refuses a body whose length differs from the signed size', async () => {
      const key = requestKey();
      const p = await publicAdapter().presignUpload({
        key,
        contentType: 'image/png',
        sizeBytes: PNG.length,
      });
      const status = await put(p.uploadUrl, Buffer.concat([PNG, Buffer.from('extra')]), {
        'Content-Type': 'image/png',
        'If-None-Match': '*',
      });
      expect(status).toBeGreaterThanOrEqual(400);
      expect(await headRaw(admin, PUB, key)).toBeNull();
    });

    it('refuses an expired upload URL', async () => {
      const adapter = publicAdapter();
      // Settle the root check with the real clock first (it is cached), so only
      // the presign itself is minted in the past.
      await adapter.presignUpload({ key: requestKey(), contentType: 'image/png', sizeBytes: 1 });
      const key = requestKey();
      jest.useFakeTimers({
        now: Date.now() - 10 * 60_000,
        doNotFake: [
          'nextTick',
          'setImmediate',
          'clearImmediate',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'queueMicrotask',
          'hrtime',
          'performance',
        ],
      });
      let url: string;
      try {
        url = (
          await adapter.presignUpload({ key, contentType: 'image/png', sizeBytes: PNG.length })
        ).uploadUrl;
      } finally {
        jest.useRealTimers();
      }
      expect(await put(url, PNG, { 'Content-Type': 'image/png', 'If-None-Match': '*' })).toBe(403);
      expect(await headRaw(admin, PUB, key)).toBeNull();
    });

    it('fails closed for portfolio staging when bucket privacy cannot be established', async () => {
      // MinIO does not implement GetPublicAccessBlock. The adapter must then
      // refuse to mint a staging upload rather than assume the bucket is private.
      await expect(
        publicAdapter().presignUpload({
          key: `portfolio-staging/r20ref/${randomUUID()}.png`,
          contentType: 'image/png',
          sizeBytes: PNG.length,
        }),
      ).rejects.toBeDefined();
    });

    it('refuses to mint a public upload into a bucket marked for another namespace', async () => {
      const wrong = publicAdapter(adapterConfig({ ...buckets, public: RESTR }));
      await expect(
        wrong.presignUpload({ key: requestKey(), contentType: 'image/png', sizeBytes: 1 }),
      ).rejects.toThrow('storage-root-namespace-mismatch');
    });
  });

  // ── 2. private namespaces are not readable by the public ────────────────

  describe('private originals stay private', () => {
    it('anonymous GET of restricted evidence, staged portfolio and a receipt-shaped object is refused', async () => {
      const evidence = `verification/r20-case/${randomUUID()}.pdf`;
      await putEvidence(restrictedAdapter(), evidence);
      const staged = `portfolio-staging/r20ref/${randomUUID()}.png`;
      await putRaw(admin, STAGE, staged, PNG, 'image/png');
      expect(await anonymousGet(RESTR, evidence)).toBe(403);
      expect(await anonymousGet(STAGE, staged)).toBe(403);
      expect(await anonymousGet(RESTR, '.hsm-storage-root.json')).toBe(403);
    });

    it('the restricted port mints no URL of any kind', () => {
      const adapter = restrictedAdapter();
      for (const name of ['presignUpload', 'publicUrlForKey', 'signedUrl', 'getSignedUrl']) {
        expect(adapter[name]).toBeUndefined();
      }
    });
  });

  // ── 3. missing vs denied vs misconfigured vs unavailable ────────────────

  describe('redacted fault classification', () => {
    const closed = 'http://127.0.0.1:9'; // discard port: nothing listens

    it('a missing public object is null, not an error', async () => {
      expect(
        await publicAdapter().readObjectStream(`requests/r20ref/${randomUUID()}.png`),
      ).toBeNull();
    });

    it('bad credentials are DENIED, a wrong bucket is MISCONFIGURED, a dead endpoint is UNAVAILABLE', async () => {
      const key = `requests/r20ref/${randomUUID()}.png`;
      const bad = { accessKeyId: 'r20-not-a-user', secretAccessKey: 'r20-not-a-secret-value-000' };
      const denied = await publicAdapter(adapterConfig(buckets, bad))
        .readObjectStream(key)
        .catch((e: Error) => e);
      expect(denied).toBeInstanceOf(diagnostics.StorageFaultError);
      expect(denied.outcome).toBe('denied');

      const wrong = await publicAdapter(adapterConfig({ ...buckets, public: bucketName('absent') }))
        .readObjectStream(key)
        .catch((e: Error) => e);
      expect(wrong.outcome).toBe('misconfigured');

      const down = await publicAdapter(adapterConfig(buckets, undefined, closed))
        .readObjectStream(key)
        .catch((e: Error) => e);
      expect(down.outcome).toBe('unavailable');

      for (const e of [denied, wrong, down]) {
        const text = `${e.message} ${JSON.stringify(e)}`;
        expect(text).not.toContain(PUB);
        expect(text).not.toContain('127.0.0.1');
        expect(text).not.toContain(key);
      }
    });

    it('restricted head answers null only for absence; a credential fault throws opaquely', async () => {
      expect(
        await restrictedAdapter().head(`verification/r20-case/${randomUUID()}.pdf`),
      ).toBeNull();
      const bad = { accessKeyId: 'r20-not-a-user', secretAccessKey: 'r20-not-a-secret-value-000' };
      const err = await restrictedAdapter(adapterConfig(buckets, bad))
        .head(`verification/r20-case/${randomUUID()}.pdf`)
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).not.toContain(RESTR);
    });
  });

  // ── 4. immutable restricted writes, atomic claims, streamed failure ─────

  describe('restricted writes', () => {
    it('never overwrites finalized evidence, and concurrent first writes produce one winner', async () => {
      const key = `verification/r20-case/${randomUUID()}.pdf`;
      const adapter = restrictedAdapter();
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => putEvidence(adapter, key)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
          ports.RestrictedObjectAlreadyExistsError,
        );
      }
      await expect(
        putEvidence(adapter, key, Buffer.from('%PDF-replacement')),
      ).rejects.toBeInstanceOf(ports.RestrictedObjectAlreadyExistsError);
      expect((await versionsOf(admin, RESTR, key)).versions).toBe(1);
    });

    it('a streamed upload that fails part-way leaves no object behind', async () => {
      const key = `verification/r20-case/${randomUUID()}.pdf`;
      const short = await stage(PDF.subarray(0, 10));
      await expect(
        restrictedAdapter().putObjectFromFile({
          key,
          sourcePath: short,
          contentType: 'application/pdf',
          sizeBytes: PDF.length, // more than the file holds
        }),
      ).rejects.toBeDefined();
      expect(await headRaw(admin, RESTR, key)).toBeNull();
      expect((await versionsOf(admin, RESTR, key)).versions).toBe(0);
    });

    it('a receipt-shaped object can use the same port with mediated, integrity-checked reads, and identity erasure cannot touch it', async () => {
      // Contract only: no receipt POLICY exists (CR-R20-06). This proves the
      // existing safe port can carry it without a second transport.
      const key = `finance/receipts/r20ref/${randomUUID()}.pdf`;
      const adapter = restrictedAdapter();
      await putEvidence(adapter, key);
      expect(await readAll(await adapter.openReadStream(key, { sizeBytes: PDF.length }))).toEqual(
        PDF,
      );
      await expect(adapter.eraseObject(key)).rejects.toThrow(
        'restricted-erasure-invalid-namespace',
      );
      expect(await anonymousGet(RESTR, key)).toBe(403);
    });
  });

  // ── 5. modified / missing objects on read ───────────────────────────────

  describe('read integrity', () => {
    it('refuses a modified object instead of streaming it, and streams the genuine one', async () => {
      const key = `verification/r20-case/${randomUUID()}.pdf`;
      const adapter = restrictedAdapter();
      await putEvidence(adapter, key);
      await expect(
        adapter.openReadStream(key, { sizeBytes: PDF.length + 1 }),
      ).rejects.toBeInstanceOf(ports.RestrictedObjectIntegrityError);
      // Substituted underneath the API (operator / bad restore / leaked key).
      await putRaw(admin, RESTR, key, Buffer.concat([PDF, Buffer.from('tampered')]));
      await expect(adapter.openReadStream(key, { sizeBytes: PDF.length })).rejects.toBeInstanceOf(
        ports.RestrictedObjectIntegrityError,
      );
    });

    it('a missing restricted object is an opaque failure that names no coordinates', async () => {
      const key = `verification/r20-case/${randomUUID()}.pdf`;
      const err = await restrictedAdapter()
        .openReadStream(key)
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(`${err.message}${JSON.stringify(err)}`).not.toContain(key);
      expect(`${err.message}${JSON.stringify(err)}`).not.toContain(RESTR);
    });
  });

  // ── 6. versions, lifecycle-style deletes, legal holds, erasure ──────────

  describe('erasure agrees with versions and holds', () => {
    it('a lifecycle-style DELETE leaves versions behind; erasure removes them and verifies absence', async () => {
      const key = `verification/r20-case/${randomUUID()}.pdf`;
      await putEvidence(restrictedAdapter(), key);
      await putRaw(admin, RESTR, key, PDF); // a second version, same bytes
      const { DeleteObjectCommand } = sdk();
      // What a generic expiration rule does on a versioned bucket.
      await admin.send(new DeleteObjectCommand({ Bucket: RESTR, Key: key }));
      expect(await headRaw(admin, RESTR, key)).toBeNull(); // "gone" to a naive check
      expect(await versionsOf(admin, RESTR, key)).toEqual({ versions: 2, deleteMarkers: 1 });
      await expect(restrictedAdapter().eraseObject(key)).resolves.toEqual({
        scope: 'PRIMARY_OBJECT_AND_VERSIONS',
        verifiedAbsent: true,
      });
      expect(await versionsOf(admin, RESTR, key)).toEqual({ versions: 0, deleteMarkers: 0 });
    });

    it('a legal hold blocks erasure without a false receipt; releasing it lets erasure complete', async () => {
      const key = `verification/r20-case/${randomUUID()}.pdf`;
      const adapter = restrictedAdapter(adapterConfig({ ...buckets, restricted: LOCKED }));
      await putEvidence(adapter, key);
      const { PutObjectLegalHoldCommand, ListObjectVersionsCommand } = sdk();
      const listed = await admin.send(
        new ListObjectVersionsCommand({ Bucket: LOCKED, Prefix: key }),
      );
      const VersionId = listed.Versions?.[0]?.VersionId;
      if (!VersionId) throw new Error('expected the stored evidence version');
      await admin.send(
        new PutObjectLegalHoldCommand({
          Bucket: LOCKED,
          Key: key,
          VersionId,
          LegalHold: { Status: 'ON' },
        }),
      );
      await expect(adapter.eraseObject(key)).rejects.toThrow('restricted-erasure-unconfirmed');
      // The held version survives; erasure's first DELETE left only a marker.
      expect((await versionsOf(admin, LOCKED, key)).versions).toBe(1);
      await admin.send(
        new PutObjectLegalHoldCommand({
          Bucket: LOCKED,
          Key: key,
          VersionId,
          LegalHold: { Status: 'OFF' },
        }),
      );
      await expect(adapter.eraseObject(key)).resolves.toMatchObject({ verifiedAbsent: true });
      expect(await versionsOf(admin, LOCKED, key)).toEqual({ versions: 0, deleteMarkers: 0 });
    });

    it('the plan lifecycle documents are accepted by a real S3 implementation and round-trip', async () => {
      const { PutBucketLifecycleConfigurationCommand, GetBucketLifecycleConfigurationCommand } =
        sdk();
      const { loadPlan } = require(join(REPO, 'scripts/production/storage/storage-plan.cjs'));
      const { files } = loadPlan();
      // EMULATOR GAP (recorded in ACCEPTANCE.md): MinIO rejects
      // AbortIncompleteMultipartUpload, which AWS supports. Every other rule is
      // applied and round-tripped here; the abort rule is hosted evidence.
      const isAbort = (r: { AbortIncompleteMultipartUpload?: unknown }) =>
        r.AbortIncompleteMultipartUpload !== undefined;
      await expect(
        admin.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: RESTR,
            LifecycleConfiguration: files['aws/lifecycle.restricted.json'],
          }),
        ),
      ).rejects.toMatchObject({ name: 'InvalidArgument' });
      for (const [bucket, file] of [
        [PUB, 'aws/lifecycle.public.json'],
        [STAGE, 'aws/lifecycle.portfolio-staging.json'],
      ]) {
        const Rules = files[file].Rules.filter((r: object) => !isAbort(r));
        await admin.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: bucket,
            LifecycleConfiguration: { Rules },
          }),
        );
        const got = await admin.send(
          new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
        );
        expect((got.Rules ?? []).map((r: { ID?: string }) => r.ID).sort()).toEqual(
          Rules.map((r: { ID: string }) => r.ID).sort(),
        );
        // No rule anywhere expires a CURRENT object: deletion is app-owned.
        for (const rule of got.Rules ?? []) {
          expect(rule.Expiration?.Days).toBeUndefined();
          expect(rule.Expiration?.Date).toBeUndefined();
        }
      }
      // The restricted plan contains nothing but the abort rule, so no current
      // or noncurrent expiry exists for S3 to apply behind the retention worker.
      expect(files['aws/lifecycle.restricted.json'].Rules.every(isAbort)).toBe(true);
    });
  });

  // ── 7. least privilege, using the plan's own role policies ──────────────

  describe('least-privilege principals from infra/production/storage', () => {
    let api: Credentials;
    let worker: Credentials;

    beforeAll(() => {
      const { loadPlan, renderPolicy } = require(
        join(REPO, 'scripts/production/storage/storage-plan.cjs'),
      );
      const { files } = loadPlan();
      const values = {
        PUBLIC_BUCKET: PUB,
        PORTFOLIO_STAGING_BUCKET: STAGE,
        RESTRICTED_BUCKET: RESTR,
      };
      // EMULATOR GAPS (hosted evidence, ACCEPTANCE.md): no KMS IAM, and no
      // public-access-block / policy-status actions in MinIO's IAM.
      const emulator = {
        stripKms: true,
        omitActions: ['s3:GetBucketPublicAccessBlock', 's3:GetBucketPolicyStatus'],
      };
      api = createPrincipal('r20api', renderPolicy(files['aws/iam-api.json'], values, emulator));
      worker = createPrincipal(
        'r20worker',
        renderPolicy(files['aws/iam-worker.json'], values, emulator),
      );
    });

    afterAll(() => {
      for (const p of [api, worker]) if (p) removePrincipal(p);
    });

    it('the API role writes and reads evidence but cannot permanently erase it', async () => {
      const key = `verification/r20-case/${randomUUID()}.pdf`;
      const asApi = restrictedAdapter(adapterConfig(buckets, api));
      await putEvidence(asApi, key);
      expect(await readAll(await asApi.openReadStream(key, { sizeBytes: PDF.length }))).toEqual(
        PDF,
      );
      await expect(asApi.eraseObject(key)).rejects.toThrow('restricted-erasure-unconfirmed');
      // Its DeleteObject (needed for upload cleanup) only adds a delete marker in
      // a versioned bucket: the bytes are still recoverable by the worker.
      expect((await versionsOf(admin, RESTR, key)).versions).toBe(1);
    });

    it('the worker role erases every version and verifies absence, but cannot write evidence', async () => {
      const key = `verification/r20-case/${randomUUID()}.pdf`;
      await putEvidence(restrictedAdapter(), key);
      const asWorker = restrictedAdapter(adapterConfig(buckets, worker));
      await expect(
        putEvidence(asWorker, `verification/r20-case/${randomUUID()}.pdf`),
      ).rejects.toBeDefined();
      await expect(asWorker.eraseObject(key)).resolves.toMatchObject({ verifiedAbsent: true });
      expect(await versionsOf(admin, RESTR, key)).toEqual({ versions: 0, deleteMarkers: 0 });
    });

    it('neither role can make a bucket public, read outside its prefixes, or reach finance objects', async () => {
      const { PutBucketPolicyCommand, GetObjectCommand } = sdk();
      const publicPolicy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${RESTR}/*`,
          },
        ],
      });
      const finance = `finance/receipts/r20ref/${randomUUID()}.pdf`;
      await putRaw(admin, RESTR, finance, PDF);
      const stray = `misc/${randomUUID()}.bin`;
      await putRaw(admin, PUB, stray, PNG);
      // A fresh client per call: MinIO closes the connection after an
      // AccessDenied, and a reused keep-alive socket then reports a hang-up.
      async function deniedFor(creds: Credentials, command: unknown): Promise<string | undefined> {
        const s3 = client(creds);
        try {
          await s3.send(command as never);
          return 'ALLOWED';
        } catch (err) {
          return (err as { name?: string }).name;
        } finally {
          s3.destroy();
        }
      }
      for (const creds of [api, worker]) {
        expect(
          await deniedFor(
            creds,
            new PutBucketPolicyCommand({ Bucket: RESTR, Policy: publicPolicy }),
          ),
        ).toBe('AccessDenied');
        expect(await deniedFor(creds, new GetObjectCommand({ Bucket: RESTR, Key: finance }))).toBe(
          'AccessDenied',
        );
        expect(await deniedFor(creds, new GetObjectCommand({ Bucket: PUB, Key: stray }))).toBe(
          'AccessDenied',
        );
      }
      expect(await anonymousGet(RESTR, finance)).toBe(403);
    });
  });

  // ── 8. inventory and restore contract (R36) ─────────────────────────────

  describe('inventory and restore verification', () => {
    it('inventories versions without keys, and a restore report finds missing and modified objects', async () => {
      const prefix = `verification/r20-inv-${randomUUID().slice(0, 8)}/`;
      const keys = [0, 1, 2].map((i) => `${prefix}${i}.pdf`);
      for (const k of keys) await putEvidence(restrictedAdapter(), k);
      await putRaw(admin, RESTR, keys[0], PDF); // extra version
      const { DeleteObjectCommand, CopyObjectCommand } = sdk();
      await admin.send(new DeleteObjectCommand({ Bucket: RESTR, Key: keys[2] })); // delete marker

      const inv = await inventoryMod.buildInventory(admin, {
        bucket: RESTR,
        namespace: 'restricted',
        prefix,
        deep: true,
      });
      expect(inv.schema).toBe('hsm.storage-inventory/v1');
      expect(inv.versioning).toBe('Enabled');
      expect(inv.rootId).toMatch(/^[0-9a-f-]{36}$/);
      expect(inv.counts).toMatchObject({ liveObjects: 2, versions: 4, deleteMarkers: 1 });
      const text = JSON.stringify(inv);
      for (const k of keys) expect(text).not.toContain(k);
      expect(text).not.toContain(RESTR);
      expect(text).not.toContain('r20-inv');
      expect(inv.entries.every((e: { keyFp: string }) => /^[0-9a-f]{16}$/.test(e.keyFp))).toBe(
        true,
      );
      expect(() => inventoryMod.assertInventoryIntact(inv)).not.toThrow();

      // "Restore" the live objects into another bucket and verify.
      for (const k of keys.slice(0, 2)) {
        await admin.send(
          new CopyObjectCommand({ Bucket: RESTORED, Key: k, CopySource: `${RESTR}/${k}` }),
        );
      }
      const good = await inventoryMod.verifyRestore(admin, {
        bucket: RESTORED,
        inventory: inv,
        deep: true,
      });
      expect(good).toMatchObject({
        ok: true,
        expectedLive: 2,
        matched: 2,
        missing: [],
        mismatched: [],
      });

      await putRaw(admin, RESTORED, keys[1], Buffer.from('%PDF-1.4 altered same-length?'));
      await admin.send(new DeleteObjectCommand({ Bucket: RESTORED, Key: keys[0] }));
      const bad = await inventoryMod.verifyRestore(admin, {
        bucket: RESTORED,
        inventory: inv,
        deep: true,
      });
      expect(bad.ok).toBe(false);
      expect(bad.missing).toEqual([diagnostics.keyFingerprint(keys[0])]);
      expect(bad.mismatched).toEqual([diagnostics.keyFingerprint(keys[1])]);

      const tampered = { ...inv, entries: inv.entries.slice(1) };
      await expect(
        inventoryMod.verifyRestore(admin, { bucket: RESTORED, inventory: tampered }),
      ).rejects.toThrow('storage-inventory-manifest-mismatch');
    });
  });

  // ── 9. the same configured root, seen from separate processes ───────────

  describe('storage-root identity across processes', () => {
    const doctor = join(REPO, 'scripts/production/storage/storage-doctor.cjs');

    function runDoctor(env: Record<string, string | undefined>) {
      const res = spawnSync(process.execPath, [doctor], {
        cwd: REPO,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
        encoding: 'utf8',
        timeout: 60_000,
      });
      return {
        status: res.status,
        report: res.stdout ? JSON.parse(res.stdout) : null,
        stderr: res.stderr,
      };
    }

    function s3Env(over: Record<string, string> = {}) {
      return {
        STORAGE_DRIVER: 's3',
        S3_ENDPOINT: endpoint(),
        S3_FORCE_PATH_STYLE: 'true',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: process.env.R20_S3_ROOT_USER,
        S3_SECRET_ACCESS_KEY: process.env.R20_S3_ROOT_SECRET,
        S3_BUCKET: PUB,
        S3_PORTFOLIO_BUCKET: STAGE,
        S3_RESTRICTED_BUCKET: RESTR,
        ...over,
      };
    }

    it('two processes with the same configuration report the same root ids, without names or keys', () => {
      const a = runDoctor(s3Env());
      const b = runDoctor(s3Env());
      expect(a.status).toBe(0);
      expect(b.status).toBe(0);
      expect(a.report.healthy).toBe(true);
      const ids = (r: { namespaces: Array<{ namespace: string; rootId: string }> }) =>
        Object.fromEntries(r.namespaces.map((n) => [n.namespace, n.rootId]));
      expect(ids(a.report)).toEqual(ids(b.report));
      const raw = JSON.stringify(a.report);
      for (const secretish of [
        PUB,
        STAGE,
        RESTR,
        endpoint(),
        process.env.R20_S3_ROOT_USER as string,
      ]) {
        expect(raw).not.toContain(secretish);
      }
    });

    it('a process pointed at the wrong bucket reports a mismatch and exits non-zero', () => {
      const wrong = runDoctor(s3Env({ S3_RESTRICTED_BUCKET: PUB }));
      expect(wrong.status).toBe(3);
      expect(
        wrong.report.namespaces.find((n: { namespace: string }) => n.namespace === 'restricted')
          .marker,
      ).toBe('mismatch');
    });

    it('local roots: same configured directory → same id; cwd-default elsewhere → absent, never searched', async () => {
      const restrictedRoot = await mkdtemp(join(tmpdir(), 'hsm-r20-lr-'));
      const publicRoot = await mkdtemp(join(tmpdir(), 'hsm-r20-lp-'));
      try {
        const {
          ensureLocalRootMarker,
        } = require('../../../src/infrastructure/storage/storage-root');
        await ensureLocalRootMarker(restrictedRoot, 'restricted');
        await ensureLocalRootMarker(publicRoot, 'public');
        const env = { RESTRICTED_STORAGE_DIR: restrictedRoot, LOCAL_STORAGE_DIR: publicRoot };
        const a = runDoctor(env);
        const b = runDoctor(env);
        expect(a.status).toBe(0);
        expect(a.report.namespaces).toEqual(b.report.namespaces);
        expect(JSON.stringify(a.report)).not.toContain(restrictedRoot);
        const elsewhere = runDoctor({});
        expect(elsewhere.status).toBe(3);
        expect(
          elsewhere.report.namespaces.every(
            (n: { rootSource: string }) => n.rootSource === 'cwd-default',
          ),
        ).toBe(true);
      } finally {
        await rm(restrictedRoot, { recursive: true, force: true });
        await rm(publicRoot, { recursive: true, force: true });
      }
    });
  });
});

/** The root secret must never appear in a URL handed to a browser. */
function rootCredentialsSecretMarker(): string {
  return process.env.R20_S3_ROOT_SECRET ?? '\u0000never';
}
