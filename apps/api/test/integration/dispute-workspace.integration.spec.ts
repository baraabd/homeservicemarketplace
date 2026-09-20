import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { workspaceFixture, type WorkspaceFixture } from '../support/dispute-workspace-fixture';
import { WORKSPACE_PERMISSIONS as P } from '../../src/modules/disputes/workspace/workspace.policy';
const run = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120000);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
run('Sprint 12 collaboration with real PostgreSQL and restricted filesystem', () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await workspaceFixture();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await f?.dispose();
  });
  it('creates the workspace atomically with encrypted original statement and safe projections', async () => {
    const c = await f.create();
    const seeker = await f.cases.view(f.users.seeker, c.id),
      provider = await f.cases.view(f.users.provider, c.id);
    expect(seeker.statements[0].text).toBe(c.input.statement);
    expect(provider.statements).toHaveLength(0);
    const original = await f.db.disputeEvent.findFirstOrThrow({
      where: { disputeId: c.id, type: 'OPENED' },
    });
    expect(original.message).toBeNull();
    const rows = await f.db.disputeStatement.findMany({ where: { disputeId: c.id } });
    expect(JSON.stringify(rows)).not.toContain(c.input.statement);
    expect((await f.intake.detail(f.users.seeker, c.id)).statement).toBe(c.input.statement);
    expect((await f.intake.detail(f.users.provider, c.id)).workspaceAvailable).toBe(true);
    expect(
      JSON.stringify([
        await f.db.outboxEvent.findMany({ where: { aggregateId: c.id } }),
        await f.db.notification.findMany({ where: { userId: f.users.provider } }),
      ]),
    ).not.toContain(c.input.statement);
  });
  it('persists drafts encrypted, replays a lost ACK, and refuses stale versions or foreign ownership', async () => {
    const b = await f.booking(),
      content = {
        issueCode: 'OTHER',
        requestedOutcome: 'REVIEW',
        statement: 'Private incomplete draft.',
        step: 1,
      };
    const saved = await f.drafts.save(f.users.seeker, b, { version: 0, content });
    expect(saved.version).toBe(1);
    expect(await f.drafts.save(f.users.seeker, b, { version: 0, content })).toEqual(saved);
    expect((await f.drafts.read(f.users.seeker, b)).content).toEqual(content);
    await expect(
      f.drafts.save(f.users.seeker, b, {
        version: 0,
        content: { ...content, statement: 'different' },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(f.drafts.read(f.users.outsider, b)).rejects.toMatchObject({ status: 404 });
    const row = await f.db.disputePrivateDraft.findFirstOrThrow({ where: { bookingId: b } });
    expect(row.contentCipher).not.toContain(content.statement);
  });
  it('serializes competing commands and enforces exact intent replay', async () => {
    const c = await f.create();
    const w = await f.cases.view(f.users.seeker, c.id);
    const input = {
      idempotencyKey: randomUUID(),
      expectedRevision: w.revision,
      command: { action: 'RESPOND', requestId: null, text: 'My private follow-up statement.' },
    };
    const result = await Promise.all([
      f.commands.execute(f.users.seeker, c.id, input),
      f.commands.execute(f.users.seeker, c.id, input),
    ]);
    expect(result.filter((x) => x.replayed)).toHaveLength(1);
    await expect(
      f.commands.execute(f.users.seeker, c.id, {
        ...input,
        command: { ...input.command, text: 'Changed intent content.' },
      }),
    ).rejects.toMatchObject({ status: 409 });
    const current = await f.cases.view(f.users.seeker, c.id);
    const attempts = await Promise.allSettled(
      [1, 2].map((i) =>
        f.commands.execute(f.users.seeker, c.id, {
          idempotencyKey: randomUUID(),
          expectedRevision: current.revision,
          command: { action: 'RESPOND', requestId: null, text: `Statement with sequence ${i}.` },
        }),
      ),
    );
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((x) => x.status === 'rejected')).toHaveLength(1);
  });
  it('applies fresh granular permissions and refuses participant-as-reviewer conflict', async () => {
    const c = await f.assigned();
    await expect(f.cases.view(f.users.outsider, c.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.cases.view(f.users.seeker, c.id, true)).rejects.toMatchObject({ status: 403 });
    await expect(
      f.command(c.id, f.users.reader, {
        action: 'REQUEST_INFORMATION',
        recipient: 'SEEKER',
        question: 'Provide further information.',
      }),
    ).rejects.toMatchObject({ status: 403 });
    const grant = await f.db.rolePermission.findFirstOrThrow({
      where: { role: { name: f.users.reviewer }, permission: { key: P.PROPOSE } },
    });
    await f.db.rolePermission.delete({
      where: { roleId_permissionId: { roleId: grant.roleId, permissionId: grant.permissionId } },
    });
    await expect(
      f.command(c.id, f.users.reviewer, {
        action: 'PROPOSE',
        summary: 'Agreed follow-up remedy.',
        remedies: [
          {
            type: 'CLARIFICATION',
            description: 'Explain what happened.',
            conditions: '',
            dueAt: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 403 });
    await f.db.rolePermission.create({ data: grant });
  });
  it('records requests with deadlines, private replies and idempotent answer receipt', async () => {
    const c = await f.assigned();
    const request = await f.command(c.id, f.users.reviewer, {
      action: 'REQUEST_INFORMATION',
      recipient: 'PROVIDER',
      question: 'Please explain which work was completed.',
    });
    const provider = await f.cases.view(f.users.provider, c.id);
    expect(provider.requests[0].id).toBe(request.entityId);
    expect((await f.cases.view(f.users.seeker, c.id)).requests).toHaveLength(0);
    await expect(
      f.command(c.id, f.users.seeker, {
        action: 'RESPOND',
        requestId: request.entityId,
        text: 'I am not the requested recipient.',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await f.command(c.id, f.users.provider, {
      action: 'RESPOND',
      requestId: request.entityId,
      text: 'The follow-up visit was not completed.',
    });
    expect((await f.cases.view(f.users.provider, c.id)).requests[0].status).toBe('ANSWERED');
    expect(
      (await f.cases.view(f.users.seeker, c.id)).statements.some((s) =>
        s.text.includes('follow-up visit'),
      ),
    ).toBe(false);
  });
  it('uploads ciphertext, blocks unscanned/foreign reads, scans and audits authorized access', async () => {
    const c = await f.assigned();
    const key = randomUUID();
    const file = { buffer: png, mimetype: 'image/png', size: png.length };
    const e = await f.evidence.upload(f.users.seeker, c.id, { idempotencyKey: key }, file);
    expect((await f.evidence.upload(f.users.seeker, c.id, { idempotencyKey: key }, file)).id).toBe(
      e.id,
    );
    const row = await f.db.disputeEvidence.findUniqueOrThrow({ where: { id: e.id } });
    expect((await readFile(join(f.root, row.storageKey!))).equals(png)).toBe(false);
    await expect(f.evidence.read(f.users.seeker, c.id, e.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await f.evidence.scanOne()).toBe(true);
    expect((await f.evidence.read(f.users.seeker, c.id, e.id)).bytes.equals(png)).toBe(true);
    await expect(f.evidence.read(f.users.provider, c.id, e.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.evidence.read(f.users.reader, c.id, e.id, true)).rejects.toMatchObject({
      status: 404,
    });
    await f.evidence.read(f.users.reviewer, c.id, e.id, true);
    expect(
      await f.db.auditEvent.count({
        where: { type: 'DISPUTE_EVIDENCE_READ', metadata: { path: ['evidenceId'], equals: e.id } },
      }),
    ).toBe(2);
  });
  it('dead-letters exhausted scanner leases and never assumes CLEAN on dependency failure', async () => {
    const c = await f.assigned();
    const e = await f.evidence.upload(
      f.users.provider,
      c.id,
      { idempotencyKey: randomUUID() },
      { buffer: png, mimetype: 'image/png', size: png.length },
    );
    jest
      .spyOn(f.scanner, 'scan')
      .mockResolvedValue({ state: 'UNAVAILABLE', reason: 'test outage' });
    await f.evidence.scanOne();
    expect((await f.db.disputeEvidence.findUniqueOrThrow({ where: { id: e.id } })).state).toBe(
      'SCAN_FAILED',
    );
    await f.db.disputeEvidence.update({
      where: { id: e.id },
      data: {
        state: 'SCANNING',
        attempts: 5,
        leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() - 1),
      },
    });
    await f.maintenance.recoverExhaustedLease();
    expect((await f.db.disputeEvidence.findUniqueOrThrow({ where: { id: e.id } })).state).toBe(
      'DEAD',
    );
    await f.command(c.id, f.users.reviewer, {
      action: 'REQUEUE_EVIDENCE',
      evidenceId: e.id,
      reasonCode: 'DEPENDENCY_RESTORED',
    });
    expect((await f.db.disputeEvidence.findUniqueOrThrow({ where: { id: e.id } })).attempts).toBe(
      0,
    );
  });
  it('expires an information request with a durable event rather than silently dropping it', async () => {
    const c = await f.assigned();
    const response = await f.command(c.id, f.users.reviewer, {
      action: 'REQUEST_INFORMATION',
      recipient: 'SEEKER',
      question: 'Please give the missing service information.',
    });
    await f.db.disputeInformationRequest.update({
      where: { id: response.entityId! },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    await expect(
      f.command(c.id, f.users.seeker, {
        action: 'RESPOND',
        requestId: response.entityId,
        text: 'Response after the deadline.',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await f.maintenance.expireRequest();
    expect((await f.cases.view(f.users.seeker, c.id)).requests[0].status).toBe('EXPIRED');
    expect(
      await f.db.disputeWorkspaceEvent.count({
        where: { disputeId: c.id, kind: 'REQUEST_EXPIRED' },
      }),
    ).toBe(1);
  });
  it('requires both consents, records a decision, independently reviews appeal and closes after fulfilment', async () => {
    const c = await f.assigned();
    const proposal = await f.command(c.id, f.users.reviewer, {
      action: 'PROPOSE',
      summary: 'A partial service remedy with a follow-up explanation.',
      remedies: [
        {
          type: 'PARTIAL_REMEDY',
          description: 'Redo the unfinished portion of the service.',
          conditions: 'At the agreed access time.',
          dueAt: null,
        },
        {
          type: 'CLARIFICATION',
          description: 'Provide a written completion summary.',
          conditions: '',
          dueAt: null,
        },
      ],
    });
    const base = (await f.cases.view(f.users.reviewer, c.id, true)).events[0].id;
    const decision = {
      action: 'DECIDE',
      reasonCode: 'AGREED_RESOLUTION',
      rationale: 'Both parties have agreed on this proportionate service remedy.',
      proposalId: proposal.entityId,
      basisEventIds: [base],
      evidenceIds: [],
    };
    await expect(f.command(c.id, f.users.reviewer, decision)).rejects.toMatchObject({
      status: 409,
    });
    await f.command(c.id, f.users.seeker, {
      action: 'CONSENT',
      proposalId: proposal.entityId,
      accepted: true,
    });
    await f.command(c.id, f.users.provider, {
      action: 'CONSENT',
      proposalId: proposal.entityId,
      accepted: true,
    });
    const recorded = await f.command(c.id, f.users.reviewer, decision);
    await expect(f.command(c.id, f.users.reviewer, { action: 'CLOSE' })).rejects.toMatchObject({
      status: 409,
    });
    const appeal = await f.command(c.id, f.users.seeker, {
      action: 'APPEAL',
      decisionId: recorded.entityId,
      grounds: 'Please independently check the agreed scope of this remedy.',
    });
    await expect(
      f.command(c.id, f.users.reviewer, { action: 'ASSIGN', reviewerId: f.users.reviewer }),
    ).rejects.toMatchObject({ status: 403 });
    await f.command(c.id, f.users.independent, {
      action: 'ASSIGN',
      reviewerId: f.users.independent,
    });
    const amended = await f.command(c.id, f.users.independent, {
      ...decision,
      action: 'DECIDE_APPEAL',
      appealId: appeal.entityId,
      reasonCode: 'INDEPENDENT_REVIEW',
      rationale: 'The original terms were checked independently and are upheld.',
    });
    const rows = await f.db.disputeDecisionRecord.findMany({ where: { disputeId: c.id } });
    expect(rows).toHaveLength(2);
    expect(rows.find((d) => d.id === amended.entityId)?.supersedesId).toBe(recorded.entityId);
    await expect(f.command(c.id, f.users.independent, { action: 'CLOSE' })).rejects.toMatchObject({
      status: 409,
    });
    await f.command(c.id, f.users.seeker, {
      action: 'CONFIRM_FULFILMENT',
      proposalId: proposal.entityId,
    });
    await f.command(c.id, f.users.provider, {
      action: 'CONFIRM_FULFILMENT',
      proposalId: proposal.entityId,
    });
    await f.command(c.id, f.users.independent, { action: 'CLOSE' });
    expect((await f.cases.view(f.users.provider, c.id)).state).toBe('CLOSED');
    expect((await f.db.dispute.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('RESOLVED');
  });
  it('rolls back a response and revision when its transactional outbox insert fails', async () => {
    const c = await f.assigned();
    const before = await f.cases.view(f.users.seeker, c.id);
    jest
      .spyOn(f.outbox, 'enqueue')
      .mockRejectedValueOnce(new Error('synthetic unavailable outbox'));
    await expect(
      f.command(c.id, f.users.seeker, {
        action: 'RESPOND',
        requestId: null,
        text: 'A reply that must not be partially saved.',
      }),
    ).rejects.toThrow();
    const after = await f.cases.view(f.users.seeker, c.id);
    expect(after.revision).toBe(before.revision);
    expect(after.statements).toEqual(before.statements);
  });
  it('removes actual bytes only after holds lapse and fences reads through post-delete DB failure', async () => {
    const c = await f.assigned();
    const e = await f.evidence.upload(
      f.users.seeker,
      c.id,
      { idempotencyKey: randomUUID() },
      { buffer: png, mimetype: 'image/png', size: png.length },
    );
    // Clear other scanner backlog without changing production semantics.
    for (let i = 0; i < 10; i++) await f.evidence.scanOne();
    const row = await f.db.disputeEvidence.findUniqueOrThrow({ where: { id: e.id } });
    await f.db.disputeEvidence.update({
      where: { id: e.id },
      data: { retainUntil: new Date(Date.now() - 1000) },
    });
    await f.command(c.id, f.users.reviewer, {
      action: 'HOLD_EVIDENCE',
      evidenceId: e.id,
      holdUntil: new Date(Date.now() + 3600000).toISOString(),
      reasonCode: 'LEGAL_HOLD',
    });
    await f.evidence.eraseOne();
    expect(await f.storage.head(row.storageKey!)).not.toBeNull();
    await f.command(c.id, f.users.reviewer, {
      action: 'HOLD_EVIDENCE',
      evidenceId: e.id,
      holdUntil: null,
      reasonCode: 'HOLD_RELEASED',
    });
    jest
      .spyOn(f.outbox, 'enqueue')
      .mockRejectedValueOnce(new Error('synthetic post-delete transaction failure'));
    await f.evidence.eraseOne();
    expect(await f.storage.head(row.storageKey!)).toBeNull();
    const fenced = await f.db.disputeEvidence.findUniqueOrThrow({ where: { id: e.id } });
    expect(fenced.erasedAt).toBeNull();
    expect(fenced.erasureStartedAt).not.toBeNull();
    await expect(f.evidence.read(f.users.seeker, c.id, e.id)).rejects.toMatchObject({
      status: 404,
    });
    await f.db.disputeEvidence.update({
      where: { id: e.id },
      data: { nextAttemptAt: new Date(Date.now() - 1) },
    });
    await f.evidence.eraseOne();
    const erased = await f.db.disputeEvidence.findUniqueOrThrow({ where: { id: e.id } });
    expect(erased.state).toBe('ERASED');
    expect(erased.storageKey).toBeNull();
    expect(erased.contentDigest).toBe('');
  });
  it('keeps shadow mode read-only and physically expires server-side drafts', async () => {
    const b = await f.booking();
    await f.drafts.save(f.users.seeker, b, {
      version: 0,
      content: {
        issueCode: '',
        requestedOutcome: '',
        statement: 'Draft expires privately.',
        step: 0,
      },
    });
    await f.db.disputePrivateDraft.updateMany({
      where: { bookingId: b },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await f.maintenance.runOnce('shadow', 1);
    expect(await f.db.disputePrivateDraft.count({ where: { bookingId: b } })).toBe(1);
    await f.maintenance.runOnce('enforce', 1);
    const tombstone = await f.db.disputePrivateDraft.findFirstOrThrow({ where: { bookingId: b } });
    expect(tombstone.contentCipher).toBe('');
    expect(tombstone.erasedAt).not.toBeNull();
    expect(tombstone.version).toBe(2);
    expect(await f.db.disputePrivateDraft.count({ where: { bookingId: b, erasedAt: null } })).toBe(
      0,
    );
  });
  it('honours private notification preferences without suppressing case events', async () => {
    const c = await f.assigned();
    await f.preferences.save(f.users.provider, { enabled: false, language: 'ar' });
    const count = await f.db.notification.count({ where: { userId: f.users.provider } });
    await f.command(c.id, f.users.seeker, {
      action: 'RESPOND',
      requestId: null,
      text: 'Another update without an opted-out notification.',
    });
    expect(await f.db.notification.count({ where: { userId: f.users.provider } })).toBe(count);
    await f.preferences.save(f.users.provider, { enabled: true, language: 'ar' });
  });
});
