# CR-001 — Serialize R25 shared-test and CI integration

Status: **APPLIED — FINAL_CI_PENDING**. Requester: R25. The repository owner requested correction of R25 PR #175 on 2026-10-17; this follow-up applies the five shared-file integration changes under that task. The original lane proposal and its historical observations are retained below.

## PR #175 integration follow-up — 2026-10-17

All five named shared files are now updated. R12 retains every participant/standing assertion while its socket and transport doubles satisfy the original-credential contract. R17 uses an independent real account, booking and browser context per Arabic viewport, and its cookie client sends the existing allowed Origin. The dispute fixture deletes only its own Notification aggregate outbox rows before the associated notifications.

R25 is excluded from ordinary and general real-API browser discovery and runs through the dedicated **R25 real replicas and recovery** job. Both `r18-acceptance` and `ci-gate` require that job. CI checks out the literal PR head with full history, creates fresh loopback service credentials, waits for an authenticated TCP database query and Mailpit readiness, invokes the existing fail-closed verifier, uploads only the current session's fixed-schema summary, and tears down only that session's stack.

Executed local checks for the first correction, before the base integration below: pinned Node 24.21.0/pnpm 10.32.1 frozen offline install with normal lifecycle; Prisma generation and all 70 existing migrations; database build/seed and API/E2E types; affected formatting/lint; R12 **40/40**, ordered R17 dispute **7/7** then R22 **21/21** on the same database without resetting its queue; verifier policy **29/29** and governance **158/158**. Actual Playwright discovery registers **1185** ordinary tests and **1467** general real-API tests with no R25 selection; explicit isolated desktop discovery selects exactly **one** R25 scenario. No assertions, retries or runtime authorization rules were relaxed.

The first published correction `77f7a732b9573561abf37577680f0cded5de2883` exposed an additional base mismatch: the newly merged R26/R27 workflows check out the exact PR head, where their new policy script and browser measurement harness were absent. Runs [39058774205](https://github.com/baraabd/homeservicemarketplace/actions/runs/39058774205) and [39058774194](https://github.com/baraabd/homeservicemarketplace/actions/runs/39058774194) therefore failed before their acceptance bodies ran. The owner-requested integration correction now brings already-merged `develop` commit `21089a5065169b78bea5e711a4839e1a467531dc` into this feature branch through a history-preserving merge. Its R26/R27 source is retained unchanged, including R26 browser isolation and R27 measurement assertions; both R25 gate dependencies and all five fixture/CI repairs remain present. Frozen G1 ancestry is preserved, and no unmerged peer source is imported. The combined candidate requires new evidence on its own final SHA.

The full API suite, clean-commit replica acceptance and final remote CI are tracked separately in the PR body on their actual source identities. Results from the prior published head are historical evidence. This source update does not certify a passing check before it runs, grant G2/hosted acceptance, merge the PR or enable deployed realtime flags.

## Reason and exact paths

R25 tightens the socket's original-credential and transport contract and adds an opt-in real-service browser acceptance suite. Its broad real-service verification also exposed a pre-existing outbox fixture cleanup omission. Five existing shared files require small integration changes:

1. `apps/api/test/integration/r12-booking-communication.integration.spec.ts` — construct a valid authorized socket/transport double; retain every existing participant/standing assertion.
2. `apps/web/e2e/r17-notifications.real-api.spec.ts` — the synthetic cookie-authenticated Node client must send the already configured allowed browser origin; the Arabic viewport case needs an independent real notification and first-visit browser context at each width.
3. `apps/web/playwright.config.ts` — route the new R25 browser spec only into its explicitly isolated suite.
4. `.github/workflows/ci.yml` — run the owned verifier against its own disposable stack, preserve safe evidence and make the job a required CI gate dependency.
5. `apps/api/test/support/dispute-workspace-fixture.ts` — remove the fixture's own Notification aggregate outbox rows before deleting their notifications; preserve the R22 post-commit assertion and unrelated queue entries.

No dependency, lockfile, schema, migration, REST response shape, IAM permission, route registration or deployed environment change is requested. The underlying source is frozen R22/R23 plus R25; no unmerged peer implementation is consumed.

## 1. Existing R12 socket double

The old test bypasses a real handshake and provides only `userId`/`sessionId`. Production cannot accept missing original JTI, expiration, connected state or adapter readiness merely to keep that fake working. In its existing realtime `beforeAll`, add the owned transport symbol import and set the gateway server:

```ts
const { REALTIME_TRANSPORT } = require('../../src/modules/realtime/realtime-socket.adapter');
const server = {
  [REALTIME_TRANSPORT]: {
    isReady: () => true,
    reserve: async () => true,
    release: async () => undefined,
  },
};
gateway.server = server as never;
```

Update only `socketOf` to reflect successful handshake state:

```ts
const socketOf = (userId: string) => {
  const joined: string[] = [];
  const rooms = new Set<string>();
  const socket = {
    id: `r12-${userId}`,
    connected: true,
    rooms,
    joined,
    data: {
      userId,
      sessionId: `${userId}-session`,
      jti: 'jti',
      expiresAt: Date.now() + 60_000,
      leaseValidUntil: Date.now() + 30_000,
      joinedRooms: [] as string[],
      subscriptionBusy: false,
      subscriptionCount: 0,
      subscriptionWindowAt: Date.now(),
    },
    join: async (room: string) => {
      joined.push(room);
      rooms.add(room);
    },
    leave: async (room: string) => {
      rooms.delete(room);
    },
    emit: () => undefined,
    disconnect: () => {
      socket.connected = false;
    },
  };
  return socket;
};
```

The existing fifth `RealtimeGateway` constructor argument is `{}`. Replace that argument with the following role-aware identity double; otherwise the new current-provider-role check cannot call `resolve`:

```ts
{
  resolve: async (userId: string) => ({
    roles: [PROFILES.some(([, id]) => id === userId) ? 'provider' : 'seeker'],
    permissions: [],
    providerProfileId: null,
    providerStatus: null,
    mayViewMarketplace: false,
  }),
} as never,
```

R12 already intentionally replaces its role guard, and its fixtures do not persist role grants. This double preserves that declared boundary. The real participant/provider-capability gate still decides admission and supplies the actual provider room; no production fallback is added for incomplete doubles.

This remains a contract double for R12's participant/capability integration tests, not new evidence of a real network handshake. R25 independently tests the real handshake.

## 2. Existing R17 cookie client origin

In the committed-notification Socket.IO test, preserve the real cookie and all assertions; amend one options line:

```diff
-      extraHeaders: { Cookie: cookie },
+      extraHeaders: { Cookie: cookie, Origin: WEB_B },
```

`WEB_B` is already supplied to `CORS_ORIGINS` for C/D. Cookie authentication with an absent or foreign browser Origin is refused; native clients with an explicit JWT retain their separate supported path. Do not broaden production origins to accommodate the test.

## 2b. Existing R17 Arabic viewport fixture

The first published head's completed Phase 5 run (`39032705025`, job `117397977318`) reported R17-B **two passed / one failed / two did not run**, with zero retries/flaky. The observed failure was the second viewport's missing repeated toast, not Origin: the cookie-only socket case was serially unrun. Artifact `12101631628` contains a passing 360 px Arabic capture with the first aggregate hint and a 390 px failure capture with the same unread notification but no replayed toast after another `page.goto()`.

The unchanged test creates one real notification outside its width loop and asks for the same arrival toast after each full reload. R25 deliberately persists the initial baseline and presentation claim across reloads. Keep both requirements: a visible first-arrival hint at every Arabic viewport, and no repeated presentation of an already-seen notification. Use a fresh real seeker/provider/booking and a fresh browser context per width; retain the category lookup once and close each context in `finally`.

The following proposed diff preserves every original unread-count, Arabic/RTL, keyboard, drawer, toast-visibility, geometry and screenshot assertion. It does not clear presentation storage, change timeouts, weaken assertions or alter production behavior. It creates three account pairs/bookings instead of one (four additional registrations); rate-limit and service configuration are unchanged.

```diff
diff --git a/apps/web/e2e/r17-notifications.real-api.spec.ts b/apps/web/e2e/r17-notifications.real-api.spec.ts
--- a/apps/web/e2e/r17-notifications.real-api.spec.ts
+++ b/apps/web/e2e/r17-notifications.real-api.spec.ts
@@ -340,49 +340,54 @@
     await expect(drawer.getByText(row.body)).toBeVisible();
   });

-  test('Arabic, right-to-left, at 360, 390 and 430, by keyboard', async ({
-    page,
-    context,
-  }, testInfo) => {
+  test('Arabic, right-to-left, at 360, 390 and 430, by keyboard', async ({ browser }, testInfo) => {
     const categoryId = await leafCategoryId();
-    const seeker = await registerSeeker('r17ba');
-    const provider = await workingProvider(categoryId, 'r17ba');
-    await scheduledBooking(seeker, provider, categoryId);
-
-    await applySession(context, seeker.jar);
-    await seedLanguage(page, 'ar');
     for (const width of [360, 390, 430]) {
-      await page.setViewportSize({ width, height: 844 });
-      await page.goto(`${WEB_A}/home`);
-      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
-      await expect(page.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
-        'فتح الإشعارات، 1 غير مقروءة',
-      );
-      await openSeekerBell(page);
-      const drawer = page.getByTestId('notification-drawer');
-      await expect(drawer.getByText('الإشعارات', { exact: true })).toBeInViewport();
-      await expect(drawer.getByRole('button', { name: 'تعليم الكل كمقروء' })).toBeVisible();
-      await expect(drawer.getByRole('button', { name: 'إغلاق' })).toBeVisible();
-      const overflow = await page.evaluate(
-        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
-      );
-      expect(overflow).toBeLessThanOrEqual(0);
-      // The arrival toast (Arabic copy) must sit wholly on screen.
-      const toasts = page.locator('[data-sonner-toast]');
-      await expect(toasts.first()).toBeVisible();
-      for (const box of await toasts.evaluateAll((els) =>
-        els.map((el) => {
-          const r = el.getBoundingClientRect();
-          return { left: r.left, right: r.right };
-        }),
-      )) {
-        expect(box.left, `toast left edge at ${width}px`).toBeGreaterThanOrEqual(0);
-        expect(box.right, `toast right edge at ${width}px`).toBeLessThanOrEqual(width);
+      // Each viewport observes its own new notification on a first visit.
+      // Reloading one account must not replay its already-presented toast.
+      const seeker = await registerSeeker('r17ba');
+      const provider = await workingProvider(categoryId, 'r17ba');
+      await scheduledBooking(seeker, provider, categoryId);
+
+      const context = await browser.newContext();
+      try {
+        const page = await context.newPage();
+        await applySession(context, seeker.jar);
+        await seedLanguage(page, 'ar');
+        await page.setViewportSize({ width, height: 844 });
+        await page.goto(`${WEB_A}/home`);
+        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
+        await expect(page.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
+          'فتح الإشعارات، 1 غير مقروءة',
+        );
+        await openSeekerBell(page);
+        const drawer = page.getByTestId('notification-drawer');
+        await expect(drawer.getByText('الإشعارات', { exact: true })).toBeInViewport();
+        await expect(drawer.getByRole('button', { name: 'تعليم الكل كمقروء' })).toBeVisible();
+        await expect(drawer.getByRole('button', { name: 'إغلاق' })).toBeVisible();
+        const overflow = await page.evaluate(
+          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
+        );
+        expect(overflow).toBeLessThanOrEqual(0);
+        // The arrival toast (Arabic copy) must sit wholly on screen.
+        const toasts = page.locator('[data-sonner-toast]');
+        await expect(toasts.first()).toBeVisible();
+        for (const box of await toasts.evaluateAll((els) =>
+          els.map((el) => {
+            const r = el.getBoundingClientRect();
+            return { left: r.left, right: r.right };
+          }),
+        )) {
+          expect(box.left, `toast left edge at ${width}px`).toBeGreaterThanOrEqual(0);
+          expect(box.right, `toast right edge at ${width}px`).toBeLessThanOrEqual(width);
+        }
+        await testInfo.attach(`r17b-drawer-ar-${width}.png`, {
+          body: await page.screenshot(),
+          contentType: 'image/png',
+        });
+      } finally {
+        await context.close();
       }
-      await testInfo.attach(`r17b-drawer-ar-${width}.png`, {
-        body: await page.screenshot(),
-        contentType: 'image/png',
-      });
     }
   });
```

The private proposal passed `git apply --check --whitespace=error` against unchanged R17 source on `5496a887c88808db193718169137ae4f8ce29159`. Its candidate text was formatted in memory with the repository's configuration and parsed by TypeScript 5.9.3 under pinned Node 24.21.0, with zero syntax diagnostics. Structural comparison confirmed the assertion/action block was preserved apart from indentation. These are applicability/syntax checks only: the shared patch was not applied and the combined R17 suite was not executed by this lane. Apply this supplement together with the Origin line above before the required real-service regression.

## 3. Explicit Playwright routing

Add alongside the existing startup-performance opt-in in `testIgnore`:

```ts
...(process.env.HSM_R25_REALTIME === 'isolated-ci'
  ? []
  : ['**/r25-realtime-recovery.real-api.spec.ts']),
```

The R25 spec fails clearly if invoked without the required isolated setting. It contains no skip/early-return success branch. This entry excludes a service-dependent test from unrelated mock/general runs; the dedicated mandatory job below executes it with the correct flag and requires positive passed counts.

## 4. Dedicated CI job

Apply this as a new job in `ci.yml` and add `r25-realtime` to `ci-gate.needs`. Use the existing pinned actions and runtime policy. The snippet deliberately uses a fresh checkout and no `.env` file; the runner refuses dotenv-loaded local secrets.

```yaml
r25-realtime:
  name: R25 real replicas and recovery
  runs-on: ubuntu-latest
  needs: verify
  timeout-minutes: 25
  steps:
    - uses: actions/checkout@v5
      with:
        ref: ${{ github.event.pull_request.head.sha || github.sha }}
        fetch-depth: 0
    - uses: pnpm/action-setup@v6
    - uses: actions/setup-node@v5
      with:
        node-version: '24.21.0'
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - name: Prepare disposable R25 credentials
      run: |
        node <<'NODE'
        const fs = require('node:fs');
        const { randomBytes } = require('node:crypto');
        const session = `ci_${process.env.GITHUB_RUN_ID}_${process.env.GITHUB_RUN_ATTEMPT}`;
        const password = randomBytes(24).toString('hex');
        const redis = randomBytes(24).toString('hex');
        for (const value of [password, redis]) console.log(`::add-mask::${value}`);
        const values = {
          R25_SESSION: session,
          R25_DATABASE_PASSWORD: password,
          R25_REDIS_PASSWORD: redis,
          REDIS_PASSWORD: redis,
          DATABASE_URL: `postgresql://r25_test:${password}@127.0.0.1:54325/hsm_r25_${session}`,
        };
        fs.appendFileSync(process.env.GITHUB_ENV, Object.entries(values).map(([k,v]) => `${k}=${v}\n`).join(''));
        NODE
    - name: Start only the disposable R25 stack
      run: docker compose -f infra/production/realtime/compose.test.yml up -d --wait
    - run: pnpm --filter @homeservicemarketplace/database generate
    - name: Install the pinned browser
      run: pnpm --filter @homeservicemarketplace/web exec playwright install --with-deps chromium
    - name: Verify isolation policy
      run: node --test scripts/production/realtime/verify-replicas.test.cjs
    - name: Verify the committed source against two API processes
      run: node scripts/production/realtime/verify-replicas.cjs --run
    - name: Preserve fixed-schema evidence
      if: always()
      uses: actions/upload-artifact@v6
      with:
        name: r25-realtime-summary
        path: apps/web/test-results/r25-*/**/summary.json
        if-no-files-found: error
        retention-days: 14
    - name: Stop only the R25 stack
      if: always()
      run: docker compose -f infra/production/realtime/compose.test.yml down
```

Keep raw logs, JSON browser responses, sessions, traces and videos private. After review, retain only the suite's named synthetic UI PNGs alongside the matching summary; do not upload the whole `private` directory. Docker image/SBOM/container scanning and existing CI/CodeQL gates remain required.

## 5. Existing dispute fixture outbox cleanup

The corrected broad API run reported R22 20/21: its pre-commit `runOnce()` expected zero claimed events but counted three older `notification.created` events. The private log and a read-only database lookup identify three already-committed Notification aggregate rows whose notification records were gone. Their creation times, 08:05:48.157, 08:05:48.298 and 08:05:48.429 UTC on 2026-10-17, precede the R25 integration suite's 08:05:50.291 UTC start within that second full API-suite attempt. The R22 worker correctly counted unrelated eligible queue rows; this does not demonstrate visibility of the uncommitted R22 intent.

The existing `clear()` deletes its notifications while omitting their Notification aggregate outbox entries. The three rows' timestamps align with the end of the R17 legacy dispute suite, strongly suggesting that fixture as their producer; deleted notification records prevent directly recovering their original fixture-user ownership. The fixture, R22 test/harness, outbox worker/repository and notification service all have empty diffs from the frozen base.

Apply this namespace-limited cleanup proposal; it passed `git apply --check --whitespace=error` without modifying the shared file:

```diff
--- a/apps/api/test/support/dispute-workspace-fixture.ts
+++ b/apps/api/test/support/dispute-workspace-fixture.ts
@@ -148,7 +148,20 @@
           select: { id: true },
         })
       ).map((row) => row.id);
-      await db.outboxEvent.deleteMany({ where: { aggregateId: { in: [...ids, ...draftIds] } } });
+      const notificationIds = (
+        await db.notification.findMany({
+          where: { userId: { in: Object.values(users) } },
+          select: { id: true },
+        })
+      ).map((row) => row.id);
+      await db.outboxEvent.deleteMany({
+        where: {
+          OR: [
+            { aggregateId: { in: [...ids, ...draftIds] } },
+            { aggregateType: 'Notification', aggregateId: { in: notificationIds } },
+          ],
+        },
+      });
       await db.auditEvent.deleteMany({ where: { userId: { in: Object.values(users) } } });
       await db.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
       await db.disputeNotificationPreference.deleteMany({
```

The unchanged R22 isolated rerun passed 21/21, including the post-commit case in 39 ms. That separate result does not repair or erase the broad-run failure: the earlier worker had already marked the unrelated rows DEAD. Preserve the broad and isolated results independently.

After applying the cleanup, run the following sequentially against the same otherwise idle disposable migrated/seeded database, with authenticated `REDIS_URL`, private `DATABASE_URL`, `RUN_DB_INTEGRATION=1`, `RUN_REDIS_INTEGRATION=1`, and `HSM_SOURCE_SHA`/`SOURCE_SHA` unset. Do not reset the queue between commands:

```sh
pnpm --filter @homeservicemarketplace/api exec jest test/integration/r17-dispute-legacy-http.integration.spec.ts --runInBand
pnpm --filter @homeservicemarketplace/api exec jest test/integration/r22-outbox-reliability.integration.spec.ts --runInBand
```

## Validation after the coordinator applies the patches

- Run affected formatting, lint, application and E2E type checks with normal hooks.
- Run the complete API tests with real PostgreSQL/Redis enabled, including unchanged R12 participant/standing assertions and the new R25 suite.
- Run the ordered R17-then-R22 cleanup regression above without a queue reset, then rerun the complete integration suite.
- Run the existing R17 real notification suite with explicit allowed Origin and independent first-visit Arabic fixtures at 360, 390 and 430 px; require all original unread, keyboard, RTL, toast-visibility and geometry assertions. Preserve the R25 same-account reload/once-only presentation assertions.
- Verify default Playwright discovery excludes R25 and explicit `HSM_R25_REALTIME=isolated-ci` discovery includes exactly its real spec.
- Execute `verify-replicas.cjs --run` on the exact combined source; require positive API/browser counts, no skips/retries, same compiled API identity across A/B and a clean final source check.
- Review the declared load and auth failure evidence, synthetic EN/AR/RTL screenshots and keyboard/viewport assertions.
- Require final combined-candidate CI, CodeQL, dependency and exact-tree/history secret scans. The coordinator alone updates central wave/registry acceptance after those checks; source-only success is not G2 acceptance.

The lane's Draft PR must not be called merge-ready while these shared changes or their final evidence are outstanding. The original request was review material; the later owner request identified in the follow-up above authorizes this scoped correction.
