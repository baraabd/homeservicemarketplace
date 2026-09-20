// Real-service fixtures serialize shared policy ownership with advisory locks.
jest.setTimeout(120_000);
import { workspaceFixture } from '../support/dispute-workspace-fixture';
(process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip)(
  'Private dispute text retention on real PostgreSQL',
  () => {
    let f: Awaited<ReturnType<typeof workspaceFixture>>;
    beforeAll(async () => {
      f = await workspaceFixture();
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(async () => {
      await f?.dispose();
    });
    const content = {
      issueCode: 'OTHER',
      requestedOutcome: 'REVIEW',
      statement: 'My private unsent draft.',
      step: 1,
    };
    async function expiredDraft() {
      const bookingId = await f.booking();
      await f.drafts.save(f.users.seeker, bookingId, { version: 0, content });
      const row = await f.db.disputePrivateDraft.update({
        where: { userId_bookingId: { userId: f.users.seeker, bookingId } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      return { bookingId, row };
    }
    async function closedCase() {
      const c = await f.assigned();
      const w = await f.cases.view(f.users.reviewer, c.id, true);
      const d = await f.command(c.id, f.users.reviewer, {
        action: 'DECIDE',
        proposalId: null,
        reasonCode: 'INSUFFICIENT_BASIS',
        rationale: 'The available facts do not justify a service remedy.',
        basisEventIds: [w.events[0].id],
        evidenceIds: [],
      });
      await f.db.disputeDecisionRecord.update({
        where: { id: d.entityId! },
        data: { appealUntil: new Date(Date.now() - 1000) },
      });
      await f.command(c.id, f.users.reviewer, { action: 'CLOSE' });
      return c;
    }
    it('retains a revision tombstone and refuses old packets after expiry instead of recreating v0', async () => {
      const { bookingId, row } = await expiredDraft();
      const results = await Promise.all([
        f.privacy.eraseExpiredDraft(),
        f.privacy.eraseExpiredDraft(),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const erased = await f.db.disputePrivateDraft.findUniqueOrThrow({ where: { id: row.id } });
      expect(erased.contentCipher).toBe('');
      expect(erased.version).toBe(2);
      expect(erased.erasedAt).not.toBeNull();
      for (const version of [0, 1])
        await expect(
          f.drafts.save(f.users.seeker, bookingId, { version, content }),
        ).rejects.toMatchObject({ status: 409 });
      const fresh = await f.drafts.read(f.users.seeker, bookingId);
      expect(fresh.version).toBe(2);
      expect(fresh.content.statement).toBe('');
      expect(fresh.savedAt).toBeNull();
      expect(
        (await f.drafts.save(f.users.seeker, bookingId, { version: fresh.version, content }))
          .version,
      ).toBe(3);
      const receipt = await f.db.outboxEvent.findMany({ where: { aggregateId: row.id } });
      expect(receipt).toHaveLength(1);
      expect(JSON.stringify(receipt)).not.toContain(content.statement);
    });
    it('rolls back an erasure when its outbox receipt cannot be committed', async () => {
      const { row } = await expiredDraft();
      jest.spyOn(f.outbox, 'enqueue').mockRejectedValueOnce(new Error('Injected outbox outage'));
      await expect(f.privacy.eraseExpiredDraft()).rejects.toThrow('Injected outbox outage');
      const unchanged = await f.db.disputePrivateDraft.findUniqueOrThrow({ where: { id: row.id } });
      expect(unchanged.erasedAt).toBeNull();
      expect(unchanged.contentCipher).toBe(row.contentCipher);
      expect(await f.privacy.eraseExpiredDraft()).toBe(true);
    });
    it('uses the same booking lock as save so cleanup never overwrites an acknowledged new draft', async () => {
      const { bookingId, row } = await expiredDraft();
      const [saved] = await Promise.allSettled([
        f.drafts.save(f.users.seeker, bookingId, {
          version: 1,
          content: { ...content, statement: 'A newer private statement.' },
        }),
        f.privacy.eraseExpiredDraft(),
      ]);
      const actual = await f.db.disputePrivateDraft.findUniqueOrThrow({ where: { id: row.id } });
      if (saved.status === 'fulfilled') {
        expect(actual.erasedAt).toBeNull();
        expect((await f.drafts.read(f.users.seeker, bookingId)).content.statement).toBe(
          'A newer private statement.',
        );
      } else {
        expect(saved.reason).toMatchObject({ status: 409 });
        expect(actual.erasedAt).not.toBeNull();
      }
    });
    it('pins a closed case deadline to its historical policy and never erases live cases', async () => {
      const c = await closedCase();
      const w = await f.db.disputeWorkspace.findUniqueOrThrow({ where: { disputeId: c.id } });
      expect(w.privateTextDueAt!.getTime() - w.closedAt!.getTime()).toBe(30 * 86400000);
      expect(await f.privacy.eraseClosedCase()).toBe(false);
      const live = await f.assigned();
      await f.db.disputeWorkspace.update({
        where: { disputeId: live.id },
        data: { privateTextDueAt: new Date(0) },
      });
      expect(await f.privacy.eraseClosedCase()).toBe(false);
      expect((await f.cases.view(f.users.seeker, live.id)).state).toBe('GATHERING');
    });
    it('denies private reads at expiry even during a bounded hold, then erases prose without changing decision facts', async () => {
      const c = await closedCase();
      const original = await f.db.disputeDecisionRecord.findFirstOrThrow({
        where: { disputeId: c.id },
      });
      await f.db.disputeWorkspace.update({
        where: { disputeId: c.id },
        data: {
          privateTextDueAt: new Date(Date.now() - 1000),
          privateTextHoldUntil: new Date(Date.now() + 60000),
        },
      });
      const hidden = await f.cases.view(f.users.seeker, c.id);
      expect(hidden.privacy?.textState).toBe('EXPIRED');
      expect(hidden.statements).toHaveLength(0);
      expect(hidden.decisions[0].rationale).toBe('');
      expect((await f.intake.detail(f.users.seeker, c.id)).statement).toBeNull();
      expect(await f.privacy.eraseClosedCase()).toBe(false);
      await f.command(c.id, f.users.reviewer, {
        action: 'HOLD_PRIVATE_TEXT',
        holdUntil: null,
        reasonCode: 'HOLD_RELEASED',
      });
      const results = await Promise.all([f.privacy.eraseClosedCase(), f.privacy.eraseClosedCase()]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const erased = await f.db.disputeDecisionRecord.findUniqueOrThrow({
        where: { id: original.id },
      });
      expect(erased.rationaleCipher).toBe('');
      const { rationaleCipher: _old, ...before } = original;
      const { rationaleCipher: _new, ...after } = erased;
      expect(after).toEqual(before);
      expect((await f.cases.view(f.users.provider, c.id)).privacy?.textState).toBe('ERASED');
      const event = await f.db.disputeWorkspaceEvent.findMany({
        where: { disputeId: c.id, kind: 'PRIVATE_TEXT_ERASED' },
      });
      expect(event).toHaveLength(1);
      expect(event[0].facts).toEqual({ scope: 'CASE_PRIVATE_PROSE_PRIMARY_DATABASE' });
      await expect(
        f.command(c.id, f.users.reviewer, {
          action: 'HOLD_PRIVATE_TEXT',
          holdUntil: new Date(Date.now() + 60000).toISOString(),
          reasonCode: 'LEGAL_HOLD',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it('does not report completed case erasure when the event/outbox transaction fails', async () => {
      const c = await closedCase();
      await f.db.disputeWorkspace.update({
        where: { disputeId: c.id },
        data: { privateTextDueAt: new Date(0) },
      });
      jest
        .spyOn(f.outbox, 'enqueue')
        .mockRejectedValueOnce(new Error('Injected case outbox outage'));
      await expect(f.privacy.eraseClosedCase()).rejects.toThrow('Injected case outbox outage');
      expect(
        (await f.db.disputeWorkspace.findUniqueOrThrow({ where: { disputeId: c.id } }))
          .privateTextErasedAt,
      ).toBeNull();
      expect(
        (await f.db.disputeDecisionRecord.findFirstOrThrow({ where: { disputeId: c.id } }))
          .rationaleCipher.length,
      ).toBeGreaterThan(0);
      expect(await f.privacy.eraseClosedCase()).toBe(true);
    });
    it('does not count assignment as a first response to a participant', async () => {
      const c = await f.assigned();
      expect(
        (await f.db.disputeWorkspace.findUniqueOrThrow({ where: { disputeId: c.id } }))
          .firstResponseAt,
      ).toBeNull();
      await f.command(c.id, f.users.reviewer, {
        action: 'REQUEST_INFORMATION',
        recipient: 'SEEKER',
        question: 'Please provide the missing completion details.',
      });
      expect(
        (await f.db.disputeWorkspace.findUniqueOrThrow({ where: { disputeId: c.id } }))
          .firstResponseAt,
      ).not.toBeNull();
    });
    it('keeps shadow maintenance read-only for expired private text and drafts', async () => {
      const { row } = await expiredDraft();
      const before = await f.db.disputePrivateDraft.findUniqueOrThrow({ where: { id: row.id } });
      await f.maintenance.runOnce('shadow');
      expect(await f.db.disputePrivateDraft.findUniqueOrThrow({ where: { id: row.id } })).toEqual(
        before,
      );
      await f.privacy.eraseExpiredDraft();
    });
  },
);
