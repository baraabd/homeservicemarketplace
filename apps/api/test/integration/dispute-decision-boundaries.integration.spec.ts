// Real-service fixtures serialize shared policy ownership with advisory locks.
jest.setTimeout(120_000);
import { randomUUID } from 'node:crypto';
import { workspaceFixture } from '../support/dispute-workspace-fixture';
import { WORKSPACE_PERMISSIONS as P } from '../../src/modules/disputes/workspace/workspace.policy';
(process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip)(
  'Dispute decision boundaries',
  () => {
    let f: Awaited<ReturnType<typeof workspaceFixture>>;
    beforeAll(async () => {
      f = await workspaceFixture();
    });
    afterAll(async () => {
      await f?.dispose();
    });
    async function agreed() {
      const c = await f.assigned();
      const proposal = await f.command(c.id, f.users.reviewer, {
        action: 'PROPOSE',
        summary: 'A scoped return visit to complete the agreed service.',
        remedies: [
          {
            type: 'REPERFORM',
            description: 'Complete the outstanding cleaning tasks.',
            conditions: '',
            dueAt: null,
          },
        ],
      });
      for (const actor of [f.users.seeker, f.users.provider])
        await f.command(c.id, actor, {
          action: 'CONSENT',
          proposalId: proposal.entityId,
          accepted: true,
        });
      const w = await f.cases.view(f.users.reviewer, c.id, true);
      const input = {
        action: 'DECIDE',
        proposalId: proposal.entityId,
        reasonCode: 'AGREED_RESOLUTION',
        rationale: 'The proposal matches both parties recorded consent.',
        basisEventIds: [w.events[0].id],
        evidenceIds: [],
      };
      return { c, proposal, input };
    }
    it('requires a separate exception grant even when the reviewer can ordinarily decide', async () => {
      const { c, input } = await agreed();
      const grant = await f.db.rolePermission.findFirstOrThrow({
        where: { role: { name: f.users.reviewer }, permission: { key: P.APPROVE_EXCEPTION } },
      });
      await f.db.rolePermission.delete({
        where: { roleId_permissionId: { roleId: grant.roleId, permissionId: grant.permissionId } },
      });
      try {
        await expect(
          f.command(c.id, f.users.reviewer, { ...input, reasonCode: 'POLICY_EXCEPTION' }),
        ).rejects.toMatchObject({ status: 403 });
        expect(await f.db.disputeDecisionRecord.count({ where: { disputeId: c.id } })).toBe(0);
      } finally {
        await f.db.rolePermission.create({ data: grant });
      }
    });
    it('does not attest fulfilment while the independent-review window is still open', async () => {
      const { c, proposal, input } = await agreed();
      await f.command(c.id, f.users.reviewer, input);
      await expect(
        f.command(c.id, f.users.seeker, {
          action: 'CONFIRM_FULFILMENT',
          proposalId: proposal.entityId,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await f.cases.view(f.users.seeker, c.id)).availableActions).not.toContain(
        'CONFIRM_FULFILMENT',
      );
    });
    it('does not accept a new expired offer during appeal, even with both consents', async () => {
      const { c, input } = await agreed();
      const original = await f.command(c.id, f.users.reviewer, input);
      const appeal = await f.command(c.id, f.users.seeker, {
        action: 'APPEAL',
        decisionId: original.entityId,
        grounds: 'The scope needs to be checked independently.',
      });
      await f.command(c.id, f.users.independent, {
        action: 'ASSIGN',
        reviewerId: f.users.independent,
      });
      const offer = await f.command(c.id, f.users.independent, {
        action: 'PROPOSE',
        summary: 'The amended terms reflect an independent review.',
        remedies: [
          {
            type: 'CLARIFICATION',
            description: 'Give a written explanation of the agreed scope.',
            conditions: '',
            dueAt: null,
          },
        ],
      });
      for (const actor of [f.users.seeker, f.users.provider])
        await f.command(c.id, actor, {
          action: 'CONSENT',
          proposalId: offer.entityId,
          accepted: true,
        });
      await f.db.disputeResolutionProposal.update({
        where: { id: offer.entityId! },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      await expect(
        f.command(c.id, f.users.independent, {
          ...input,
          action: 'DECIDE_APPEAL',
          appealId: appeal.entityId,
          proposalId: offer.entityId,
          reasonCode: 'INDEPENDENT_REVIEW',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await f.db.disputeDecisionRecord.count({ where: { disputeId: c.id } })).toBe(1);
    });
    it('marks superseded offers unavailable when deciding without a remedy', async () => {
      const { c, proposal, input } = await agreed();
      await f.command(c.id, f.users.reviewer, {
        ...input,
        proposalId: null,
        reasonCode: 'INSUFFICIENT_BASIS',
      });
      expect(
        (
          await f.db.disputeResolutionProposal.findUniqueOrThrow({
            where: { id: proposal.entityId! },
          })
        ).status,
      ).toBe('SUPERSEDED');
    });
    it('rejects reused decision keys with changed meaning', async () => {
      const { c, input } = await agreed();
      const before = await f.cases.view(f.users.reviewer, c.id, true);
      const request = {
        command: input,
        expectedRevision: before.revision,
        idempotencyKey: randomUUID(),
      };
      await f.commands.execute(f.users.reviewer, c.id, request, true);
      await expect(
        f.commands.execute(
          f.users.reviewer,
          c.id,
          {
            ...request,
            command: {
              ...input,
              rationale: 'A different decision must not reuse the same intent.',
            },
          },
          true,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });
  },
);
