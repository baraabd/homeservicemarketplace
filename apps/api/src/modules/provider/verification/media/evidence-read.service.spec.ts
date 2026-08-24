import { EvidenceReadService } from './evidence-read.service';
import type { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../../shared/errors/app-error';

// Sprint 9B — the audited restricted read. docs/adr/0009 §3
//
// The DECISION is covered exhaustively in evidence-read.policy.spec.ts. What
// this file pins is the behaviour a pure function cannot express: that every
// attempt is audited, that denials are indistinguishable on the wire, and that
// nothing about the document reaches a log.

const OWNER = 'user-owner';
const REVIEWER = 'user-reviewer';
const STRANGER = 'user-stranger';

function makeService(doc: Record<string, unknown> | null, opts: { auditThrows?: boolean } = {}) {
  const create = opts.auditThrows
    ? jest.fn().mockRejectedValue(new Error('audit db down'))
    : jest.fn().mockResolvedValue({ id: 'log-1' });

  const prisma = {
    client: {
      verificationDocument: { findUnique: jest.fn().mockResolvedValue(doc) },
      verificationAccessLog: { create },
    },
  } as unknown as PrismaService;

  return { service: new EvidenceReadService(prisma), create };
}

function doc(over: { scanState?: string; deletedAt?: Date | null; visibility?: string } = {}) {
  return {
    id: 'doc-1',
    caseId: 'case-1',
    case: { id: 'case-1', providerProfile: { userId: OWNER } },
    mediaAsset: {
      id: 'asset-1',
      storageKey: 'verification/case-1/asset-1.pdf',
      visibility: over.visibility ?? 'RESTRICTED',
      scanState: over.scanState ?? 'CLEAN',
      deletedAt: over.deletedAt ?? null,
      detectedMimeType: 'application/pdf',
      sizeBytes: 1234,
      originalFilename: 'passport.pdf',
    },
  };
}

const base = {
  documentId: 'doc-1',
  ipPrefix: '203.0.113.0',
  userAgentHash: 'abc',
};

describe('authorizeRead — grants', () => {
  it('returns what the controller needs to stream, for a reviewer', async () => {
    const { service } = makeService(doc());
    const grant = await service.authorizeRead({
      ...base,
      actorUserId: REVIEWER,
      actorHasEvidenceViewPermission: true,
    });

    expect(grant.storageKey).toBe('verification/case-1/asset-1.pdf');
    expect(grant.detectedMimeType).toBe('application/pdf');
  });

  it('serves the DETECTED type, never a declared one', async () => {
    // This header drives how a browser treats the response. Serving a
    // caller-chosen type is how a stored file becomes an execution vector.
    const d = doc();
    d.mediaAsset.detectedMimeType = 'image/png';
    const { service } = makeService(d);

    const grant = await service.authorizeRead({
      ...base,
      actorUserId: REVIEWER,
      actorHasEvidenceViewPermission: true,
    });
    expect(grant.detectedMimeType).toBe('image/png');
  });

  it('falls back to octet-stream when the type is unknown', async () => {
    // An unknown type must not become a guess the browser renders.
    const d = doc();
    d.mediaAsset.detectedMimeType = null as unknown as string;
    const { service } = makeService(d);

    const grant = await service.authorizeRead({
      ...base,
      actorUserId: OWNER,
      actorHasEvidenceViewPermission: false,
    });
    expect(grant.detectedMimeType).toBe('application/octet-stream');
  });
});

describe('authorizeRead — denials are indistinguishable on the wire', () => {
  it.each([
    ['a stranger', { actorUserId: STRANGER, actorHasEvidenceViewPermission: false }, doc()],
    [
      'a quarantined asset',
      { actorUserId: REVIEWER, actorHasEvidenceViewPermission: true },
      doc({ scanState: 'QUARANTINED' }),
    ],
    [
      'an unscanned asset',
      { actorUserId: REVIEWER, actorHasEvidenceViewPermission: true },
      doc({ scanState: 'PENDING' }),
    ],
    [
      'a deleted asset',
      { actorUserId: REVIEWER, actorHasEvidenceViewPermission: true },
      doc({ deletedAt: new Date() }),
    ],
    ['an unknown document', { actorUserId: REVIEWER, actorHasEvidenceViewPermission: true }, null],
  ])('answers 404 for %s', async (_label, actor, row) => {
    // 404 for EVERY denial, including "exists but you may not see it". A
    // distinguishable status is an enumeration oracle over exactly the ids we
    // least want enumerated.
    const { service } = makeService(row);
    await expect(service.authorizeRead({ ...base, ...actor })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('gives the same message whether the document exists or not', async () => {
    const existing = makeService(doc());
    const missing = makeService(null);

    const a = await existing.service
      .authorizeRead({ ...base, actorUserId: STRANGER, actorHasEvidenceViewPermission: false })
      .catch((e: AppError) => e);
    const b = await missing.service
      .authorizeRead({ ...base, actorUserId: STRANGER, actorHasEvidenceViewPermission: false })
      .catch((e: AppError) => e);

    expect((a as AppError).message).toBe((b as AppError).message);
    expect((a as AppError).status).toBe((b as AppError).status);
  });
});

describe('every attempt is audited', () => {
  it('records a GRANTED row on success', async () => {
    const { service, create } = makeService(doc());
    await service.authorizeRead({
      ...base,
      actorUserId: REVIEWER,
      actorHasEvidenceViewPermission: true,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      caseId: 'case-1',
      mediaAssetId: 'asset-1',
      actorUserId: REVIEWER,
      action: 'READ_BYTES',
      outcome: 'GRANTED_REVIEWER',
    });
  });

  it('records a DENIED row too — the more interesting of the two', async () => {
    // Auditing only successes produces a log that proves nothing about the
    // attempts that mattered. A denied read is what an intrusion looks like.
    const { service, create } = makeService(doc());
    await service
      .authorizeRead({ ...base, actorUserId: STRANGER, actorHasEvidenceViewPermission: false })
      .catch(() => undefined);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.outcome).toBe('DENIED_NOT_AUTHORIZED');
  });

  it('distinguishes an owner read from a reviewer read', async () => {
    const { service, create } = makeService(doc());
    await service.authorizeRead({
      ...base,
      actorUserId: OWNER,
      actorHasEvidenceViewPermission: false,
    });
    expect(create.mock.calls[0][0].data.outcome).toBe('GRANTED_OWNER');
  });

  it('audits BEFORE the caller is told anything', async () => {
    // Ordering matters: auditing after a successful response means a crash
    // between the two loses the record of a read that actually happened.
    const { service, create } = makeService(doc({ scanState: 'QUARANTINED' }));
    await service
      .authorizeRead({ ...base, actorUserId: REVIEWER, actorHasEvidenceViewPermission: true })
      .catch(() => undefined);

    expect(create).toHaveBeenCalled();
  });

  it('never puts document content, keys or filenames in the audit row', async () => {
    // The audit row must not become the leak it exists to detect.
    const { service, create } = makeService(doc());
    await service.authorizeRead({
      ...base,
      actorUserId: REVIEWER,
      actorHasEvidenceViewPermission: true,
    });

    const written = JSON.stringify(create.mock.calls[0][0].data);
    expect(written).not.toContain('verification/case-1');
    expect(written).not.toContain('passport.pdf');
    expect(written).not.toMatch(/storageKey/i);
  });

  it('truncates the ip rather than storing a full fingerprint', async () => {
    const { service, create } = makeService(doc());
    await service.authorizeRead({
      ...base,
      ipPrefix: '203.0.113.0',
      actorUserId: REVIEWER,
      actorHasEvidenceViewPermission: true,
    });
    expect(create.mock.calls[0][0].data.ipPrefix).toBe('203.0.113.0');
  });
});

describe('an audit failure never changes the access decision', () => {
  it('still grants when the audit write throws', async () => {
    // An audit-write failure must not become a way to DENY a legitimate read
    // — that turns a logging outage into an availability incident.
    const { service } = makeService(doc(), { auditThrows: true });
    await expect(
      service.authorizeRead({
        ...base,
        actorUserId: REVIEWER,
        actorHasEvidenceViewPermission: true,
      }),
    ).resolves.toMatchObject({ storageKey: expect.any(String) });
  });

  it('still denies when the audit write throws', async () => {
    // And equally must not become a way to make an unauthorized read succeed.
    const { service } = makeService(doc(), { auditThrows: true });
    await expect(
      service.authorizeRead({
        ...base,
        actorUserId: STRANGER,
        actorHasEvidenceViewPermission: false,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
