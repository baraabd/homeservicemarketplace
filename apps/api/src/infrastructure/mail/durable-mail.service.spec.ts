import { Logger } from '@nestjs/common';
import type { EmailDelivery } from '@homeservicemarketplace/database';

import type { AppConfigService } from '../../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../telemetry/metrics.service';
import { deliveryIdFromMessageId, DurableMailService, senderDomain } from './durable-mail.service';
import type { EmailDeliveryRepository } from './email-delivery.repository';
import { InMemoryMailAdapter } from './in-memory-mail.adapter';
import { MailEnvelopeCipher } from './mail-envelope.cipher';
import { MailMetrics } from './mail.metrics';

// R21 — the per-attempt state machine, with a fake repository. The same paths
// run against real PostgreSQL in test/integration/r21-*.integration.spec.ts.

const TOKEN = 'reset-token-'.padEnd(43, 'q');
const WORKER = 'w-1';

function harness() {
  const cipher = MailEnvelopeCipher.ephemeral();
  const transport = new InMemoryMailAdapter();
  const metrics = new MailMetrics(new MetricsService());
  const repo = {
    markAccepted: jest.fn().mockResolvedValue(true),
    markRetry: jest.fn().mockResolvedValue(true),
    markClosed: jest.fn().mockResolvedValue(true),
    isSuppressed: jest.fn().mockResolvedValue(false),
  };
  const config = {
    get: (k: string) =>
      ({
        SMTP_FROM: 'Marketplace <no-reply@mail.example.test>',
        FRONTEND_URL: 'https://app.example.test',
        MAIL_DISPATCH_LEASE_MS: 90_000,
      })[k],
  } as unknown as AppConfigService;
  const svc = new DurableMailService(
    transport,
    cipher,
    repo as unknown as EmailDeliveryRepository,
    {} as PrismaService,
    config,
    metrics,
  );
  const row = (over: Partial<EmailDelivery> = {}): EmailDelivery => {
    const messageKey = over.messageKey ?? 'auth.password_reset:k1';
    return {
      id: 'cmabcdefghijklmnopqrstuv',
      messageKey,
      category: 'AUTH',
      template: 'auth.password_reset',
      userId: 'u1',
      recipientHash: 'h',
      envelope: cipher.seal(messageKey, { to: 'ada@example.test', vars: { token: TOKEN } }),
      status: 'SENDING',
      attempts: 0,
      maxAttempts: 6,
      nextAttemptAt: new Date(),
      leaseUntil: new Date(Date.now() + 60_000),
      leasedBy: WORKER,
      lastErrorClass: null,
      lastSmtpCode: null,
      acceptedAt: null,
      outcomeAt: null,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    } as EmailDelivery;
  };
  return { svc, repo, transport, cipher, row };
}

describe('DurableMailService.process', () => {
  it('sends the rendered bilingual message with a stable Message-ID and records ACCEPTED, not DELIVERED', async () => {
    const h = harness();
    await h.svc.process(h.row(), WORKER);
    const sent = h.transport.lastSentTo('ada@example.test')!;
    expect(sent.text).toContain(`https://app.example.test/reset-password?token=${TOKEN}`);
    expect(sent.html).toContain('dir="rtl"');
    expect(sent.messageId).toBe('<cmabcdefghijklmnopqrstuv@mail.example.test>');
    expect(h.repo.markAccepted).toHaveBeenCalledWith('cmabcdefghijklmnopqrstuv', WORKER, 1, null);
  });

  it('temporary rejection (4xx) schedules a backed-off retry inside the validity window', async () => {
    const h = harness();
    jest
      .spyOn(h.transport, 'send')
      .mockRejectedValueOnce(Object.assign(new Error('451 try later'), { responseCode: 451 }));
    const before = Date.now();
    await h.svc.process(h.row({ attempts: 1 }), WORKER);
    const [, , attempts, when, cls, code] = h.repo.markRetry.mock.calls[0]!;
    expect([attempts, cls, code]).toEqual([2, 'transient', 451]);
    // attempt 2 → base 5s * 2 = 10s ± 20%
    expect((when as Date).getTime() - before).toBeGreaterThanOrEqual(8_000);
    expect((when as Date).getTime() - before).toBeLessThanOrEqual(12_500);
  });

  it('permanent rejection (5xx) closes FAILED and does not retry', async () => {
    const h = harness();
    jest
      .spyOn(h.transport, 'send')
      .mockRejectedValueOnce(Object.assign(new Error('550'), { responseCode: 550 }));
    await h.svc.process(h.row(), WORKER);
    expect(h.repo.markRetry).not.toHaveBeenCalled();
    expect(h.repo.markClosed).toHaveBeenCalledWith(
      expect.any(String),
      WORKER,
      'FAILED',
      1,
      'permanent',
      550,
    );
  });

  it('a spent attempt budget closes FAILED as exhausted transient', async () => {
    const h = harness();
    jest
      .spyOn(h.transport, 'send')
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }));
    await h.svc.process(h.row({ attempts: 5, maxAttempts: 6 }), WORKER);
    expect(h.repo.markClosed).toHaveBeenCalledWith(
      expect.any(String),
      WORKER,
      'FAILED',
      6,
      'transient',
      null,
    );
  });

  it('a retry that would land after the code expires closes EXPIRED instead', async () => {
    const h = harness();
    jest
      .spyOn(h.transport, 'send')
      .mockRejectedValueOnce(Object.assign(new Error('x'), { responseCode: 421 }));
    await h.svc.process(h.row({ attempts: 4, expiresAt: new Date(Date.now() + 2_000) }), WORKER);
    expect(h.repo.markClosed).toHaveBeenCalledWith(
      expect.any(String),
      WORKER,
      'EXPIRED',
      5,
      'expired',
      421,
    );
  });

  it('never sends an expired intent', async () => {
    const h = harness();
    const send = jest.spyOn(h.transport, 'send');
    await h.svc.process(h.row({ expiresAt: new Date(Date.now() - 1) }), WORKER);
    expect(send).not.toHaveBeenCalled();
    expect(h.repo.markClosed).toHaveBeenCalledWith(
      expect.any(String),
      WORKER,
      'EXPIRED',
      0,
      'expired',
      null,
    );
  });

  it('an envelope that does not open (key rotated, tampered, moved) closes FAILED/undecryptable without sending', async () => {
    const h = harness();
    const send = jest.spyOn(h.transport, 'send');
    const other = MailEnvelopeCipher.ephemeral().seal('auth.password_reset:k1', {
      to: 'x@y.z',
      vars: { token: TOKEN },
    });
    await h.svc.process(h.row({ envelope: other }), WORKER);
    expect(send).not.toHaveBeenCalled();
    expect(h.repo.markClosed).toHaveBeenCalledWith(
      expect.any(String),
      WORKER,
      'FAILED',
      0,
      'undecryptable',
      null,
    );
  });

  it('suppression stops NOTIFICATION mail …', async () => {
    const h = harness();
    h.repo.isSuppressed.mockResolvedValue(true);
    const send = jest.spyOn(h.transport, 'send');
    const messageKey = 'n:1';
    await h.svc.process(
      h.row({
        messageKey,
        category: 'NOTIFICATION',
        template: 'provider.verification_action_required',
        envelope: h.cipher.seal(messageKey, { to: 'ada@example.test', vars: {} }),
      }),
      WORKER,
    );
    expect(send).not.toHaveBeenCalled();
    expect(h.repo.markClosed).toHaveBeenCalledWith(
      expect.any(String),
      WORKER,
      'SUPPRESSED',
      0,
      'suppressed',
      null,
    );
  });

  it('… but never AUTH mail: feedback cannot silently lock a user out of recovery', async () => {
    const h = harness();
    h.repo.isSuppressed.mockResolvedValue(true);
    await h.svc.process(h.row(), WORKER);
    expect(h.repo.isSuppressed).not.toHaveBeenCalled();
    expect(h.repo.markAccepted).toHaveBeenCalled();
  });

  it('logs never contain the recipient, the token or the driver message', async () => {
    const h = harness();
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        lines.push(JSON.stringify(args[0]));
      });
    }
    jest.spyOn(h.transport, 'send').mockRejectedValueOnce(
      Object.assign(new Error(`451 ${TOKEN} ada@example.test smtp://u:p@h`), {
        responseCode: 451,
      }),
    );
    await h.svc.process(h.row(), WORKER);
    await h.svc.process(h.row(), WORKER);
    const all = lines.join('\n');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('ada@example.test');
    expect(all).not.toContain('smtp://');
    jest.restoreAllMocks();
  });
});

describe('DurableMailService.enqueue throttle', () => {
  function withCounts(recent: number) {
    const h = harness();
    const repo = h.repo as unknown as Record<string, jest.Mock>;
    repo.countRecent = jest.fn().mockResolvedValue(recent);
    repo.insertIfAbsent = jest.fn().mockResolvedValue({ id: 'd1' });
    return { ...h, repo };
  }
  const tx = {} as never;
  const later = () => new Date(Date.now() + 60_000);

  it('drops the 7th anonymous-triggerable message to one address silently (no row, no error)', async () => {
    const h = withCounts(6);
    const t = await h.svc.enqueue(
      {
        template: 'auth.password_reset',
        to: 'a@x.test',
        vars: { token: TOKEN },
        expiresAt: later(),
      },
      tx,
    );
    expect(t).toEqual({ deliveryId: null, intent: null });
    expect(h.repo.insertIfAbsent).not.toHaveBeenCalled();
  });

  it('records the 6th', async () => {
    const h = withCounts(5);
    const t = await h.svc.enqueue(
      {
        template: 'auth.email_verification',
        to: 'a@x.test',
        vars: { token: TOKEN },
        expiresAt: later(),
      },
      tx,
    );
    expect(t.deliveryId).toBe('d1');
  });

  it('never throttles OTP mail, which only the account owner can trigger repeatedly', async () => {
    const h = withCounts(99);
    const t = await h.svc.enqueue(
      {
        template: 'auth.login_otp',
        to: 'a@x.test',
        vars: { code: '123456', minutes: 5 },
        expiresAt: later(),
      },
      tx,
    );
    expect(t.deliveryId).toBe('d1');
    expect(h.repo.countRecent).not.toHaveBeenCalled();
  });

  it('rejects invalid template variables before anything is stored', async () => {
    const h = withCounts(0);
    await expect(
      h.svc.enqueue(
        {
          template: 'auth.login_otp',
          to: 'a@x.test',
          vars: { code: '<script>', minutes: 5 },
          expiresAt: later(),
        },
        tx,
      ),
    ).rejects.toThrow(/Invalid variables/);
    expect(h.repo.insertIfAbsent).not.toHaveBeenCalled();
  });
});

describe('Message-ID helpers', () => {
  it('derive the sender domain from SMTP_FROM in either address form', () => {
    expect(senderDomain('Marketplace <No-Reply@Mail.Example.test>')).toBe('mail.example.test');
    expect(senderDomain('no-reply@example.test')).toBe('example.test');
    expect(senderDomain('garbage')).toBe('localhost');
  });

  it('only decode ids we could have minted', () => {
    expect(deliveryIdFromMessageId('<cmabcdefghijklmnopqrstuv@mail.example.test>')).toBe(
      'cmabcdefghijklmnopqrstuv',
    );
    expect(deliveryIdFromMessageId('cmabcdefghijklmnopqrstuv@x.test')).toBe(
      'cmabcdefghijklmnopqrstuv',
    );
    expect(deliveryIdFromMessageId('<../../etc@x>')).toBeNull();
    expect(deliveryIdFromMessageId("<a'; DROP TABLE x;--@x.test>")).toBeNull();
  });
});
