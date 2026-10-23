import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import type {
  ManualPaymentDetailV1,
  ManualReviewDetailV1,
} from '@homeservicemarketplace/contracts';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
type Actor = 'owner' | 'reviewer' | 'recorder' | 'outsider';
interface BrowserFixture {
  apiUrl: string;
  actors: Record<Actor, StorageState>;
  cases: { primary: { paymentIntentId: string }; disabled: { paymentIntentId: string } };
}

/**
 * The private manifest comes from r30ManualHttpFixture and real login + OTP.
 * No route interception, forged tokens, seeded scan verdicts or browser API doubles.
 * Actual manual collection, PostgreSQL, Redis and ClamAV are exercised. R31/R32
 * remain explicitly labelled contract components; this is sandbox UI evidence.
 */
function fixture(): BrowserFixture {
  const path = process.env.R30_BROWSER_FIXTURE;
  if (!path) throw new Error('R30 browser evidence requires the isolated real HTTP fixture.');
  const value = JSON.parse(readFileSync(path, 'utf8')) as BrowserFixture;
  const url = new URL(value.apiUrl);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') {
    throw new Error('R30 browser evidence is restricted to the disposable local API.');
  }
  for (const name of ['owner', 'reviewer', 'recorder', 'outsider'] as const) {
    if (
      !value.actors[name]?.cookies.some((cookie) => cookie.name === 'hsm_at' && cookie.httpOnly)
    ) {
      throw new Error(`R30 ${name} must have a genuine authenticated cookie session.`);
    }
  }
  if (!value.cases.primary.paymentIntentId || !value.cases.disabled.paymentIntentId) {
    throw new Error('R30 browser evidence requires enabled and disabled obligations.');
  }
  return value;
}

async function actorContext(
  browser: Browser,
  config: BrowserFixture,
  actor: Actor,
  testInfo: TestInfo,
) {
  return browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    storageState: config.actors[actor],
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
}

async function readDetail<T extends ManualPaymentDetailV1>(context: BrowserContext, url: string) {
  const response = await context.request.get(url);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  return (await response.json()) as T;
}

function postResponse(page: Page, url: string) {
  return page.waitForResponse(
    (response) => response.url() === url && response.request().method() === 'POST',
  );
}

async function language(page: Page, next: 'en' | 'ar', area: 'provider' | 'review') {
  if ((await page.locator('html').getAttribute('lang')) !== next) {
    if (area === 'provider') {
      await page
        .locator('.manual-payments')
        .getByRole('button', { name: next === 'ar' ? 'العربية' : 'English', exact: true })
        .click();
    } else {
      await page.getByRole('button', { name: 'Switch language', exact: true }).click();
    }
  }
  await expect(page.locator('html')).toHaveAttribute('lang', next);
  await expect(page.locator('.manual-payments')).toHaveAttribute(
    'dir',
    next === 'ar' ? 'rtl' : 'ltr',
  );
}

async function noOverflow(page: Page) {
  const bounds = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    surface: document.querySelector('.manual-payments')!.getBoundingClientRect().toJSON() as {
      left: number;
      right: number;
    },
  }));
  expect(bounds.document).toBeLessThanOrEqual(bounds.viewport + 1);
  expect(bounds.surface.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.surface.right).toBeLessThanOrEqual(bounds.viewport + 1);
}

async function responsiveEvidence(page: Page, area: 'provider' | 'review', testInfo: TestInfo) {
  const evidence: Array<{ area: string; language: string; width: number; violations: number }> = [];
  for (const lang of ['en', 'ar'] as const) {
    await language(page, lang, area);
    for (const width of [320, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      await noOverflow(page);
      const result = await new AxeBuilder({ page })
        .include('.manual-payments')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map((item) => ({
          id: item.id,
          impact: item.impact,
          targets: item.nodes.map((node) => node.target),
        })),
      ).toEqual([]);
      evidence.push({ area, language: lang, width, violations: result.violations.length });
      await page.screenshot({
        path: testInfo.outputPath(`${area}-${lang}-${width}.png`),
        fullPage: true,
      });
    }
    // Explicit CSS content enlargement exercises reflow at 200%; it is not
    // reported as an operating-system or browser-toolbar zoom interaction.
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    try {
      await noOverflow(page);
      if (area === 'review') {
        // The review form must reflow to a readable full-width column when
        // content is enlarged, even while the viewport remains desktop-sized.
        const columns = await page.locator('.mp-grid--review').evaluate((grid) =>
          Array.from(grid.children).map((column) => {
            const bounds = column.getBoundingClientRect();
            return { top: bounds.top, bottom: bounds.bottom };
          }),
        );
        expect(columns).toHaveLength(2);
        expect(columns[1].top).toBeGreaterThanOrEqual(columns[0].bottom);
      }
      await page.screenshot({
        path: testInfo.outputPath(`${area}-${lang}-200pct-content.png`),
        fullPage: true,
      });
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('zoom');
      });
    }
  }
  await language(page, 'en', area);
  await testInfo.attach(`${area}-responsive-accessibility`, {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json',
  });
}

function syntheticPng() {
  const png = new PNG({ width: 320, height: 160 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      const stripe = y > 40 && y < 120 && x > 30 && x < 290;
      png.data[offset] = stripe ? 24 : 240;
      png.data[offset + 1] = stripe ? 90 : 246;
      png.data[offset + 2] = stripe ? 120 : 250;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function syntheticPdf() {
  const stream =
    '0.1 0.35 0.5 rg 20 20 280 90 re f\n0 0 0 rg BT /F1 12 Tf 20 140 Td (SYNTHETIC R30 RECEIPT) Tj 0 -18 Td (NOT A REAL TRANSFER) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let value = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(value));
    value += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}`;
  value += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}

async function uploadThroughUi(page: Page, config: BrowserFixture, revision: number) {
  await page.getByLabel('Receipt file', { exact: true }).setInputFiles({
    name: revision === 1 ? 'synthetic-r30.png' : 'synthetic-r30-replacement.pdf',
    mimeType: revision === 1 ? 'image/png' : 'application/pdf',
    buffer: revision === 1 ? syntheticPng() : syntheticPdf(),
  });
  const finalized = page.waitForResponse(
    (response) =>
      response.url().startsWith(config.apiUrl + '/v1/money/manual/receipts/') &&
      response.url().endsWith('/finalize') &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', {
      name: revision === 1 ? 'Upload a receipt' : 'Upload a replacement receipt',
      exact: true,
    })
    .click();
  expect((await finalized).status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: `Receipt version ${revision} · Current`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for review', exact: true })).toBeEnabled();
  await expect(
    page.getByText('Security scan: Security scan passed', { exact: true }).first(),
  ).toBeVisible();
  const submitted = postResponse(
    page,
    config.apiUrl + `/v1/money/manual/intents/${config.cases.primary.paymentIntentId}/submit`,
  );
  await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
  expect((await submitted).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Under review', exact: true })).toBeVisible();
  await expect(
    page.getByText('Submitted for review. Payment has not yet been confirmed.', { exact: true }),
  ).toBeVisible();
}

async function inspectThroughUi(page: Page, config: BrowserFixture, revision: number) {
  const content = page.waitForResponse(
    (response) =>
      response.url().startsWith(config.apiUrl + '/v1/money/manual/receipts/') &&
      response.url().endsWith('/content') &&
      response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: `Inspect receipt ${revision}`, exact: true }).click();
  const response = await content;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-receipt-inspection-id']).toBeTruthy();
  if (revision === 1) {
    const image = page.getByRole('img', { name: 'Uploaded payment receipt', exact: true });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(320);
    expect(await image.getAttribute('src')).toMatch(/^blob:/);
  } else {
    const canvas = page.locator('.mp-preview canvas');
    await expect(canvas).toBeVisible();
    await expect
      .poll(() =>
        canvas.evaluate((node) => {
          const canvas = node as HTMLCanvasElement;
          const rgba = canvas
            .getContext('2d')!
            .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
          return rgba[2] > rgba[0] && rgba[3] === 255;
        }),
      )
      .toBe(true);
  }
  // This button is rendered only after the private response header is
  // browser-readable through CORS and the actual image/PDF has rendered.
  await page.getByRole('button', { name: 'Use this inspected receipt', exact: true }).click();
  await expect(page.getByText('Current receipt inspected', { exact: true })).toBeVisible();
  return response.headers()['x-receipt-inspection-id'];
}

test('real sandbox receipt replacement, private previews and independent review work across AR/EN layouts', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const config = fixture();
  const contexts = await Promise.all(
    (['owner', 'reviewer', 'recorder', 'outsider'] as const).map((actor) =>
      actorContext(browser, config, actor, testInfo),
    ),
  );
  const [ownerContext, reviewerContext, recorderContext, outsiderContext] = contexts;
  const [owner, reviewer, recorder, outsider] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  const pageErrors: string[] = [];
  for (const page of [owner, reviewer, recorder, outsider])
    page.on('pageerror', (error) => pageErrors.push(error.message));
  const id = config.cases.primary.paymentIntentId;
  const providerPath = `/provider/manual-payments/${id}`;
  const reviewPath = `/admin/manual-payments/${id}`;
  const providerUrl = config.apiUrl + `/v1/money/manual/intents/${id}`;
  const reviewUrl = config.apiUrl + `/v1/money/manual/review/intents/${id}`;
  try {
    await test.step('Provider opens an actual enabled sandbox obligation and all responsive layouts', async () => {
      await owner.goto(providerPath);
      await expect(
        owner.getByRole('heading', { level: 1, name: 'Manual subscription payment', exact: true }),
      ).toBeVisible();
      const initial = await readDetail<ManualPaymentDetailV1>(ownerContext, providerUrl);
      expect(initial).toMatchObject({
        mode: 'SANDBOX',
        availability: 'ENABLED',
        minorUnitScale: 0,
        amount: { amountMinor: '1000', currency: 'XTS' },
      });
      expect(initial.receipts).toHaveLength(0);
      await expect(owner.getByText('1,000 XTS', { exact: true })).toBeVisible();
      await expect(
        owner.getByText('Uploading a receipt does not confirm payment or activate your plan.', {
          exact: true,
        }),
      ).toBeVisible();
      const back = owner.getByRole('link', { name: 'Back to provider', exact: true });
      await back.focus();
      await owner.keyboard.press('Tab');
      await expect(owner.getByRole('button', { name: 'العربية', exact: true })).toBeFocused();
      await owner
        .getByLabel('Receipt file', { exact: true })
        .setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: syntheticPng() });
      await responsiveEvidence(owner, 'provider', testInfo);
      expect(
        await owner
          .getByLabel('Receipt file', { exact: true })
          .evaluate((node) => (node as HTMLInputElement).files?.[0]?.name),
      ).toBe('draft.png');
    });

    await test.step('Real PNG upload is scanned and submitted without confirming payment', async () => {
      let reservations = 0;
      owner.on('request', (request) => {
        if (request.method() === 'POST' && request.url() === providerUrl + '/receipts')
          reservations += 1;
      });
      await owner.getByLabel('Receipt file', { exact: true }).setInputFiles({
        name: 'unsafe.html',
        mimeType: 'text/html',
        buffer: Buffer.from('<html>unsupported receipt</html>'),
      });
      await owner.getByRole('button', { name: 'Upload a receipt', exact: true }).click();
      await expect(owner.getByRole('alert').first()).toContainText(
        'Choose a supported, nonempty file',
      );
      expect(reservations).toBe(0);
      await uploadThroughUi(owner, config, 1);
      expect(reservations).toBe(1);
      const submitted = await readDetail<ManualPaymentDetailV1>(ownerContext, providerUrl);
      expect(submitted.status).toBe('IN_REVIEW');
      expect(submitted.receipts).toHaveLength(1);
      expect(submitted.receipts[0].scanStatus).toBe('CLEAN');
      expect(submitted.receipts[0].submittedAt).not.toBeNull();
      await outsider.goto(providerPath);
      await expect(outsider.getByRole('alert')).toContainText('This payment is unavailable.');
      const assetId = submitted.receipts[0].mediaAssetId;
      const denial = await outsiderContext.request.get(
        config.apiUrl + `/v1/money/manual/receipts/${assetId}/content`,
      );
      const absent = await outsiderContext.request.get(
        config.apiUrl + `/v1/money/manual/receipts/${randomUUID()}/content`,
      );
      expect(denial.status()).toBe(404);
      expect(absent.status()).toBe(404);
      expect(await denial.json()).toMatchObject({
        error: { code: (await absent.json()).error.code },
      });
    });

    const correction = 'Please replace the cropped receipt with the complete deposit reference.';
    const internal = 'Synthetic internal finance note; never disclose to the provider.';
    await test.step('Reviewer must inspect actual private bytes; correction and internal text stay separate', async () => {
      await reviewer.goto('/admin/manual-payments');
      await expect(
        reviewer.getByRole('heading', { level: 1, name: 'Manual payment reviews', exact: true }),
      ).toBeVisible();
      await reviewer.locator(`a[href="${reviewPath}"]`).click();
      await expect(
        reviewer.getByRole('heading', {
          level: 1,
          name: 'Review subscription payment',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        reviewer.getByRole('button', { name: 'Confirm matched deposit', exact: true }),
      ).toBeDisabled();
      await reviewer.getByLabel('Message to the provider', { exact: true }).fill(correction);
      await reviewer
        .getByLabel('Internal reviewer note (optional)', { exact: true })
        .fill(internal);
      await expect(
        reviewer.getByRole('button', { name: 'Request a replacement', exact: true }),
      ).toBeDisabled();
      await inspectThroughUi(reviewer, config, 1);
      await responsiveEvidence(reviewer, 'review', testInfo);
      await expect(reviewer.getByLabel('Message to the provider', { exact: true })).toHaveValue(
        correction,
      );
      await expect(
        reviewer.getByLabel('Internal reviewer note (optional)', { exact: true }),
      ).toHaveValue(internal);
      const decision = postResponse(reviewer, reviewUrl + '/decisions');
      await reviewer.getByRole('button', { name: 'Request a replacement', exact: true }).click();
      const response = await decision;
      expect(response.status()).toBe(202);
      expect(response.request().headers()['idempotency-key']).toBeTruthy();
      await expect(
        reviewer.getByRole('heading', { name: 'Replacement required', exact: true }),
      ).toBeVisible();
      await owner.reload();
      await expect(
        owner.getByRole('heading', { name: 'Replacement required', exact: true }),
      ).toBeVisible();
      await expect(owner.getByText(correction, { exact: true }).first()).toBeVisible();
      await expect(owner.getByText(internal, { exact: true })).toHaveCount(0);
      const publicDetail = await readDetail<ManualPaymentDetailV1>(ownerContext, providerUrl);
      expect(JSON.stringify(publicDetail)).not.toContain(internal);
      expect(publicDetail).not.toHaveProperty('reviewHistory');
      expect(publicDetail).not.toHaveProperty('settlements');
      await owner.screenshot({
        path: testInfo.outputPath('provider-correction.png'),
        fullPage: true,
      });
    });

    await test.step('Replacement creates a new immutable PDF revision and survives a fresh route read', async () => {
      await uploadThroughUi(owner, config, 2);
      await owner.reload();
      await expect(
        owner.getByRole('heading', { name: 'Receipt version 1', exact: true }),
      ).toBeVisible();
      await expect(
        owner.getByRole('heading', { name: 'Receipt version 2 · Current', exact: true }),
      ).toBeVisible();
      const replacement = await readDetail<ManualPaymentDetailV1>(ownerContext, providerUrl);
      expect(replacement.receipts.map((receipt) => receipt.revision)).toEqual([2, 1]);
      expect(replacement.receipts[0].contentType).toBe('application/pdf');
      expect(new Set(replacement.receipts.map((receipt) => receipt.mediaAssetId)).size).toBe(2);
    });

    const depositReference = `R30-SIMULATION-${randomUUID()}`.toUpperCase();
    await test.step('A separate authenticated recorder enters independent simulated evidence', async () => {
      await recorder.goto(reviewPath);
      await expect(
        recorder.getByRole('heading', { name: 'Independent deposit record', exact: true }),
      ).toBeVisible();
      await recorder.getByLabel('Deposit reference', { exact: true }).fill(depositReference);
      await recorder
        .getByLabel('Amount recorded by the payment source (XTS)', { exact: true })
        .fill('1000');
      await recorder
        .getByLabel('Deposit time (UTC)', { exact: true })
        // datetime-local normalizes zero seconds away; use its canonical minute form.
        .fill(new Date().toISOString().slice(0, 16));
      const settlement = postResponse(recorder, reviewUrl + '/settlements');
      await recorder.getByRole('button', { name: 'Record simulated deposit', exact: true }).click();
      expect((await settlement).status()).toBe(201);
      await expect(
        recorder.getByRole('heading', { name: depositReference, exact: true }),
      ).toBeVisible();
      const ownRecord = await readDetail<ManualReviewDetailV1>(recorderContext, reviewUrl);
      expect(ownRecord.status).toBe('IN_REVIEW');
      expect(
        ownRecord.settlements.find((item) => item.reference === depositReference)?.canApprove,
      ).toBe(false);
      await expect(
        recorder.getByRole('option', { name: new RegExp(depositReference) }),
      ).toHaveCount(0);
      await recorder.screenshot({
        path: testInfo.outputPath('independent-recorder.png'),
        fullPage: true,
      });
    });

    await test.step('The distinct reviewer inspects the current PDF and confirms through the keyboard dialog', async () => {
      await reviewer.reload();
      const approvedBy = await readDetail<ManualReviewDetailV1>(reviewerContext, reviewUrl);
      const matching = approvedBy.settlements.find((item) => item.reference === depositReference)!;
      expect(matching.canApprove).toBe(true);
      await reviewer.getByLabel('Deposit to match', { exact: true }).selectOption(matching.id);
      await reviewer
        .getByLabel('Message to the provider', { exact: true })
        .fill('The simulated deposit matches the current receipt and exact amount.');
      await expect(
        reviewer.getByRole('button', { name: 'Confirm matched deposit', exact: true }),
      ).toBeDisabled();
      const inspectionId = await inspectThroughUi(reviewer, config, 2);
      await reviewer.screenshot({
        path: testInfo.outputPath('review-current-pdf.png'),
        fullPage: true,
      });
      const approve = reviewer.getByRole('button', {
        name: 'Confirm matched deposit',
        exact: true,
      });
      await approve.focus();
      await reviewer.keyboard.press('Enter');
      const dialog = reviewer.getByRole('alertdialog', {
        name: 'Confirm the matched deposit?',
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await reviewer.keyboard.press('Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      await reviewer.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(approve).toBeFocused();
      await reviewer.keyboard.press('Enter');
      const confirmed = postResponse(reviewer, reviewUrl + '/decisions');
      await dialog.getByRole('button', { name: 'Confirm decision', exact: true }).focus();
      await reviewer.keyboard.press('Enter');
      const response = await confirmed;
      expect(response.status()).toBe(202);
      expect(response.request().postDataJSON()).toMatchObject({
        action: 'APPROVE',
        settlementId: matching.id,
        receiptVersionId: approvedBy.currentReceiptVersionId,
        expectedVersion: approvedBy.version,
        inspectionId,
      });
      await expect(
        reviewer.getByRole('heading', { level: 2, name: 'Payment confirmed', exact: true }),
      ).toBeVisible();
      await owner.reload();
      await expect(
        owner.getByRole('heading', { level: 2, name: 'Payment confirmed', exact: true }),
      ).toBeVisible();
      const final = await readDetail<ManualPaymentDetailV1>(ownerContext, providerUrl);
      expect(final.status).toBe('APPROVED');
      expect(final.receipts).toHaveLength(2);
      expect(final.history.some((entry) => entry.action === 'APPROVED')).toBe(true);
      expect(final.availableActions).not.toContain('UPLOAD_RECEIPT');
    });

    await test.step('Ending the browser session removes private receipt bytes and fails the next read', async () => {
      await owner.getByRole('button', { name: 'Inspect receipt 1', exact: true }).click();
      const image = owner.getByRole('img', { name: 'Uploaded payment receipt', exact: true });
      await expect(image).toBeVisible();
      const blobUrl = await image.getAttribute('src');
      expect(blobUrl).toMatch(/^blob:/);
      await ownerContext.clearCookies();
      await owner.getByRole('button', { name: 'Refresh status', exact: true }).click();
      await expect(image).toHaveCount(0);
      const readable = await owner.evaluate(async (url) => {
        try {
          return (await fetch(url!)).ok;
        } catch {
          return false;
        }
      }, blobUrl);
      expect(readable).toBe(false);
      expect((await ownerContext.request.get(providerUrl)).status()).toBe(401);
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('real disabled and unknown obligations show honest states without payment instructions', async ({
  browser,
}, testInfo) => {
  const config = fixture();
  const context = await actorContext(browser, config, 'owner', testInfo);
  const page = await context.newPage();
  try {
    await page.goto(`/provider/manual-payments/${config.cases.disabled.paymentIntentId}`);
    await expect(
      page.getByText('This payment method is currently unavailable.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Payment instructions', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Receipt file', { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 960 });
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('method-disabled-en-320.png'),
      fullPage: true,
    });
    await language(page, 'ar', 'provider');
    await expect(
      page.getByText('طريقة الدفع هذه غير متاحة حاليًا.', { exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('method-disabled-ar-320.png'),
      fullPage: true,
    });
    await language(page, 'en', 'provider');
    await page.goto(`/provider/manual-payments/${randomUUID()}`);
    await expect(page.getByRole('alert')).toContainText('This payment is unavailable.');
    await expect(page.getByLabel('Receipt file', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('This payment is unavailable.');
  } finally {
    await context.close();
  }
});
