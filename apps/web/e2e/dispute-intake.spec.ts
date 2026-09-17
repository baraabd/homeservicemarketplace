import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DISPUTE_ISSUE_CODES, DISPUTE_REQUESTED_OUTCOMES } from '@homeservicemarketplace/contracts';
import { seedLanguage, signedInAdmin, stubApi, expectNoHorizontalPageOverflow } from './fixtures';
import { DISPUTE_COPY } from '../src/app/features/disputes/copy';

// Real application routes, deterministic HTTP fixtures. NOT proof of database persistence.
const id = `di_${'a'.repeat(40)}`;
const context = { booking: { id: 'booking-1', status: 'SCHEDULED', serviceLabelEn: 'Home cleaning', serviceLabelAr: 'تنظيف المنزل' }, role: 'SEEKER', canOpen: true, blocker: null, existingCaseId: null, policyVersion: 'pilot-v1:hash', openingDeadline: null, issueCodes: DISPUTE_ISSUE_CODES, requestedOutcomes: DISPUTE_REQUESTED_OUTCOMES };
const detail = { id, reference: id, bookingId: 'booking-1', state: 'SUBMITTED', role: 'SEEKER', openedByYou: true, submittedAt: '2026-09-17T10:00:00Z', updatedAt: '2026-09-17T10:00:00Z', issueCode: 'SERVICE_QUALITY', requestedOutcome: 'REPERFORM', statement: 'The agreed work needs another inspection.', policyVersion: 'pilot-v1:hash', events: [{ id: 'event-1', kind: 'SUBMITTED', occurredAt: '2026-09-17T10:00:00Z' }], eventsTruncated: false, nextAction: 'WAIT_FOR_REVIEW', capabilities: { uploadEvidence: false, respond: false, appeal: false } };
async function prepare(page: Page, lang: 'en' | 'ar', failFirst = false) {
  await seedLanguage(page, lang); await stubApi(page, { me: signedInAdmin() });
  const commands: Array<{ idempotencyKey: string; statement: string }> = [];
  let denied = false;
  await page.route('**/v1/me/disputes**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (denied) return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } });
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON());
      if (failFirst && commands.length === 1) return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } });
      return route.fulfill({ json: { dispute: detail, created: true, replayed: false } });
    }
    if (path.endsWith('/context/booking-1')) return route.fulfill({ json: context });
    if (path.endsWith('/bookings')) return route.fulfill({ json: { items: [{ ...context.booking, role: 'SEEKER', scheduledAt: '2026-09-18T12:00:00Z', createdAt: detail.submittedAt }], nextCursor: null } });
    if (path.endsWith(`/${id}`)) return route.fulfill({ json: detail });
    return route.fulfill({ json: { items: commands.length ? [detail] : [], nextCursor: null } });
  });
  return { commands, deny: () => { denied = true; } };
}
async function fill(page: Page, lang: 'en' | 'ar') {
  const t = DISPUTE_COPY[lang];
  await page.getByRole('radio', { name: t.issues.SERVICE_QUALITY, exact: true }).check();
  await page.getByRole('button', { name: t.next, exact: true }).click();
  await page.getByTestId('case-statement').fill(detail.statement);
  await page.getByRole('radio', { name: t.outcomes.REPERFORM, exact: true }).check();
  await page.getByRole('button', { name: t.next, exact: true }).click();
}
for (const lang of ['en', 'ar'] as const) {
  test(`intake and timeline render on the real routes in ${lang}`, async ({ page }, info) => {
    await prepare(page, lang); const t = DISPUTE_COPY[lang];
    await page.goto('/disputes'); await page.getByRole('link', { name: t.newCase, exact: true }).click();
    await page.getByRole('link', { name: t.choose, exact: true }).click();
    await expect(page).toHaveURL(/\/disputes\/new\?bookingId=booking-1$/);
    await expect(page.getByRole('radio', { name: t.issues.SERVICE_QUALITY, exact: true })).toBeVisible();
    const widths = info.project.name.endsWith('desktop') ? [1024, 1440] : info.project.name.endsWith('tablet') ? [768] : [320, 390, 430];
    for (const theme of ['light', 'dark'] as const) {
      if (theme === 'dark') await page.getByRole('button', { name: t.theme, exact: true }).click();
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        await expectNoHorizontalPageOverflow(page);
        const a11y = await new AxeBuilder({ page }).include('[data-testid="disputes-surface"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(a11y.violations).toEqual([]);
        await page.evaluate(() => document.fonts.ready);
        const name = `dispute-intake-${lang}-${theme}-${width}`; const path = info.outputPath(`${name}.png`);
        await page.screenshot({ path, fullPage: true, animations: 'disabled' });
        await info.attach(name, { path, contentType: 'image/png' });
      }
    }
    await fill(page, lang);
    await expect(page.getByText(t.unsaved, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: t.submit, exact: true }).click();
    await expect(page).toHaveURL(`/disputes/${id}`);
    await expect(page.getByRole('heading', { name: t.timeline, exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByText(detail.statement, { exact: true })).toBeVisible();
    const path = info.outputPath(`dispute-timeline-${lang}.png`); await page.screenshot({ path, fullPage: true });
    await info.attach(`dispute-timeline-${lang}`, { path, contentType: 'image/png' });
  });
}
test('failed submission retries the same intent without claiming success', async ({ page }) => {
  const state = await prepare(page, 'en', true); const t = DISPUTE_COPY.en;
  await page.goto('/disputes/new?bookingId=booking-1'); await fill(page, 'en');
  await page.getByRole('button', { name: t.submit, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(t.submissionFailed);
  await expect(page).toHaveURL(/\/disputes\/new\?/);
  await page.getByRole('button', { name: t.submit, exact: true }).click();
  await expect(page).toHaveURL(`/disputes/${id}`);
  expect(state.commands).toHaveLength(2); expect(state.commands[0]).toEqual(state.commands[1]);
  state.deny(); await page.getByRole('button', { name: t.refresh, exact: true }).click();
  await expect(page.getByText(detail.statement, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText(t.denied);
});
test('language changes retain the description and leaving requires a real modal decision', async ({ page }) => {
  await prepare(page, 'en'); const en = DISPUTE_COPY.en; const ar = DISPUTE_COPY.ar;
  await page.goto('/disputes/new?bookingId=booking-1');
  await page.getByRole('radio', { name: en.issues.OTHER, exact: true }).check();
  await page.getByRole('button', { name: en.next, exact: true }).click();
  await page.getByTestId('case-statement').fill(detail.statement);
  await page.getByRole('button', { name: 'Switch to Arabic', exact: true }).click();
  await expect(page.getByTestId('case-statement')).toHaveValue(detail.statement);
  await page.getByRole('link', { name: ar.back, exact: true }).click();
  await expect(page.getByRole('dialog', { name: ar.leaveTitle, exact: true })).toBeVisible();
  await page.getByRole('button', { name: ar.stay, exact: true }).click();
  await expect(page.getByTestId('case-statement')).toHaveValue(detail.statement);
  await page.getByRole('link', { name: ar.back, exact: true }).click();
  await page.getByRole('button', { name: ar.leave, exact: true }).click();
  await expect(page).toHaveURL('/disputes');
});

test('a concurrently opened case does not silently consume a new statement', async ({ page }) => {
  await prepare(page, 'en'); const t = DISPUTE_COPY.en;
  await page.route('**/v1/me/disputes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({ json: { dispute: detail, created: false, replayed: false } });
  });
  await page.goto('/disputes/new?bookingId=booking-1'); await fill(page, 'en');
  await page.getByRole('button', { name: t.submit, exact: true }).click();
  await expect(page.getByText(t.blocked.ALREADY_OPEN, { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/disputes\/new\?/);
  await expect(page.getByText(detail.statement, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: t.open, exact: true }).click();
  await expect(page.getByRole('dialog', { name: t.leaveTitle, exact: true })).toBeVisible();
  await page.getByRole('button', { name: t.stay, exact: true }).click();
  await expect(page).toHaveURL(/\/disputes\/new\?/);
});
