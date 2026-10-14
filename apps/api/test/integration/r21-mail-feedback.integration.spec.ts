/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
// R21 — signed delivery feedback and channel suppression against REAL
// PostgreSQL, over real HTTP through the Nest controller.
//
// CONTRACT DOUBLE: the feedback sender here is a test signing with the
// provider-neutral generic-hmac-v1 contract. No vendor callback format is
// exercised (no email service has been selected).
//
// The app mounts `express.raw()` on /v1/mail/feedback ahead of the JSON
// parser, mirroring coordinator change request CR-R21-01 for main.ts. Without
// that patch the production route fails closed (400) — asserted below.
export {};
import { randomUUID } from 'node:crypto';
import { withAdvisoryLock } from '../support/db-isolation';

const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(90_000);

const SECRET = 'r21-feedback-test-secret-'.padEnd(48, 'z');

suite('R21 mail feedback and suppression (real Postgres, real HTTP)', () => {
  let prisma: any;
  let app: any;
  let rawlessApp: any;
  let request: any;
  let s: any;
  const createdUserIds = new Set<string>();
  const hashes = new Set<string>();

  const configValues: Record<string, unknown> = {
    MAIL_FEEDBACK_SIGNING_SECRET: SECRET,
    SMTP_FROM: 'Marketplace <no-reply@mail.r21.test>',
    FRONTEND_URL: 'https://app.example.test',
    MAIL_DISPATCH_LEASE_MS: 60_000,
  };

  async function buildApp(opts: { raw: boolean; secret?: string | undefined }) {
    const { Test } = require('@nestjs/testing');
    const { VersioningType } = require('@nestjs/common');
    const express = require('express');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { MetricsService } = require('../../src/infrastructure/telemetry/metrics.service');
    const { MailMetrics } = require('../../src/infrastructure/mail/mail.metrics');
    const {
      MailFeedbackController,
    } = require('../../src/infrastructure/mail/feedback/mail-feedback.controller');
    const {
      MailFeedbackService,
    } = require('../../src/infrastructure/mail/feedback/mail-feedback.service');
    const values: Record<string, unknown> = {
      ...configValues,
      MAIL_FEEDBACK_SIGNING_SECRET: 'secret' in opts ? opts.secret : SECRET,
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [MailFeedbackController],
      providers: [
        MailFeedbackService,
        MailMetrics,
        MetricsService,
        {
          provide: AppConfigService,
          useValue: { get: (k: string) => values[k], isProduction: false },
        },
        { provide: PrismaService, useValue: { client: prisma } },
      ],
    }).compile();
    const nest = moduleRef.createNestApplication({ bodyParser: false });
    nest.enableVersioning({ type: VersioningType.URI });
    if (opts.raw) nest.use('/v1/mail/feedback', express.raw({ type: '*/*', limit: '256kb' }));
    nest.use(express.json({ limit: '1mb' }));
    await nest.init();
    return nest;
  }

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    await withAdvisoryLock('seed', 'exclusive', () => db.seed());
    request = require('supertest');
    app = await buildApp({ raw: true });
    rawlessApp = await buildApp({ raw: false });

    const { DurableMailService } = require('../../src/infrastructure/mail/durable-mail.service');
    const {
      EmailDeliveryRepository,
    } = require('../../src/infrastructure/mail/email-delivery.repository');
    const {
      MailEnvelopeCipher,
      recipientHash,
    } = require('../../src/infrastructure/mail/mail-envelope.cipher');
    const { MailMetrics } = require('../../src/infrastructure/mail/mail.metrics');
    const { MetricsService } = require('../../src/infrastructure/telemetry/metrics.service');
    const { InMemoryMailAdapter } = require('../../src/infrastructure/mail/in-memory-mail.adapter');
    const { signFeedback } = require('../../src/infrastructure/mail/feedback/feedback-signature');
    const {
      ProviderStatusEmailHandler,
    } = require('../../src/infrastructure/mail/provider-status-email.handler');

    const prismaSvc = { client: prisma };
    const transport = new InMemoryMailAdapter();
    const cfg = { get: (k: string) => configValues[k], isProduction: false };
    const mail = new DurableMailService(
      transport,
      MailEnvelopeCipher.ephemeral(),
      new EmailDeliveryRepository(prismaSvc),
      prismaSvc,
      cfg,
      new MailMetrics(new MetricsService()),
    );
    s = {
      mail,
      transport,
      recipientHash,
      signFeedback,
      handler: new ProviderStatusEmailHandler(mail),
    };
  });

  afterEach(async () => {
    await prisma.emailDelivery.deleteMany({ where: { recipientHash: { in: [...hashes] } } });
    await prisma.emailSuppression.deleteMany({ where: { recipientHash: { in: [...hashes] } } });
    for (const id of createdUserIds) await prisma.user.deleteMany({ where: { id } });
    createdUserIds.clear();
    hashes.clear();
    s.transport.clear();
  });
  afterAll(async () => {
    await app?.close();
    await rawlessApp?.close();
    await prisma?.$disconnect();
  });

  /** An ACCEPTED delivery to a fresh address, as a real send would leave it. */
  async function accepted(template = 'provider.verification_action_required', vars: unknown = {}) {
    const address = `r21-fb-${randomUUID()}@itest.local`;
    hashes.add(s.recipientHash(address));
    const ticket = await prisma.$transaction((tx: any) =>
      s.mail.enqueue(
        { template, to: address, vars, expiresAt: new Date(Date.now() + 3_600_000) },
        tx,
      ),
    );
    await s.mail.dispatch(ticket);
    const row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: ticket.deliveryId } });
    expect(row.status).toBe('ACCEPTED');
    return { address, row, messageId: `<${row.id}@mail.r21.test>` };
  }

  function post(events: unknown[], opts: { ts?: number; secret?: string; target?: any } = {}) {
    const body = JSON.stringify({ events });
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    return request((opts.target ?? app).getHttpServer())
      .post('/v1/mail/feedback')
      .set('content-type', 'application/json')
      .set('x-mail-feedback-timestamp', String(ts))
      .set('x-mail-feedback-signature', s.signFeedback(opts.secret ?? SECRET, ts, body))
      .send(body);
  }

  const ev = (messageId: string, type: string, extra: Record<string, unknown> = {}) => ({
    id: `evt-${randomUUID()}`,
    type,
    messageId,
    occurredAt: new Date().toISOString(),
    ...extra,
  });

  it('a signed delivery report moves ACCEPTED → DELIVERED (acceptance is not delivery until then)', async () => {
    const d = await accepted();
    const res = await post([ev(d.messageId, 'delivered')]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applied: 1, duplicate: 0, unmatched: 0 });
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: d.row.id } })).status).toBe(
      'DELIVERED',
    );
  });

  it('a permanent bounce marks BOUNCED and suppresses NOTIFICATION mail to that address only', async () => {
    const d = await accepted();
    expect((await post([ev(d.messageId, 'bounce', { bounceType: 'permanent' })])).status).toBe(200);
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: d.row.id } })).status).toBe(
      'BOUNCED',
    );
    expect(
      await prisma.emailSuppression.count({
        where: { recipientHash: s.recipientHash(d.address), reason: 'HARD_BOUNCE' },
      }),
    ).toBe(1);

    // Next notice to the same address is suppressed, not sent …
    const t = await prisma.$transaction((tx: any) =>
      s.mail.enqueue(
        {
          template: 'provider.verification_outcome',
          to: d.address,
          vars: { outcome: 'approved' },
          expiresAt: new Date(Date.now() + 3_600_000),
        },
        tx,
      ),
    );
    s.transport.clear();
    await s.mail.dispatch(t);
    expect(
      (await prisma.emailDelivery.findUniqueOrThrow({ where: { id: t.deliveryId } })).status,
    ).toBe('SUPPRESSED');
    expect(s.transport.lastSentTo(d.address)).toBeUndefined();

    // … but the recipient can still recover their account: AUTH mail is sent.
    const reset = await prisma.$transaction((tx: any) =>
      s.mail.enqueue(
        {
          template: 'auth.password_reset',
          to: d.address,
          vars: { token: 'r'.repeat(43) },
          expiresAt: new Date(Date.now() + 600_000),
        },
        tx,
      ),
    );
    await s.mail.dispatch(reset);
    expect(
      (await prisma.emailDelivery.findUniqueOrThrow({ where: { id: reset.deliveryId } })).status,
    ).toBe('ACCEPTED');

    // A different address is unaffected.
    const other = await accepted();
    expect(other.row.status).toBe('ACCEPTED');
  });

  it('a complaint marks COMPLAINED and suppresses notices; a late "delivered" cannot undo it', async () => {
    const d = await accepted();
    await post([ev(d.messageId, 'complaint')]);
    await post([ev(d.messageId, 'delivered')]);
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: d.row.id } })).status).toBe(
      'COMPLAINED',
    );
    expect(
      await prisma.emailSuppression.count({
        where: { recipientHash: s.recipientHash(d.address), reason: 'COMPLAINT' },
      }),
    ).toBe(1);
  });

  it('a transient bounce is recorded but neither changes status nor suppresses', async () => {
    const d = await accepted();
    const res = await post([ev(d.messageId, 'bounce', { bounceType: 'transient' })]);
    expect(res.body.applied).toBe(1);
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: d.row.id } })).status).toBe(
      'ACCEPTED',
    );
    expect(
      await prisma.emailSuppression.count({ where: { recipientHash: s.recipientHash(d.address) } }),
    ).toBe(0);
  });

  it('a replayed event is absorbed (duplicate), including concurrent replays', async () => {
    const d = await accepted();
    const e = ev(d.messageId, 'complaint');
    const results = await Promise.all([post([e]), post([e]), post([e])]);
    const bodies = results.map((r: any) => r.body);
    expect(bodies.filter((b: any) => b.applied === 1)).toHaveLength(1);
    expect(bodies.filter((b: any) => b.duplicate === 1)).toHaveLength(2);
    expect(await prisma.emailFeedbackEvent.count({ where: { deliveryId: d.row.id } })).toBe(1);
  });

  it('forged, re-signed-with-wrong-secret and stale requests are refused with 401 and change nothing', async () => {
    const d = await accepted();
    const bounce = [ev(d.messageId, 'bounce', { bounceType: 'permanent' })];
    expect((await post(bounce, { secret: 'attacker-guess-'.padEnd(48, 'a') })).status).toBe(401);
    expect((await post(bounce, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    const unsigned = await request(app.getHttpServer())
      .post('/v1/mail/feedback')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ events: bounce }));
    expect(unsigned.status).toBe(401);
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: d.row.id } })).status).toBe(
      'ACCEPTED',
    );
    expect(
      await prisma.emailSuppression.count({ where: { recipientHash: s.recipientHash(d.address) } }),
    ).toBe(0);
  });

  it('even a correctly signed event cannot suppress an address we never mailed, or a message never accepted', async () => {
    const forgedId = `<${'c'.repeat(25)}@mail.r21.test>`;
    const res = await post([
      ev(forgedId, 'complaint'),
      ev('<victim@example.test>', 'bounce', { bounceType: 'permanent' }),
    ]);
    expect(res.body).toEqual({ applied: 0, duplicate: 0, unmatched: 2 });

    // A queued (never accepted) message: feedback cannot be about it.
    const address = `r21-fb-${randomUUID()}@itest.local`;
    hashes.add(s.recipientHash(address));
    const queued = await prisma.$transaction((tx: any) =>
      s.mail.enqueue(
        {
          template: 'provider.verification_action_required',
          to: address,
          vars: {},
          expiresAt: new Date(Date.now() + 3_600_000),
        },
        tx,
      ),
    );
    const r2 = await post([
      ev(`<${queued.deliveryId}@mail.r21.test>`, 'bounce', { bounceType: 'permanent' }),
    ]);
    expect(r2.body.unmatched).toBe(1);
    expect(
      await prisma.emailSuppression.count({ where: { recipientHash: s.recipientHash(address) } }),
    ).toBe(0);
  });

  it('an extra field such as a recipient address in the payload is rejected outright', async () => {
    const d = await accepted();
    const res = await post([{ ...ev(d.messageId, 'complaint'), to: 'victim@example.test' }]);
    expect(res.status).toBe(400);
  });

  it('suppression never touches the account: status, sessions and roles are unchanged', async () => {
    const user = await prisma.user.create({
      data: {
        email: `r21-fb-${randomUUID()}@itest.local`,
        passwordHash: 'x',
        firstName: 'S',
        lastName: 'R21',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.add(user.id);
    hashes.add(s.recipientHash(user.email));
    const ticket = await prisma.$transaction((tx: any) =>
      s.mail.enqueue(
        {
          template: 'provider.verification_action_required',
          to: user.email,
          userId: user.id,
          vars: {},
          expiresAt: new Date(Date.now() + 3_600_000),
        },
        tx,
      ),
    );
    await s.mail.dispatch(ticket);
    await post([ev(`<${ticket.deliveryId}@mail.r21.test>`, 'bounce', { bounceType: 'permanent' })]);
    await post([ev(`<${ticket.deliveryId}@mail.r21.test>`, 'complaint')]);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ status: 'ACTIVE', isActive: true, deletedAt: null });
    expect(after.emailVerifiedAt).not.toBeNull();
  });

  it('returns 404 when no signing secret is configured (feedback disabled)', async () => {
    const disabled = await buildApp({ raw: true, secret: undefined });
    try {
      const d = await accepted();
      expect((await post([ev(d.messageId, 'delivered')], { target: disabled })).status).toBe(404);
    } finally {
      await disabled.close();
    }
  });

  it('fails closed (400) when main.ts has not mounted the raw body parser (CR-R21-01 missing)', async () => {
    const d = await accepted();
    expect((await post([ev(d.messageId, 'delivered')], { target: rawlessApp })).status).toBe(400);
    expect((await prisma.emailDelivery.findUniqueOrThrow({ where: { id: d.row.id } })).status).toBe(
      'ACCEPTED',
    );
  });

  // --- provider status email (outbox handler) -------------------------------

  async function providerFixture() {
    const user = await prisma.user.create({
      data: {
        email: `r21-pv-${randomUUID()}@itest.local`,
        passwordHash: 'x',
        firstName: 'P',
        lastName: 'R21',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.add(user.id);
    hashes.add(s.recipientHash(user.email));
    const profile = await prisma.providerProfile.create({
      data: { userId: user.id, displayName: 'R21 Provider', initials: 'RP' },
    });
    return { user, profile };
  }

  it('a correction request becomes one generic, bilingual email linking to the authenticated view', async () => {
    const { user, profile } = await providerFixture();
    try {
      const event = {
        id: `evt-${randomUUID()}`,
        eventType: 'verification.case.action_required',
        payload: { caseId: 'case-x', providerProfileId: profile.id },
      };
      const result = await prisma.$transaction((tx: any) => s.handler.handle(event, tx));
      await result.afterCommit();
      const msg = s.transport.lastSentTo(user.email);
      expect(msg.subject).toMatch(/needs attention/);
      expect(msg.text).toContain('https://app.example.test/provider/verification');
      expect(msg.text).not.toContain('case-x');
      expect(msg.html).toContain('dir="rtl"');
      // Replaying the same event (e.g. marker lost) is still one message.
      await prisma.$transaction((tx: any) => s.handler.handle(event, tx));
      expect(
        await prisma.emailDelivery.count({ where: { recipientHash: s.recipientHash(user.email) } }),
      ).toBe(1);
    } finally {
      await prisma.providerProfile.deleteMany({ where: { id: profile.id } });
    }
  });

  it('a rolled-back worker transaction leaves no provider email intent', async () => {
    const { user, profile } = await providerFixture();
    try {
      const event = {
        id: `evt-${randomUUID()}`,
        eventType: 'verification.case.rejected',
        payload: { caseId: 'c', providerProfileId: profile.id },
      };
      await expect(
        prisma.$transaction(async (tx: any) => {
          await s.handler.handle(event, tx);
          throw new Error('synthetic sibling handler failure');
        }),
      ).rejects.toThrow('synthetic');
      expect(
        await prisma.emailDelivery.count({ where: { recipientHash: s.recipientHash(user.email) } }),
      ).toBe(0);
    } finally {
      await prisma.providerProfile.deleteMany({ where: { id: profile.id } });
    }
  });
});
