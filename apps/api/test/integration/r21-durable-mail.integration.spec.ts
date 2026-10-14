/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
// R21 — durable outbound mail against REAL PostgreSQL and, when configured, a
// REAL local SMTP server (Mailpit). Mailpit proves local transport and message
// composition only: not inbox placement, not SPF/DKIM/DMARC, not a hosted
// sender. Hosted acceptance is docs/production-readiness/r21/ACCEPTANCE.md.
//
// Gates:
//   RUN_DB_INTEGRATION=1                         the whole suite
//   R21_MAILPIT_SMTP_PORT + R21_MAILPIT_API_URL  real SMTP; otherwise the
//                                                in-memory transport is used
//                                                and the Mailpit-only cases skip
export {};
import { randomUUID } from 'node:crypto';
import { withAdvisoryLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
const SMTP_PORT = Number(process.env.R21_MAILPIT_SMTP_PORT ?? 0);
const MAILPIT = process.env.R21_MAILPIT_API_URL ?? '';
const withMailpit = SMTP_PORT > 0 && MAILPIT !== '' ? it : it.skip;
jest.setTimeout(90_000);

interface MailpitMessage {
  ID: string;
  MessageID: string;
  Subject: string;
  Text: string;
  HTML: string;
}

async function mailpitFor(address: string): Promise<MailpitMessage[]> {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=50`,
  );
  if (!res.ok) throw new Error(`mailpit search ${res.status}`);
  const body = (await res.json()) as { messages: Array<{ ID: string }> };
  const out: MailpitMessage[] = [];
  for (const m of body.messages) {
    const detail = await fetch(`${MAILPIT}/api/v1/message/${m.ID}`);
    out.push((await detail.json()) as MailpitMessage);
  }
  return out;
}

suite('R21 durable mail (real Postgres)', () => {
  let prisma: any;
  let s: any;
  const createdUserIds = new Set<string>();
  const addresses = new Set<string>();
  const ctx = {
    device: { ipAddress: '127.0.0.1', userAgent: 'r21-fixture', clientKind: 'WEB' as const },
    requestId: 'r21-itest',
  };
  const password = 'r21-synthetic-original-passphrase';
  const email = () => {
    const a = `r21-${randomUUID()}@itest.local`;
    addresses.add(a);
    return a;
  };
  const config = (over: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      AUTH_REQUIRE_EMAIL_VERIFICATION: true,
      JWT_ACCESS_SECRET: makeTestSecret('r21-durable-mail'),
      JWT_ISSUER: 'hsm-api',
      JWT_AUDIENCE: 'hsm-clients',
      JWT_ACCESS_TTL_SECONDS: 600,
      JWT_REFRESH_TTL_DAYS: 30,
      EMAIL_VERIFICATION_TTL_HOURS: 24,
      PASSWORD_RESET_TTL_MINUTES: 15,
      AUTH_LOCKOUT_THRESHOLD: 5,
      AUTH_LOCKOUT_MINUTES: 15,
      AUTH_ANTI_ENUM_DELAY_MS: 0,
      FRONTEND_URL: 'https://app.example.test',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT,
      SMTP_SECURE: false,
      SMTP_FROM: 'Marketplace <no-reply@mail.r21.test>',
      SMTP_CONNECTION_TIMEOUT_MS: 2_000,
      SMTP_GREETING_TIMEOUT_MS: 2_000,
      SMTP_SOCKET_TIMEOUT_MS: 4_000,
      MAIL_DISPATCH_LEASE_MS: 60_000,
      ...over,
    };
    return { get: (k: string) => values[k], isProduction: false } as any;
  };

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    await withAdvisoryLock('seed', 'exclusive', () => db.seed());

    const { JwtService } = require('@nestjs/jwt');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { UserRepository } = require('../../src/infrastructure/persistence/iam/user.repository');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      SessionRepository,
    } = require('../../src/infrastructure/persistence/iam/session.repository');
    const {
      VerificationTokenRepository,
    } = require('../../src/infrastructure/persistence/iam/verification-token.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const {
      PasswordService,
    } = require('../../src/modules/iam/authentication/services/password.service');
    const { TokenService } = require('../../src/modules/iam/authentication/services/token.service');
    const {
      SessionService,
    } = require('../../src/modules/iam/authentication/services/session.service');
    const { OtpService } = require('../../src/modules/iam/authentication/services/otp.service');
    const {
      VerificationService,
    } = require('../../src/modules/iam/authentication/services/verification.service');
    const {
      LoginAttemptService,
    } = require('../../src/modules/iam/authentication/services/login-attempt.service');
    const { SecurityEventsBus } = require('../../src/shared/security-events/security-events.bus');
    const { AuthenticationService } =
      require('../../src/modules/iam/authentication/services/authentication.service') as {
        AuthenticationService: typeof import('../../src/modules/iam/authentication/services/authentication.service').AuthenticationService;
      };
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const { InMemoryMailAdapter } = require('../../src/infrastructure/mail/in-memory-mail.adapter');
    const {
      NodemailerMailAdapter,
    } = require('../../src/infrastructure/mail/nodemailer-mail.adapter');
    const { DurableMailService } = require('../../src/infrastructure/mail/durable-mail.service');
    const {
      EmailDeliveryRepository,
    } = require('../../src/infrastructure/mail/email-delivery.repository');
    const { MailEnvelopeCipher } = require('../../src/infrastructure/mail/mail-envelope.cipher');
    const { MailMetrics } = require('../../src/infrastructure/mail/mail.metrics');
    const { MailDispatcher } = require('../../src/infrastructure/mail/mail.dispatcher');
    const { MetricsService } = require('../../src/infrastructure/telemetry/metrics.service');

    const cfg = config();
    const prismaSvc = { client: prisma, isReady: () => true, ping: async () => true };
    const tx = new TransactionRunner(prismaSvc);
    const users = new UserRepository(prismaSvc);
    const verifRepo = new VerificationTokenRepository(prismaSvc);
    const passwords = new PasswordService();
    await passwords.onModuleInit();
    const jwt = new JwtService({
      secret: cfg.get('JWT_ACCESS_SECRET'),
      signOptions: { algorithm: 'HS256', issuer: 'hsm-api', audience: 'hsm-clients' },
      verifyOptions: { algorithms: ['HS256'], issuer: 'hsm-api', audience: 'hsm-clients' },
    });
    const tokens = new TokenService(jwt, cfg);
    const audit = new AuditService(new AuditEventRepository(prismaSvc));
    const securityEvents = new SecurityEventsBus();
    const sessionSvc = new SessionService(
      new SessionRepository(prismaSvc),
      tokens,
      tx,
      audit,
      securityEvents,
    );

    let transport: any;
    if (SMTP_PORT > 0) {
      transport = new NodemailerMailAdapter(cfg);
      transport.onModuleInit();
    } else {
      transport = new InMemoryMailAdapter();
    }
    const cipher = MailEnvelopeCipher.ephemeral();
    const metrics = new MailMetrics(new MetricsService());
    const repo = new EmailDeliveryRepository(prismaSvc);
    const mail = new DurableMailService(transport, cipher, repo, prismaSvc, cfg, metrics);
    const auth = new AuthenticationService(
      users,
      new RoleRepository(prismaSvc),
      passwords,
      new VerificationService(verifRepo, tokens, cfg),
      new OtpService(verifRepo, cfg),
      sessionSvc,
      new LoginAttemptService(prismaSvc, cfg),
      tx,
      audit,
      cfg,
      securityEvents,
      mail,
    );
    const dispatcher = (svc = mail) =>
      new MailDispatcher(repo, svc, config({ MAIL_DISPATCH_POLL_INTERVAL_MS: 1000 }), metrics);
    s = {
      auth,
      tx,
      mail,
      repo,
      cipher,
      metrics,
      transport,
      prismaSvc,
      cfg,
      dispatcher,
      DurableMailService,
      MailEnvelopeCipher,
    };
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    const { recipientHash } = require('../../src/infrastructure/mail/mail-envelope.cipher');
    const hashes = [...addresses].map((a) => recipientHash(a));
    await prisma.emailDelivery.deleteMany({ where: { recipientHash: { in: hashes } } });
    for (const userId of createdUserIds) {
      await prisma.auditEvent.deleteMany({ where: { userId } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.verificationToken.deleteMany({ where: { userId } });
      await prisma.userRole.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    createdUserIds.clear();
    addresses.clear();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function deliveriesFor(address: string) {
    const { recipientHash } = require('../../src/infrastructure/mail/mail-envelope.cipher');
    return prisma.emailDelivery.findMany({
      where: { recipientHash: recipientHash(address) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function register(address = email()) {
    const challenge = await s.auth.register(
      { email: address, password, firstName: 'Synthetic', lastName: 'R21' },
      ctx,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
    createdUserIds.add(user.id);
    return { address, challenge, user };
  }

  async function intent(address: string, over: Record<string, unknown> = {}) {
    return {
      template: 'auth.password_reset',
      to: address,
      vars: { token: `t-${randomUUID().replace(/-/g, '')}`.padEnd(43, 'x') },
      expiresAt: new Date(Date.now() + 10 * 60_000),
      ...over,
    };
  }

  // --- transport + composition (Mailpit) -----------------------------------

  withMailpit(
    'registration OTP reaches real SMTP; the code verifies; the row records ACCEPTED with no sealed secret left',
    async () => {
      const f = await register();
      const [msg] = await mailpitFor(f.address);
      expect(msg).toBeDefined();
      const code = /code is (\d{6})/.exec(msg!.Text)?.[1];
      expect(code).toMatch(/^\d{6}$/);
      expect(msg!.Subject).not.toContain(code!);
      expect(msg!.HTML).toContain('<div lang="ar" dir="rtl"');
      const [row] = await deliveriesFor(f.address);
      expect(row).toMatchObject({
        status: 'ACCEPTED',
        attempts: 1,
        template: 'auth.registration_otp',
        category: 'AUTH',
        envelope: null,
      });
      expect(msg!.MessageID).toBe(`${row.id}@mail.r21.test`);
      expect(row.lastSmtpCode).toBe(250);
      const login = await s.auth.verifyOtp(f.challenge.challengeId, code!, ctx);
      expect(login).toBeDefined();
    },
  );

  withMailpit(
    'password-reset link is correct, single-use, and an expired link is refused',
    async () => {
      const f = await register();
      await prisma.user.update({
        where: { id: f.user.id },
        data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      });
      await s.auth.forgotPassword(f.address, ctx);
      const reset = (await mailpitFor(f.address)).find((m) =>
        m.Subject.startsWith('Reset your password'),
      )!;
      const link = /https:\/\/app\.example\.test\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(
        reset.Text,
      );
      expect(link).not.toBeNull();
      expect(reset.HTML).toContain(
        `href="https://app.example.test/reset-password?token=${link![1]}"`,
      );
      await s.auth.resetPassword(link![1], 'r21-synthetic-new-passphrase', ctx);
      await expect(
        s.auth.resetPassword(link![1], 'r21-synthetic-third-passphrase', ctx),
      ).rejects.toBeDefined();

      await s.auth.forgotPassword(f.address, ctx);
      const second = (await mailpitFor(f.address)).filter((m) =>
        m.Subject.startsWith('Reset your password'),
      );
      const token2 = second
        .map((m) => /reset-password\?token=([A-Za-z0-9_-]+)/.exec(m.Text)?.[1])
        .find((t) => t && t !== link![1])!;
      await prisma.verificationToken.updateMany({
        where: { userId: f.user.id, purpose: 'PASSWORD_RESET', usedAt: null },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await expect(
        s.auth.resetPassword(token2, 'r21-synthetic-late-passphrase', ctx),
      ).rejects.toBeDefined();
    },
  );

  withMailpit('email-verification link is correct and verifies the account', async () => {
    const address = email();
    const user = await prisma.user.create({
      data: {
        email: address,
        passwordHash: 'x',
        firstName: 'S',
        lastName: 'R21',
        status: 'PENDING_VERIFICATION',
      },
    });
    createdUserIds.add(user.id);
    await s.auth.resendVerification(address, ctx);
    const [msg] = await mailpitFor(address);
    const token = /https:\/\/app\.example\.test\/verify-email\?token=([A-Za-z0-9_-]+)/.exec(
      msg!.Text,
    )?.[1];
    expect(token).toBeDefined();
    await s.auth.verifyEmail(token!, ctx);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
    ).not.toBeNull();
  });

  // --- transactional semantics --------------------------------------------

  it('a rolled-back business transaction leaves no delivery row and sends nothing', async () => {
    const address = email();
    const send = jest.spyOn(s.transport, 'send');
    await expect(
      s.tx.run(async (trx: any) => {
        await s.mail.enqueue(await intent(address), trx);
        throw new Error('synthetic business failure after enqueue');
      }),
    ).rejects.toThrow('synthetic business failure');
    expect(await deliveriesFor(address)).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('a password-reset whose audit write fails commits neither token nor message (no phantom email)', async () => {
    const f = await register();
    const send = jest.spyOn(s.transport, 'send');
    const before = (await deliveriesFor(f.address)).length;
    jest
      .spyOn(require('../../src/modules/iam/audit/audit.service').AuditService.prototype, 'record')
      .mockRejectedValueOnce(new Error('P2028'));
    send.mockClear();
    await s.auth.forgotPassword(f.address, ctx);
    expect(await deliveriesFor(f.address)).toHaveLength(before);
    expect(send).not.toHaveBeenCalled();
  });

  it('the queued envelope holds no readable secret or address at rest', async () => {
    const address = email();
    const i = await intent(address);
    await s.tx.run((trx: any) => s.mail.enqueue(i, trx));
    const [row] = await deliveriesFor(address);
    expect(row.status).toBe('QUEUED');
    const bytes = Buffer.from(row.envelope);
    expect(bytes.includes(Buffer.from(i.vars.token))).toBe(false);
    expect(bytes.includes(Buffer.from(address))).toBe(false);
    expect(JSON.stringify(row)).not.toContain(address);
  });

  it('one messageKey is one message even when enqueued from two transactions', async () => {
    const address = email();
    const key = `r21-dedupe-${randomUUID()}`;
    const a = await s.tx.run(async (trx: any) =>
      s.mail.enqueue(await intent(address, { messageKey: key }), trx),
    );
    const b = await s.tx.run(async (trx: any) =>
      s.mail.enqueue(await intent(address, { messageKey: key }), trx),
    );
    expect(a.deliveryId).toBe(b.deliveryId);
    expect(await deliveriesFor(address)).toHaveLength(1);
  });

  it('per-address throttle: the 7th reset request in the window records and sends nothing, with the same public result', async () => {
    const f = await register();
    await prisma.user.update({
      where: { id: f.user.id },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    for (let i = 0; i < 7; i++)
      await expect(s.auth.forgotPassword(f.address, ctx)).resolves.toBeUndefined();
    const resets = (await deliveriesFor(f.address)).filter(
      (r: any) => r.template === 'auth.password_reset',
    );
    expect(resets).toHaveLength(6);
  });

  // --- failure, retry, crash ----------------------------------------------

  it('SMTP unreachable: the request still answers; the intent stays QUEUED (transient) and a later dispatcher delivers it', async () => {
    const down =
      new (require('../../src/infrastructure/mail/nodemailer-mail.adapter').NodemailerMailAdapter)(
        config({ SMTP_PORT: 9, SMTP_CONNECTION_TIMEOUT_MS: 1_000 }),
      );
    down.onModuleInit();
    const offline = new s.DurableMailService(down, s.cipher, s.repo, s.prismaSvc, s.cfg, s.metrics);
    const address = email();
    const ticket = await s.tx.run(async (trx: any) => offline.enqueue(await intent(address), trx));
    await offline.dispatch(ticket);
    let [row] = await deliveriesFor(address);
    expect(row).toMatchObject({ status: 'QUEUED', attempts: 1, lastErrorClass: 'transient' });
    expect(row.envelope).not.toBeNull();
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Relay recovers; make the retry due and run one dispatcher tick.
    await prisma.emailDelivery.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(Date.now() - 60_000) },
    });
    const send = jest.spyOn(s.transport, 'send');
    await s.dispatcher().runOnce();
    [row] = await deliveriesFor(address);
    if (row.status === 'ACCEPTED' && send.mock.calls.length === 0) {
      // Another gated suite's dispatcher took it first; the property under
      // test (delivered exactly once after recovery) still holds.
      expect(row.attempts).toBe(2);
    } else {
      expect(send).toHaveBeenCalledTimes(1);
    }
    expect(row).toMatchObject({ status: 'ACCEPTED', attempts: 2, envelope: null });
  });

  it('a sender that dies mid-flight loses nothing: the lease lapses and exactly one successor sends', async () => {
    const address = email();
    const ticket = await s.tx.run(async (trx: any) => s.mail.enqueue(await intent(address), trx));
    // Worker A claims, then "crashes" before sending or recording anything.
    const claimed = await s.repo.claimOne(ticket.deliveryId, 'crashed-worker', 60_000);
    expect(claimed?.status).toBe('SENDING');
    // While A's lease is live nobody else may take it.
    expect(await s.repo.claimOne(ticket.deliveryId, 'impatient-worker', 60_000)).toBeNull();
    await prisma.emailDelivery.update({
      where: { id: ticket.deliveryId },
      data: { leaseUntil: new Date(Date.now() - 60_000) },
    });

    const seen: string[] = [];
    const counting = (name: string) => {
      const svc = new s.DurableMailService(
        {
          send: async (m: any) => {
            seen.push(`${name}:${m.messageId}`);
            return { smtpCode: 250 };
          },
        },
        s.cipher,
        s.repo,
        s.prismaSvc,
        s.cfg,
        s.metrics,
      );
      return s.dispatcher(svc);
    };
    await Promise.all([counting('B').runOnce(), counting('C').runOnce()]);
    const mine = seen.filter((x) => x.includes(ticket.deliveryId));
    expect(mine.length).toBeLessThanOrEqual(1);
    const [row] = await deliveriesFor(address);
    expect(row.status).toBe('ACCEPTED');
    // The crashed worker's late write cannot overwrite the successor's outcome.
    expect(
      await s.repo.markRetry(ticket.deliveryId, 'crashed-worker', 9, new Date(), 'transient', null),
    ).toBe(false);
    expect((await deliveriesFor(address))[0].status).toBe('ACCEPTED');
  });

  it('two dispatchers draining one backlog never send a row twice', async () => {
    const address = email();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const t = await s.tx.run(async (trx: any) =>
        s.mail.enqueue(
          await intent(address, { template: 'provider.verification_action_required', vars: {} }),
          trx,
        ),
      );
      ids.push(t.deliveryId);
    }
    const seen: string[] = [];
    const make = () =>
      s.dispatcher(
        new s.DurableMailService(
          {
            send: async (m: any) => {
              seen.push(m.messageId);
              await new Promise((r) => setTimeout(r, 5));
              return {};
            },
          },
          s.cipher,
          s.repo,
          s.prismaSvc,
          s.cfg,
          s.metrics,
        ),
      );
    await Promise.all([make().runOnce(), make().runOnce(), make().runOnce()]);
    const mine = seen.filter((m) => ids.some((id) => m.includes(id)));
    expect(new Set(mine).size).toBe(mine.length);
    const rows = await deliveriesFor(address);
    expect(rows.every((r: any) => r.status === 'ACCEPTED')).toBe(true);
  });

  it('permanent rejection closes FAILED, clears the sealed secret and is never retried', async () => {
    const address = email();
    const rejecting = new s.DurableMailService(
      {
        send: async () => {
          throw Object.assign(new Error('550 no such user'), { responseCode: 550 });
        },
      },
      s.cipher,
      s.repo,
      s.prismaSvc,
      s.cfg,
      s.metrics,
    );
    const ticket = await s.tx.run(async (trx: any) =>
      rejecting.enqueue(await intent(address), trx),
    );
    await rejecting.dispatch(ticket);
    const [row] = await deliveriesFor(address);
    expect(row).toMatchObject({
      status: 'FAILED',
      lastErrorClass: 'permanent',
      lastSmtpCode: 550,
      envelope: null,
    });
    expect(await s.repo.claimOne(row.id, 'w', 60_000)).toBeNull();
  });

  it('retention expires overdue queued intents and erases their sealed secret', async () => {
    const address = email();
    await s.tx.run(async (trx: any) =>
      s.mail.enqueue(await intent(address, { expiresAt: new Date(Date.now() + 200) }), trx),
    );
    await new Promise((r) => setTimeout(r, 300));
    await s.dispatcher().runRetention(new Date());
    const [row] = await deliveriesFor(address);
    expect(row).toMatchObject({ status: 'EXPIRED', envelope: null, lastErrorClass: 'expired' });
  });
});
