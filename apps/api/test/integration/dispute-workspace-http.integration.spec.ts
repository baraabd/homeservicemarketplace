import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { randomUUID } from 'node:crypto';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';
const enabled = process.env.RUN_DB_INTEGRATION === '1';
(enabled ? describe : describe.skip)('Dispute workspace real AppModule HTTP', () => {
  jest.setTimeout(120_000);
  let h: DisputeHttpApp;
  beforeAll(async () => {
    h = await disputeHttpApp();
  });
  afterAll(async () => {
    await h?.dispose();
  });
  it('uses normal password/OTP cookies, enforces CSRF and ownership, persists drafts and decisions', async () => {
    const { users, db } = h.fixture;
    const customer = await httpSession(h).login(users.seeker);
    const reviewer = await httpSession(h).login(users.reviewer);
    const outsider = await httpSession(h).login(users.outsider);
    const bookingId = await h.fixture.booking();
    const content = {
      issueCode: 'SERVICE_QUALITY',
      requestedOutcome: 'REPERFORM',
      statement: 'Private HTTP statement about the incomplete service.',
      step: 1,
    };
    const absent = await httpSession(h).request(`/v1/me/disputes/drafts/${bookingId}`);
    expect(absent.status).toBe(401);
    expect(absent.headers.get('cache-control')).toContain('no-store');
    const noCsrf = await customer.request(`/v1/me/disputes/drafts/${bookingId}`, {
      method: 'POST',
      body: { version: 0, content },
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    const saved = await customer.request(`/v1/me/disputes/drafts/${bookingId}`, {
      method: 'POST',
      body: { version: 0, content },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(1);
    expect((await customer.request(`/v1/me/disputes/drafts/${bookingId}`)).body.content).toEqual(
      content,
    );
    expect((await outsider.request(`/v1/me/disputes/drafts/${bookingId}`)).status).toBe(404);
    const row = await db.disputePrivateDraft.findUniqueOrThrow({
      where: { userId_bookingId: { userId: users.seeker, bookingId } },
    });
    expect(row.contentCipher).not.toContain(content.statement);
    const context = await customer.request(`/v1/me/disputes/context/${bookingId}`);
    const input = {
      bookingId,
      idempotencyKey: randomUUID(),
      policyVersion: context.body.policyVersion,
      issueCode: content.issueCode,
      requestedOutcome: content.requestedOutcome,
      statement: content.statement,
    };
    const created = await customer.request<{ dispute: { id: string } }>('/v1/me/disputes', {
      method: 'POST',
      body: input,
    });
    expect(created.status).toBe(200);
    const id = created.body.dispute.id;
    const replay = await customer.request<{ dispute: { id: string } }>('/v1/me/disputes', {
      method: 'POST',
      body: input,
    });
    expect(replay.body.dispute.id).toBe(id);
    expect(await db.disputePrivateDraft.count({ where: { bookingId, erasedAt: null } })).toBe(0);
    const consumedDraft = await db.disputePrivateDraft.findFirstOrThrow({ where: { bookingId } });
    expect(consumedDraft.contentCipher).toBe('');
    expect(consumedDraft.erasedAt).not.toBeNull();
    expect((await outsider.request(`/v1/me/disputes/${id}/workspace`)).status).toBe(404);
    const view = await reviewer.request<DisputeWorkspaceView>(`/v1/admin/dispute-workspaces/${id}`);
    expect(view.status).toBe(200);
    expect(view.body.statements[0].text).toBe(content.statement);
    const assigned = await reviewer.request(`/v1/admin/dispute-workspaces/${id}/commands`, {
      method: 'POST',
      body: {
        expectedRevision: view.body.revision,
        idempotencyKey: randomUUID(),
        command: { action: 'ASSIGN', reviewerId: users.reviewer },
      },
    });
    expect(assigned.status).toBe(200);
    const detail = await reviewer.request<DisputeWorkspaceView>(
      `/v1/admin/dispute-workspaces/${id}`,
    );
    const command = {
      idempotencyKey: randomUUID(),
      expectedRevision: detail.body.revision,
      command: {
        action: 'DECIDE',
        reasonCode: 'INSUFFICIENT_BASIS',
        rationale: 'The available records do not establish an agreed service remedy.',
        proposalId: null,
        basisEventIds: [detail.body.events[0].id],
        evidenceIds: [],
      },
    };
    const decision = await reviewer.request(`/v1/admin/dispute-workspaces/${id}/commands`, {
      method: 'POST',
      body: command,
    });
    expect(decision.status).toBe(200);
    const duplicate = await reviewer.request(`/v1/admin/dispute-workspaces/${id}/commands`, {
      method: 'POST',
      body: command,
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.replayed).toBe(true);
    const publicView = await customer.request<DisputeWorkspaceView>(
      `/v1/me/disputes/${id}/workspace`,
    );
    expect(publicView.body.state).toBe('DECIDED');
    expect(publicView.body.decisions).toHaveLength(1);
    expect(publicView.body.decisions[0].rationale).toBe(command.command.rationale);
    expect(JSON.stringify(publicView.body)).not.toMatch(
      /contentCipher|storageKey|leaseToken|requestDigest/,
    );
    expect(publicView.headers.get('cache-control')).toContain('no-store');
    expect((await customer.request('/v1/auth/logout', { method: 'POST' })).status).toBe(204);
    expect(
      (await customer.request<DisputeWorkspaceView>(`/v1/me/disputes/${id}/workspace`)).status,
    ).toBe(401);
  });
});
