import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Client } from 'pg';
import type {
  FinancialOperationsSummaryV1,
  FinancialRecordsPageV1,
  FinancialRecordDetailV1,
  FinancialReconciliationPageV1,
} from '@homeservicemarketplace/contracts';
import { loginViaUi, REAL_API, registerProvider, type Account } from '../real-api';
import { withDb } from '../booking-fixtures';
import { expectNoHorizontalPageOverflow, seedLanguage } from '../fixtures';

// The browser reads the real mounted routes, real cookie session, current
// database permissions and migrated PostgreSQL. No response interception or
// money transport is used. Synthetic source rows are fixture setup only; this
// suite makes no claim to certify a collection, refund or reconciliation run.
test.use({ trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 10_000 });
test.describe.configure({ mode: 'default' });
const LARGE = '9007199254740993';
const PRIVATE = 'r33-private-synthetic-marker';
const DIGEST = 'a'.repeat(64);
const widths = [320, 390, 430, 768, 1024, 1440];
const id = () => 'r33-' + randomUUID();

interface Actor extends Account {
  userId: string;
  roleId: string;
}
interface Payment {
  id: string;
  planId: string;
  confirmationId: string;
  subscriptionId: string;
}
let admin: Actor;
let owner: Actor;
let revocable: Actor;
let own: Payment;
let foreign: Payment;
let unpaidSubscriptionId: string;
let exceptionId: string;

async function actor(kind: 'admin' | 'provider'): Promise<Actor> {
  const account = await registerProvider();
  return withDb(async (db) => {
    const users = await db.query<{ id: string }>('SELECT id FROM "User" WHERE email=$1', [
      account.email,
    ]);
    const userId = users.rows[0].id;
    const roleId = id();
    await db.query('INSERT INTO "Role" (id,name,"updatedAt") VALUES ($1,$1,NOW())', [roleId]);
    const granted = await db.query(
      'INSERT INTO "RolePermission" ("roleId","permissionId") SELECT $1,id FROM "Permission" WHERE key=$2',
      [roleId, kind === 'admin' ? 'money:review:read' : 'money:read:self'],
    );
    expect(granted.rowCount, 'the migrated money capability must exist').toBe(1);
    await db.query('INSERT INTO "UserRole" ("userId","roleId") VALUES ($1,$2)', [userId, roleId]);
    if (kind === 'admin') {
      const base = await db.query(
        'INSERT INTO "UserRole" ("userId","roleId") SELECT $1,id FROM "Role" WHERE name=\'admin\' ON CONFLICT DO NOTHING',
        [userId],
      );
      expect(base.rowCount, 'the disposable account needs the existing admin base role').toBe(1);
    }
    return { ...account, userId, roleId };
  });
}

async function intent(
  db: Client,
  account: Actor,
  currency: string,
  amount: string,
  createdAt = new Date(),
) {
  const planId = id();
  const paymentId = id();
  await db.query(
    'INSERT INTO "SubscriptionPlanVersion" (id,"planKey",version,"billingInterval","priceMinor",currency,entitlements,"publishedAt") VALUES ($1,$1,1,\'MONTHLY\',$2,$3,\'[]\',NOW())',
    [planId, amount, currency],
  );
  await db.query(
    'INSERT INTO "MoneyPaymentIntent" (id,"providerProfileId","planVersionId",method,currency,"subtotalMinor","discountMinor","totalMinor","idempotencyKey","requestDigest","expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,\'STRIPE\',$4,$5,0,$5,$6,$7,NOW()+INTERVAL \'1 day\',$8,NOW())',
    [paymentId, account.profileId, planId, currency, amount, id(), DIGEST, createdAt],
  );
  return { id: paymentId, planId };
}

async function collection(account: Actor, currency: string, amount: string): Promise<Payment> {
  return withDb(async (db) => {
    await db.query('BEGIN');
    try {
      const payment = await intent(db, account, currency, amount);
      const debit = id();
      const credit = id();
      for (const accountId of [debit, credit]) {
        await db.query(
          'INSERT INTO "LedgerAccount" (id,key,"ownerType",currency) VALUES ($1,$1,\'PLATFORM\',$2)',
          [accountId, currency],
        );
      }
      const posting = id();
      await db.query(
        'INSERT INTO "LedgerTransaction" (id,kind,currency,description,"idempotencyKey","requestDigest","actorSystem") VALUES ($1,\'STANDARD\',$2,$3,$4,$5,\'r33-browser-fixture\')',
        [posting, currency, PRIVATE, id(), DIGEST],
      );
      for (const [line, accountId, side] of [
        [1, debit, 'DEBIT'],
        [2, credit, 'CREDIT'],
      ]) {
        await db.query(
          'INSERT INTO "LedgerEntry" (id,"transactionId","lineNo","accountId",side,"amountMinor",currency) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [id(), posting, line, accountId, side, amount, currency],
        );
      }
      // Posting invokes the actual balance/immutability trigger. Confirmation
      // and the period invoke the existing money relation/state guards.
      await db.query(
        'UPDATE "LedgerTransaction" SET status=\'POSTED\',"postedAt"=NOW() WHERE id=$1',
        [posting],
      );
      await db.query('UPDATE "MoneyPaymentIntent" SET status=\'PROCESSING\' WHERE id=$1', [
        payment.id,
      ]);
      await db.query('UPDATE "MoneyPaymentIntent" SET status=\'SUCCEEDED\' WHERE id=$1', [
        payment.id,
      ]);
      const confirmationId = id();
      await db.query(
        'INSERT INTO "MoneyPaymentConfirmation" (id,"paymentIntentId",source,"externalConfirmationId","amountMinor",currency,"confirmedAt","idempotencyKey","requestDigest","ledgerTransactionId") VALUES ($1,$2,\'PROVIDER_WEBHOOK\',$3,$4,$5,NOW(),$6,$7,$8)',
        [confirmationId, payment.id, PRIVATE + id(), amount, currency, id(), DIGEST, posting],
      );
      const subscriptionId = id();
      await db.query(
        'INSERT INTO "ProviderSubscription" (id,"providerProfileId","planVersionId","updatedAt") VALUES ($1,$2,$3,NOW())',
        [subscriptionId, account.profileId, payment.planId],
      );
      await db.query(
        'INSERT INTO "SubscriptionPeriod" (id,"subscriptionId","paymentConfirmationId","startsAt","endsAt") VALUES ($1,$2,$3,\'2026-10-01T00:00:00Z\',\'2026-11-01T00:00:00Z\')',
        [id(), subscriptionId, confirmationId],
      );
      await db.query('UPDATE "ProviderSubscription" SET status=\'ACTIVE\' WHERE id=$1', [
        subscriptionId,
      ]);
      await db.query('COMMIT');
      return { ...payment, confirmationId, subscriptionId };
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
}

test.beforeAll(async () => {
  if (!REAL_API || !process.env.DATABASE_URL)
    throw new Error('R33 requires the disposable real API and database');
  admin = await actor('admin');
  owner = await actor('provider');
  revocable = await actor('admin');
  own = await collection(owner, 'XTS', LARGE);
  foreign = await collection(admin, 'XXX', '700');
  await withDb(async (db) => {
    // Enough independently priced intents to exercise the actual keyset.
    for (let index = 0; index < 21; index += 1) {
      await intent(db, owner, 'XTS', String(index + 1), new Date('2026-01-01T00:00:00Z'));
    }
    unpaidSubscriptionId = id();
    await db.query(
      'INSERT INTO "ProviderSubscription" (id,"providerProfileId","planVersionId","updatedAt") VALUES ($1,$2,$3,NOW())',
      [unpaidSubscriptionId, owner.profileId, own.planId],
    );
    exceptionId = id();
    await db.query(
      'INSERT INTO "MoneyReconciliationException" (id,kind,"subjectType","subjectId") VALUES ($1,\'AMOUNT_MISMATCH\',\'PaymentConfirmation\',$2)',
      [exceptionId, own.confirmationId],
    );
  });
});

async function signIn(page: Page, account: Actor, path: string) {
  await seedLanguage(page, 'en');
  await page.goto(path);
  await expect(page).toHaveURL(/\/login(?:\?|$)/u);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await loginViaUi(page, account);
  await expect(page).toHaveURL(new RegExp(path + '$'));
  await expect(page.getByTestId('financial-operations')).toBeVisible();
}

async function wire<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(REAL_API + path);
  expect(response.status(), 'authoritative financial read status').toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const value = (await response.json()) as T;
  expect(JSON.stringify(value)).not.toContain(PRIVATE);
  expect(JSON.stringify(value)).not.toContain(DIGEST);
  return value;
}

async function saveWire(info: TestInfo, name: string, value: unknown) {
  // Real response fields only: the read-only verifier can inspect these local
  // files. No HTTP headers, cookies, tokens, email or request body is saved.
  await writeFile(info.outputPath(name + '.wire.json'), JSON.stringify(value, null, 2));
}

async function visualMatrix(
  page: Page,
  info: TestInfo,
  surface: string,
  detailId: string,
  amountText: { en: string; ar: string },
) {
  const evidence: Array<{
    lang: string;
    width: number;
    theme: string;
    zoom: number;
    view?: 'detail';
    axeViolations?: number;
  }> = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  for (const lang of ['en', 'ar'] as const) {
    if (lang === 'ar') await page.getByRole('button', { name: 'Switch to Arabic' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalPageOverflow(page);
      if (surface === 'provider') {
        const records = page.getByTestId(
          width < 768 ? 'financial-records-cards' : 'financial-records-table',
        );
        await expect(records).toContainText(lang === 'en' ? 'Awaiting payment' : 'بانتظار الدفع');
        await expect(records).not.toContainText('PENDING_PAYMENT');
      }
      const targets = await page
        .locator('main button:visible, main select:visible')
        .evaluateAll((elements) =>
          elements.map((element) => ({
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
          })),
        );
      expect(
        targets.every((target) => target.width >= 43 && target.height >= 43),
        '44px financial controls',
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(surface + '-' + lang + '-' + width + '.png'),
        fullPage: true,
        animations: 'disabled',
      });
      evidence.push({ lang, width, theme: 'light', zoom: 100 });
      if (width === 320) {
        const detailButton = page.getByTestId('financial-records-cards').getByRole('button', {
          name: (lang === 'en' ? 'View details: ' : 'عرض التفاصيل: ') + detailId,
          exact: true,
        });
        await detailButton.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(amountText[lang], { exact: true })).toBeVisible();
        const bounds = await dialog.boundingBox();
        expect(bounds, 'mobile detail has visible bounds').not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
        await expectNoHorizontalPageOverflow(page);
        await page.screenshot({
          path: info.outputPath(surface + '-' + lang + '-mobile-detail-320.png'),
          fullPage: false,
          animations: 'disabled',
        });
        evidence.push({ lang, width, theme: 'light', zoom: 100, view: 'detail' });
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(detailButton).toBeFocused();
      }
    }
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      axe.violations.map((violation) => violation.id),
      lang + ' accessibility violations',
    ).toEqual([]);
    evidence[evidence.length - 1].axeViolations = axe.violations.length;
  }
  await page.getByRole('button', { name: 'التغيير إلى الإنجليزية' }).click();
  await page.getByRole('button', { name: 'Change color theme' }).click();
  await expect(page.getByTestId('financial-operations').locator('..')).toHaveClass(/dark/u);
  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({
    path: info.outputPath(surface + '-en-dark-1440.png'),
    fullPage: true,
    animations: 'disabled',
  });
  evidence.push({ lang: 'en', width: 1440, theme: 'dark', zoom: 100 });
  await page.getByRole('button', { name: 'Change color theme' }).click();
  // Real CSS layout zoom changes text/control sizes and available layout
  // space; this is not an image resize or a deviceScaleFactor screenshot.
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expectNoHorizontalPageOverflow(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({
    path: info.outputPath(surface + '-en-200-percent-1440.png'),
    fullPage: true,
    animations: 'disabled',
  });
  evidence.push({ lang: 'en', width: 1440, theme: 'light', zoom: 200 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await writeFile(
    info.outputPath(surface + '-visual-summary.json'),
    JSON.stringify({ surface, screenshots: evidence.length, evidence }, null, 2),
  );
}

test('admin real reports retain exact currency values, bounded export and accessible bilingual layouts', async ({
  page,
}, info) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));
  await signIn(page, admin, '/admin/financial-operations');
  const summary = await wire<FinancialOperationsSummaryV1>(page, '/v1/money/operations/summary');
  expect(summary.ledger.source).toBe('LEDGER');
  expect(summary.ledger.totals.map((total) => total.currency)).toEqual(
    expect.arrayContaining(['XTS', 'XXX']),
  );
  for (const total of summary.ledger.totals) {
    await expect(page.getByTestId('ledger-total-' + total.currency)).toContainText(
      new Intl.NumberFormat('en').format(BigInt(total.captured.amountMinor)) + ' ' + total.currency,
    );
  }
  expect(summary.reconciliation.state).toBe('UNAVAILABLE');
  expect(summary.reconciliation.lastSuccessAt).toBeNull();
  expect(
    Object.values(summary.capabilities).every((item) => !item.available && item.href === null),
  ).toBe(true);
  await saveWire(info, 'admin-summary', summary);

  const initial = await wire<FinancialRecordsPageV1>(
    page,
    '/v1/money/operations/records?limit=20&kind=PAYMENT',
  );
  expect(initial.items).toHaveLength(20);
  expect(initial.nextCursor).toBeTruthy();
  const table = page.getByTestId('financial-records-table');
  await expect(table).toContainText('9,007,199,254,740,993 XTS');
  const detailButton = table.getByRole('button', { name: 'View details: ' + own.id, exact: true });
  await detailButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Confirmed with ledger posting');
  await expect(dialog).toContainText('9,007,199,254,740,993 XTS');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(detailButton).toBeFocused();
  const detail = await wire<FinancialRecordDetailV1>(
    page,
    '/v1/money/operations/records/PAYMENT/' + own.id,
  );
  expect(detail.record.amount?.amountMinor).toBe(LARGE);
  expect(detail.record.confirmationState).toBe('CONFIRMED');
  await saveWire(info, 'admin-detail', detail);

  const nextRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/v1/money/operations/records' &&
      new URL(response.url()).searchParams.has('cursor'),
  );
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  const next = (await (await nextRead).json()) as FinancialRecordsPageV1;
  expect(next.items.length).toBeGreaterThan(0);
  expect(next.items.every((item) => !initial.items.some((prior) => prior.id === item.id))).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(table).toContainText(own.id);

  await page.getByRole('button', { name: 'Export this page', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('financial-operations.csv');
  await expect(
    page.getByText(
      'This download contains one bounded page. More records remain; use the next page to export them.',
    ),
  ).toBeVisible();
  const csv = await page.request.get(
    REAL_API + '/v1/money/operations/export?kind=PAYMENT&currency=XTS&limit=1',
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()['x-export-has-more']).toBe('true');
  expect(csv.headers()['x-export-row-count']).toBe('1');
  expect(await csv.text()).not.toContain(PRIVATE);

  const reconciliation = await wire<FinancialReconciliationPageV1>(
    page,
    '/v1/money/operations/reconciliation',
  );
  expect(reconciliation.status.state).toBe('UNAVAILABLE');
  expect(reconciliation.items.some((item) => item.id === exceptionId)).toBe(true);
  await page.getByRole('button').filter({ hasText: exceptionId }).click();
  await expect(page.getByRole('dialog')).toContainText('Amount mismatch');
  await expect(page.getByRole('dialog').getByRole('button')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await saveWire(info, 'admin-records', initial);
  await saveWire(info, 'admin-reconciliation', reconciliation);
  await page.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('XXX');
  await expect(table).toContainText('700 XXX');
  await visualMatrix(page, info, 'admin', foreign.id, {
    en: '700 XXX · minor units',
    ar: '٧٠٠ XXX · وحدة صغرى',
  });
  expect(pageErrors).toEqual([]);
});

test('provider real history isolates ownership and distinguishes paid from unpaid subscriptions', async ({
  page,
}, info) => {
  const financePaths: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/v1/money/'))
      financePaths.push(new URL(request.url()).pathname);
  });
  await signIn(page, owner, '/provider/financial-history');
  const ownPage = await wire<FinancialRecordsPageV1>(
    page,
    '/v1/money/history/records?kind=PAYMENT&limit=50',
  );
  expect(ownPage.items.length).toBeGreaterThan(20);
  expect(ownPage.items.every((item) => item.providerProfileId === owner.profileId)).toBe(true);
  expect(ownPage.items.some((item) => item.id === foreign.id)).toBe(false);
  const foreignRead = await page.request.get(
    REAL_API + '/v1/money/history/records/PAYMENT/' + foreign.id,
  );
  const missingRead = await page.request.get(
    REAL_API + '/v1/money/history/records/PAYMENT/' + id(),
  );
  expect(foreignRead.status()).toBe(404);
  expect(missingRead.status()).toBe(404);
  const foreignBody = await foreignRead.json();
  const missingBody = await missingRead.json();
  for (const refused of [foreignBody, missingBody]) {
    expect(refused).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Financial resource not found.' },
    });
  }
  expect((await page.request.get(REAL_API + '/v1/money/operations/summary')).status()).toBe(403);
  await expect(page.getByRole('button', { name: 'Export this page' })).toHaveCount(0);
  await expect(page.getByText('My Plan is not configured on this surface.')).toBeVisible();
  await expect(page.getByText('Financial records could not be loaded.')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Record type', exact: true })
    .selectOption('SUBSCRIPTION');
  const table = page.getByTestId('financial-records-table');
  await expect(table).toContainText(own.subscriptionId);
  await expect(table).toContainText(unpaidSubscriptionId);
  await expect(table).toContainText('Amount unavailable');
  const paid = await wire<FinancialRecordDetailV1>(
    page,
    '/v1/money/history/records/SUBSCRIPTION/' + own.subscriptionId,
  );
  const unpaid = await wire<FinancialRecordDetailV1>(
    page,
    '/v1/money/history/records/SUBSCRIPTION/' + unpaidSubscriptionId,
  );
  expect(paid.record.amount?.amountMinor).toBe(LARGE);
  expect(paid.record.amountMeaning).toBe('CONFIRMED_SUBSCRIPTION_PERIOD');
  expect(unpaid.record.amount).toBeNull();
  expect(unpaid.record.amountMeaning).toBe('UNAVAILABLE');
  await saveWire(info, 'provider-records', ownPage);
  await saveWire(info, 'provider-paid-subscription', paid);
  await saveWire(info, 'provider-unpaid-subscription', unpaid);
  await page.getByRole('combobox', { name: 'Record type', exact: true }).selectOption('REFUND');
  await expect(page.getByText('No records match this view.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Record type', exact: true }).selectOption('SETTLEMENT');
  await expect(
    page.getByText('Settlement reporting is unavailable. No settlement feed has been integrated.'),
  ).toBeVisible();
  await expect(page.getByText('No records match this view.')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Record type', exact: true })
    .selectOption('SUBSCRIPTION');
  await expect(table).toContainText(unpaidSubscriptionId);
  await visualMatrix(page, info, 'provider', own.subscriptionId, {
    en: '9,007,199,254,740,993 XTS · minor units',
    ar: '٩٬٠٠٧٬١٩٩٬٢٥٤٬٧٤٠٬٩٩٣ XTS · وحدة صغرى',
  });
  expect(financePaths).not.toContain('/v1/money/history/summary');
  const scope = await withDb(
    async (db) =>
      (
        await db.query<{ status: string; verified: boolean }>(
          'SELECT status,verified FROM "ProviderProfile" WHERE id=$1',
          [owner.profileId],
        )
      ).rows[0],
  );
  expect(scope).toEqual({ status: 'DRAFT', verified: false });
});

test('revoking current permission hides cached values and a fresh OTP login remains denied', async ({
  page,
  browser,
}, info) => {
  await signIn(page, revocable, '/admin/financial-operations');
  await expect(page.getByTestId('ledger-total-XTS')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Refresh financial records', exact: true }),
  ).toBeEnabled();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Refresh financial records', exact: true }).click();
  await expect(
    page.getByText(
      'The network is unavailable. Displayed values may be out of date. Reads resume when you reconnect.',
    ),
  ).toBeVisible();
  await expect(page.getByTestId('ledger-total-XTS')).toBeVisible();
  await page.context().setOffline(false);
  await expect(
    page.getByText(
      'The network is unavailable. Displayed values may be out of date. Reads resume when you reconnect.',
    ),
  ).toHaveCount(0);
  // Reconnection resumes all paused reads. Wait for their completion before
  // changing the grant so this case exercises a distinct manual revalidation.
  await expect(
    page.getByRole('button', { name: 'Refresh financial records', exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId('ledger-total-XTS')).toBeVisible();
  await withDb(async (db) => {
    const result = await db.query('DELETE FROM "RolePermission" WHERE "roleId"=$1', [
      revocable.roleId,
    ]);
    expect(result.rowCount).toBe(1);
  });
  await page.getByRole('button', { name: 'Refresh financial records', exact: true }).click();
  await expect(
    page.getByText('You do not have permission to read these financial records.'),
  ).toBeVisible();
  await expect(page.getByTestId('ledger-total-XTS')).toHaveCount(0);
  await expect(page.getByTestId('financial-records-table')).toHaveCount(0);
  expect(
    (await page.request.get(REAL_API + '/v1/money/operations/export?kind=PAYMENT')).status(),
  ).toBe(403);
  await page.reload();
  await expect(
    page.getByText('You do not have permission to read these financial records.'),
  ).toBeVisible();
  const freshContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  try {
    const fresh = await freshContext.newPage();
    await signIn(fresh, revocable, '/admin/financial-operations');
    await expect(
      fresh.getByText('You do not have permission to read these financial records.'),
    ).toBeVisible();
    await expect(fresh.getByTestId('ledger-total-XTS')).toHaveCount(0);
  } finally {
    await freshContext.close();
  }
  await writeFile(
    info.outputPath('authorization-summary.json'),
    JSON.stringify({
      pausedOfflineReadMarkedStale: true,
      transportRecovery: true,
      liveRevocation: true,
      cachedValuesHidden: true,
      reloadDenied: true,
      freshOtpLoginDenied: true,
      deniedExportStatus: 403,
    }),
  );
});
