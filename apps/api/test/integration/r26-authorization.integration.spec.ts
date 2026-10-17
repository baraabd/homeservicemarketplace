import { randomUUID } from 'node:crypto';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// Real AppModule, password/OTP sessions, PostgreSQL and Redis. The shared
// fixture serializes seed ownership; every session has an independent cookie jar.
// Its mail/scanner adapters are test components, not SMTP/malware acceptance.
const enabled = process.env.RUN_DB_INTEGRATION === '1';
(enabled ? describe : describe.skip)('R26 effective authorization over HTTP', () => {
  jest.setTimeout(240_000);
  let h: DisputeHttpApp;
  type Session = Awaited<ReturnType<ReturnType<typeof httpSession>['login']>>;
  let admin: Session, owner: Session, outsider: Session;
  beforeAll(async () => {
    h = await disputeHttpApp();
    admin = await httpSession(h).login(h.fixture.users.reviewer);
    owner = await httpSession(h).login(h.fixture.users.seeker);
    outsider = await httpSession(h).login(h.fixture.users.outsider);
  });
  afterAll(async () => {
    await h?.dispose();
  });

  it('protects implemented financial reads with a positive authorized control', async () => {
    for (const path of ['summary', 'bookings', 'provider-earnings']) {
      const route = `/v1/admin/financials/${path}`;
      expect((await admin.request(route)).status).toBe(200);
      expect((await owner.request(route)).status).toBe(403);
      expect((await httpSession(h).request(route)).status).toBe(401);
    }
  });

  it('refuses CSRF and extra authority fields without creating a support ticket', async () => {
    const before = await h.fixture.db.supportTicket.count({
      where: { requesterUserId: h.fixture.users.seeker },
    });
    const input = {
      subject: 'R26 synthetic ticket',
      message: 'Private test message',
      idempotencyKey: randomUUID(),
    };
    expect(
      (
        await owner.request('/v1/me/support/tickets', {
          method: 'POST',
          csrf: false,
          body: input,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner.request('/v1/me/support/tickets', {
          method: 'POST',
          body: { ...input, requesterUserId: h.fixture.users.outsider, roles: ['admin'] },
        })
      ).status,
    ).toBe(400);
    expect(
      await h.fixture.db.supportTicket.count({
        where: { requesterUserId: h.fixture.users.seeker },
      }),
    ).toBe(before);
  });

  it('hides another session’s support ticket and prevents unauthorized replies', async () => {
    const created = await owner.request<{ ticket: { id: string } }>('/v1/me/support/tickets', {
      method: 'POST',
      body: {
        subject: 'R26 private ticket',
        message: 'R26 private support sentinel',
        idempotencyKey: randomUUID(),
      },
    });
    expect(created.status).toBe(201);
    const id = created.body.ticket.id;
    const route = `/v1/me/support/tickets/${id}`;
    expect((await owner.request(route)).status).toBe(200);
    const denied = await outsider.request<{ error: { code: string; message: string } }>(route);
    const missing = await outsider.request<{ error: { code: string; message: string } }>(
      `/v1/me/support/tickets/${randomUUID()}`,
    );
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(denied.status);
    expect(denied.body.error.code).toBe(missing.body.error.code);
    expect(denied.body.error.message).toBe(missing.body.error.message);
    expect(JSON.stringify(denied.body)).not.toContain('R26 private support sentinel');
    const before = await h.fixture.db.supportMessage.count({ where: { ticketId: id } });
    expect(
      (
        await outsider.request(`${route}/messages`, {
          method: 'POST',
          body: { body: 'Forbidden reply', idempotencyKey: randomUUID() },
        })
      ).status,
    ).toBe(404);
    expect(await h.fixture.db.supportMessage.count({ where: { ticketId: id } })).toBe(before);
  });

  it('hides private dispute workspaces and refuses forged admin decisions', async () => {
    const c = await h.fixture.assigned();
    const route = `/v1/me/disputes/${c.id}/workspace`;
    expect((await owner.request(route)).status).toBe(200);
    const denied = await outsider.request<{ error: { code: string; message: string } }>(route);
    const missing = await outsider.request<{ error: { code: string; message: string } }>(
      `/v1/me/disputes/${randomUUID()}/workspace`,
    );
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(denied.status);
    expect(denied.body.error.code).toBe(missing.body.error.code);
    expect(denied.body.error.message).toBe(missing.body.error.message);
    const before = await h.fixture.db.disputeWorkspace.findUniqueOrThrow({
      where: { disputeId: c.id },
    });
    expect(
      (
        await owner.request(`/v1/admin/dispute-workspaces/${c.id}/commands`, {
          method: 'POST',
          body: {
            expectedRevision: before.revision,
            idempotencyKey: randomUUID(),
            command: { action: 'ASSIGN', reviewerId: h.fixture.users.seeker },
          },
        })
      ).status,
    ).toBe(403);
    expect(
      await h.fixture.db.disputeWorkspace.findUniqueOrThrow({ where: { disputeId: c.id } }),
    ).toEqual(before);
  });

  it('revokes an existing authenticated session when the administrator suspends it', async () => {
    expect((await outsider.request('/v1/me/support/tickets')).status).toBe(200);
    const response = await admin.request(`/v1/admin/users/${h.fixture.users.outsider}/status`, {
      method: 'PATCH',
      body: { status: 'SUSPENDED', reason: 'R26 disposable authorization regression' },
    });
    expect(response.status).toBe(200);
    expect((await outsider.request('/v1/me/support/tickets')).status).toBe(401);
    expect(
      await h.fixture.db.session.count({
        where: { userId: h.fixture.users.outsider, revokedAt: null },
      }),
    ).toBe(0);
  });
});
