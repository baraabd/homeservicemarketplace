import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { r30ManualHttpFixture } from '../support/r30-manual-http.fixture';

const enabled = process.env.RUN_R30_BROWSER === '1';

// Dedicated required CI job sets the gate and checks every Jest/Playwright
// case executed. No network response, receipt transport or scanner is mocked.
(enabled ? describe : describe.skip)(
  'R30 real browser, HTTP and private receipt acceptance',
  () => {
    jest.setTimeout(900_000);

    it('runs every bilingual browser case and verifies the durable financial outcome', async () => {
      const fixture = await r30ManualHttpFixture();
      const directory = await mkdtemp(join(tmpdir(), 'hsm-r30-browser-'));
      await chmod(directory, 0o700);
      try {
        const manifestPath = join(directory, 'private-fixture.json');
        await writeFile(
          manifestPath,
          JSON.stringify({
            apiUrl: fixture.h.url,
            actors: Object.fromEntries(
              Object.entries(fixture.sessions).map(([actor, session]) => [
                actor,
                session.storageState(),
              ]),
            ),
            cases: {
              primary: { paymentIntentId: fixture.primaryIntent.id },
              disabled: { paymentIntentId: fixture.disabledIntent.id },
            },
          }),
          { mode: 0o600 },
        );
        const webRoot = resolve(__dirname, '../../../web');
        const childEnv: NodeJS.ProcessEnv = { ...process.env, R30_BROWSER_FIXTURE: manifestPath };
        // This is a separate Playwright CLI process. Its runner must not inherit
        // Jest's worker marker and misidentify the independent browser suite.
        delete childEnv.JEST_WORKER_ID;
        // Invoke the pinned local CLI directly; no remote npx install or shell.
        const exit = await new Promise<number | null>((resolveExit, reject) => {
          const child = spawn(
            process.execPath,
            [
              join(webRoot, 'node_modules/@playwright/test/cli.js'),
              'test',
              '--config',
              'playwright.r30.config.ts',
            ],
            {
              cwd: webRoot,
              env: childEnv,
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          const output: string[] = [];
          child.stdout.on('data', (value: Buffer) => output.push(value.toString()));
          child.stderr.on('data', (value: Buffer) => output.push(value.toString()));
          const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('R30 browser exceeded its bounded acceptance timeout.'));
          }, 780_000);
          child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.on('exit', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
              // Playwright reports authored synthetic assertions only. Cookies
              // remain in the private manifest and traces are disabled.
              reject(new Error('R30 browser failed:\n' + output.join('').slice(-12_000)));
            } else resolveExit(code);
          });
        });
        expect(exit).toBe(0);
        const results = JSON.parse(
          await readFile(join(webRoot, 'test-results/r30-manual-results.json'), 'utf8'),
        ) as {
          stats: { expected: number; unexpected: number; skipped: number; flaky: number };
        };
        expect(results.stats).toMatchObject({ expected: 2, unexpected: 0, skipped: 0, flaky: 0 });
        const confirmed = await fixture.h.prisma.moneyPaymentConfirmation.findUnique({
          where: { paymentIntentId: fixture.primaryIntent.id },
        });
        expect(confirmed).not.toBeNull();
        expect(
          await fixture.h.prisma.moneyManualSettlementClaim.count({
            where: { paymentIntentId: fixture.primaryIntent.id },
          }),
        ).toBe(1);
        expect(
          await fixture.h.prisma.moneyManualReceiptVersion.count({
            where: { paymentIntentId: fixture.primaryIntent.id },
          }),
        ).toBe(2);
        expect(
          await fixture.h.prisma.moneyManualReviewDecision.count({
            where: { paymentIntentId: fixture.primaryIntent.id, action: 'APPROVED' },
          }),
        ).toBe(1);
      } finally {
        await fixture.h.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    });
  },
);
