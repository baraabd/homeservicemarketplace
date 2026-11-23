import { fork, spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Prisma } from '@homeservicemarketplace/database';
import { disputeHttpApp, type DisputeHttpApp } from '../support/dispute-http-app';

const enabled = process.env.RUN_WHATSAPP_BROWSER === '1';

// Real AppModule, HTTP validation/guards, PostgreSQL, Redis, encrypted delivery
// queue and browser. The external WhatsApp sender is captured; the browser
// intercepts only delayed/failed public configuration reads before recovering
// through the actual endpoint. Codes and test-owned expiry controls cross
// private IPC, never a debug HTTP endpoint.
(enabled ? describe : describe.skip)('Passwordless WhatsApp browser acceptance', () => {
  jest.setTimeout(600_000);
  let h: DisputeHttpApp | undefined;
  let vite: ChildProcess | undefined;
  let child: ChildProcess | undefined;
  let previousPolicy: { value: Prisma.JsonValue; updatedBy: string | null } | null = null;
  let policyCaptured = false;
  const sent = new Map<string, string[]>();
  const phones = {
    seeker: '+12025550101',
    provider: '+12025550102',
    admin: '+12025550103',
  };
  const progress: string[] = [];

  afterAll(async () => {
    for (const owned of [child, vite]) {
      if (owned?.pid && owned.exitCode === null && owned.signalCode === null) {
        owned.kill('SIGTERM');
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          new Promise<void>((done) => owned.once('exit', () => done())),
          new Promise<void>((done) => {
            timer = setTimeout(done, 3000);
          }),
        ]);
        clearTimeout(timer);
        if (owned.exitCode === null && owned.signalCode === null) {
          owned.kill('SIGKILL');
          await new Promise<void>((done) => owned.once('exit', () => done()));
        }
      }
    }
    if (h) {
      const db = h.fixture.db;
      try {
        if (policyCaptured) {
          await db.platformSettingHistory.deleteMany({
            where: { key: 'auth.otpChannel', changedBy: { in: Object.values(h.fixture.users) } },
          });
          if (previousPolicy) {
            await db.platformSetting.upsert({
              where: { key: 'auth.otpChannel' },
              create: {
                key: 'auth.otpChannel',
                ...previousPolicy,
                value: previousPolicy.value as Prisma.InputJsonValue,
              },
              update: { ...previousPolicy, value: previousPolicy.value as Prisma.InputJsonValue },
            });
          } else {
            await db.platformSetting.deleteMany({ where: { key: 'auth.otpChannel' } });
          }
        }
      } finally {
        await h.dispose();
      }
    }
  });

  it('keeps forms through policy failures, honors the selected method and verifies phone possession', async () => {
    const database = new URL(process.env.DATABASE_URL ?? 'postgresql://missing/missing');
    if (
      process.env.RUN_DB_INTEGRATION !== '1' ||
      process.env.WHATSAPP_BROWSER_SCOPE !== 'isolated-test' ||
      !['localhost', '127.0.0.1'].includes(database.hostname) ||
      !['/r04_auth_ci', '/hsm_whatsapp_browser_ci'].includes(database.pathname)
    )
      throw new Error('WhatsApp browser acceptance requires its disposable local database.');
    h = await disputeHttpApp({
      emailAuthentication: false,
      whatsapp: {
        isConfigured: () => true,
        sendCode: async (destination, code) => {
          if (!Object.values(phones).includes(destination))
            throw new Error('Unexpected recipient outside synthetic browser fixtures');
          sent.set(destination, [...(sent.get(destination) ?? []), code]);
        },
      },
    });
    const { db, users } = h.fixture;
    previousPolicy = await db.platformSetting.findUnique({
      where: { key: 'auth.otpChannel' },
      select: { value: true, updatedBy: true },
    });
    policyCaptured = true;
    await db.platformSetting.upsert({
      where: { key: 'auth.otpChannel' },
      create: { key: 'auth.otpChannel', value: 'whatsapp' },
      update: { value: 'whatsapp', updatedBy: null },
    });
    const actors = {
      seeker: { userId: users.seeker, phone: phones.seeker, path: '/home' },
      provider: { userId: users.provider, phone: phones.provider, path: '/provider' },
      admin: { userId: users.reviewer, phone: phones.admin, path: '/admin' },
    };
    for (const actor of Object.values(actors)) {
      await db.user.update({
        where: { id: actor.userId },
        data: { phoneNumber: actor.phone, phoneVerifiedAt: new Date() },
      });
    }

    const webRoot = resolve(__dirname, '../../../web');
    const webPort = 14252;
    const web = `http://127.0.0.1:${webPort}`;
    const output = resolve(__dirname, '../../../../test-results/whatsapp-login');
    await mkdir(output, { recursive: true });
    const logs: string[] = [];
    vite = spawn(
      process.execPath,
      [
        resolve(webRoot, 'node_modules/vite/bin/vite.js'),
        '--host',
        '127.0.0.1',
        '--port',
        String(webPort),
        '--strictPort',
      ],
      {
        cwd: webRoot,
        env: { ...process.env, VITE_API_URL: h.url },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    vite.stdout?.on('data', (chunk) => logs.push(String(chunk)));
    vite.stderr?.on('data', (chunk) => logs.push(String(chunk)));
    for (let attempt = 0; ; attempt++) {
      if (attempt > 90 || vite.exitCode !== null)
        throw new Error(`WhatsApp browser Vite startup failed: ${logs.join('').slice(-2000)}`);
      try {
        if ((await fetch(web)).ok) break;
      } catch {
        /* Wait for the owned server. */
      }
      await new Promise((done) => setTimeout(done, 500));
    }

    child = fork(resolve(webRoot, 'e2e/support/passwordless-whatsapp-browser.cjs'), [], {
      cwd: webRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const browser = child;
    const childLogs: string[] = [];
    browser.stdout?.on('data', (chunk) => childLogs.push(String(chunk)));
    browser.stderr?.on('data', (chunk) => childLogs.push(String(chunk)));
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => {
        browser.kill('SIGTERM');
        fail(new Error('WhatsApp browser acceptance timed out'));
      }, 480_000);
      let failure: string | undefined;
      browser.on('message', async (message: unknown) => {
        const m = message as {
          id?: number;
          kind: string;
          payload?: Record<string, string | number>;
          error?: string;
          name?: string;
        };
        if (m.kind === 'failure') {
          failure = m.error;
          return;
        }
        if (m.kind === 'progress') {
          progress.push(m.name!);
          return;
        }
        if (!m.id) return;
        try {
          let data: unknown;
          const p = m.payload ?? {};
          if (m.kind === 'code') {
            const phone = String(p.phone);
            if (!Object.values(phones).includes(phone))
              throw new Error('Unknown synthetic recipient');
            const messages = sent.get(phone) ?? [];
            data = { count: messages.length, code: messages.at(-1) ?? null };
          } else if (m.kind === 'expire') {
            const challengeId = String(p.challengeId);
            const result = await db.verificationToken.updateMany({
              where: {
                challengeId,
                userId: { in: Object.values(actors).map((actor) => actor.userId) },
                purpose: 'LOGIN_OTP',
              },
              data: { expiresAt: new Date(Date.now() - 1000) },
            });
            if (result.count !== 1)
              throw new Error('Expiry control must target one owned login challenge');
            data = true;
          } else if (m.kind === 'emailCode') {
            data = h!.otp(`${users.seeker}@example.test`);
          } else if (m.kind === 'policyEvidence') {
            const value = await db.platformSetting.findUniqueOrThrow({
              where: { key: 'auth.otpChannel' },
            });
            const history = await db.platformSettingHistory.count({
              where: { key: 'auth.otpChannel', changedBy: users.reviewer },
            });
            data = { value: value.value, history };
          } else throw new Error('Unknown browser fixture action');
          browser.send({ reply: m.id, data });
        } catch {
          browser.send({ reply: m.id, error: 'Synthetic browser fixture action failed' });
        }
      });
      browser.once('error', (error) => {
        clearTimeout(timer);
        fail(error);
      });
      browser.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0 && !failure) done();
        else fail(new Error(failure ?? childLogs.join('').slice(-4000) ?? 'Browser worker failed'));
      });
      browser.send({
        kind: 'start',
        data: {
          api: h!.url,
          web,
          output,
          actors,
          email: `${users.seeker}@example.test`,
          password: h!.fixture.password,
        },
      });
    });
    expect(progress).toEqual(
      expect.arrayContaining([
        'form-first-policy-failure-and-real-api-recovery',
        'responsive-selected-methods',
        'issued-challenge-survives-policy-refresh',
        'all-role-phone-only-sessions',
        'expiry-and-fresh-code',
        'admin-policy-switch',
        'saved-admin-email-honored-after-config-recovery',
        'credential-draft-survives-policy-refresh',
        'email-method-isolated',
        'accessibility-and-keyboard',
      ]),
    );
  });
});
