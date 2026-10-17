import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  api,
  approveCategoriesFor,
  loginViaUi,
  registerProvider,
  REAL_API,
  type Account,
} from './real-api';
import { enterAdmin, openSubmittedProvider, submittedProvider } from './admin-review-real-api';
import { openReviewTask } from './admin-review-tabs';
import { submitVerificationCase, waitForEvidenceClean } from './phase3-activation';

async function browserRead(page: Page, path: string) {
  return page.evaluate(
    async ({ origin, path }) => {
      const response = await fetch(origin + path, { credentials: 'include' });
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      return { status: response.status, code: body?.error?.code, message: body?.error?.message };
    },
    { origin: REAL_API, path },
  );
}

test('built document enforces scripts and connections while real API boundaries stay safe', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Log In', exact: true })).toBeVisible();
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("script-src 'self'");
  expect(policy).not.toContain("'unsafe-eval'");
  const violations = await page.evaluate(async () => {
    const events: Array<{ directive: string; blocked: string }> = [];
    const handler = (event: SecurityPolicyViolationEvent) =>
      events.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    document.addEventListener('securitypolicyviolation', handler);
    const inline = document.createElement('script');
    inline.textContent = 'document.documentElement.dataset.r26Injected = "yes"';
    document.head.append(inline);
    const remote = document.createElement('script');
    remote.src = 'https://r26-unapproved.invalid/script.js';
    document.head.append(remote);
    await fetch('https://r26-unapproved.invalid/private').catch(() => undefined);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    document.removeEventListener('securitypolicyviolation', handler);
    inline.remove();
    remote.remove();
    return { events, injected: document.documentElement.dataset.r26Injected ?? null };
  });
  expect(violations.injected).toBeNull();
  expect(violations.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ directive: 'script-src-elem', blocked: 'inline' }),
      expect.objectContaining({
        directive: 'script-src-elem',
        blocked: expect.stringMatching(/^https:\/\/r26-unapproved\.invalid(?:\/|$)/),
      }),
      expect.objectContaining({ directive: 'connect-src' }),
    ]),
  );
  // Actual compiled bootstrap parser, not the component HTTP harness.
  const malformed = await request.post(`${REAL_API}/v1/auth/login`, {
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'private-'.repeat(100) },
    data: '{"password":"r26-request-secret",',
  });
  expect(malformed.status()).toBe(400);
  expect(await malformed.text()).not.toMatch(/r26-request-secret|private-private|SyntaxError/);
  const oversized = await request.post(`${REAL_API}/v1/auth/login`, {
    data: { value: 'x'.repeat(1024 * 1024) },
  });
  expect(oversized.status()).toBe(413);
  for (const origin of [
    'null',
    'https://r26-unapproved.invalid',
    'http://127.0.0.1:5326.attacker.invalid',
  ]) {
    const response = await request.get(`${REAL_API}/health/live`, { headers: { Origin: origin } });
    expect(response.headers()['access-control-allow-origin']).toBeUndefined();
  }
  const allowed = await request.get(`${REAL_API}/health/live`, {
    headers: { Origin: 'http://127.0.0.1:5326' },
  });
  expect(allowed.headers()['access-control-allow-origin']).toBe('http://127.0.0.1:5326');
  expect(allowed.headers()['access-control-allow-credentials']).toBe('true');
  expect(process.env.METRICS_TOKEN).toBeTruthy();
  expect((await request.get(`${REAL_API}/metrics`)).status()).toBe(404);
  expect(
    (
      await request.get(`${REAL_API}/metrics`, {
        headers: { Authorization: 'Bearer invalid-r26-metrics-token' },
      })
    ).status(),
  ).toBe(404);
  const metrics = await request.get(`${REAL_API}/metrics`, {
    headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` },
  });
  expect(metrics.status()).toBe(200);
  expect(metrics.headers()['cache-control']).toBe('no-store');
});

// A self-contained one-page PDF with an actual painted rectangle. No identities,
// remote assets, scripting, embedded forms or third-party copyrighted material.
function syntheticPdf(): Buffer {
  const stream = '0 0 1 rg 10 10 180 180 re f\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let value = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(value));
    value += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}`;
  value += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}

async function uploadPdf(account: Account) {
  const bytes = syntheticPdf();
  expect(
    (await api(account.jar, '/v1/me/provider/verification/case', { method: 'POST', body: {} }))
      .status,
  ).toBe(200);
  const prepared = await api<{ assetId?: string; asset?: { id: string } }>(
    account.jar,
    '/v1/me/provider/verification/evidence/prepare',
    {
      method: 'POST',
      body: {
        kind: 'INDIVIDUAL_IDENTITY',
        declaredMimeType: 'application/pdf',
        sizeBytes: bytes.length,
        filename: 'synthetic-r26.pdf',
      },
    },
  );
  expect(prepared.status).toBe(200);
  const id = prepared.body.assetId ?? prepared.body.asset?.id;
  expect(id).toBeTruthy();
  const uploaded = await fetch(`${REAL_API}/v1/me/provider/verification/evidence/${id}/content`, {
    method: 'PUT',
    headers: {
      Cookie: [...account.jar].map(([key, value]) => `${key}=${value}`).join('; '),
      'Content-Type': 'application/pdf',
      'X-CSRF-Token': account.jar.get('hsm_csrf')!,
    },
    body: new Uint8Array(bytes),
  });
  expect(uploaded.status).toBe(200);
  const finalized = await api<{ documentId: string }>(
    account.jar,
    `/v1/me/provider/verification/evidence/${id}/finalize`,
    { method: 'POST', body: {} },
  );
  expect(finalized.status).toBe(200);
  return finalized.body.documentId;
}

test('real cookies protect uploaded PDF and gallery while the built Admin previews both', async ({
  page,
  browser,
}, testInfo) => {
  const owner = await submittedProvider({ portfolio: true });
  await approveCategoriesFor(owner);
  const documentId = await uploadPdf(owner);
  await waitForEvidenceClean(owner);
  await submitVerificationCase(owner);
  const outsider = await registerProvider();
  await enterAdmin(page);
  const review = await openSubmittedProvider(page, owner);
  await openReviewTask(page, 'BASICS_IDENTITY');
  const mediaResponse = page.waitForResponse(
    `${REAL_API}/v1/verification/documents/${documentId}/content`,
  );
  await page.getByTestId(`review-evidence-${documentId}`).click();
  const response = await mediaResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const canvas = page.getByTestId('identity-evidence-pdf');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const c = element as HTMLCanvasElement;
        if (!c.width || !c.height) return false;
        const pixel = c
          .getContext('2d')!
          .getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
        return pixel[2] > 200 && pixel[0] < 30 && pixel[1] < 30;
      }),
    )
    .toBe(true);
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('synthetic-pdf.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await openReviewTask(page, 'PORTFOLIO');
  const portfolioId = review.current.portfolio[0].id;
  await page.getByTestId(`review-portfolio-open-${portfolioId}`).click();
  const image = page.getByRole('dialog').getByRole('img');
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(await image.getAttribute('src')).toMatch(/^blob:/);
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('synthetic-gallery.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const otherPage = await context.newPage();
    await otherPage.goto('/login');
    await loginViaUi(otherPage, outsider);
    await expect(otherPage).not.toHaveURL(/\/login(?:\?|$)/);
    const cookies = await context.cookies(REAL_API);
    expect(cookies.find((cookie) => cookie.name === 'hsm_at')?.httpOnly).toBe(true);
    expect(cookies.find((cookie) => cookie.name === 'hsm_csrf')?.httpOnly).toBe(false);
    const denied = await browserRead(otherPage, `/v1/verification/documents/${documentId}/content`);
    const missing = await browserRead(
      otherPage,
      `/v1/verification/documents/${randomUUID()}/content`,
    );
    expect(denied.status).toBe(404);
    expect(denied).toEqual(missing);
    expect(
      (
        await browserRead(
          otherPage,
          `/v1/admin/providers/${owner.profileId}/portfolio/${portfolioId}/media`,
        )
      ).status,
    ).toBe(403);
    expect((await browserRead(otherPage, '/v1/admin/financials/summary')).status).toBe(403);
    const csrf = await otherPage.evaluate(async (origin) => {
      const response = await fetch(`${origin}/v1/me/support/tickets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: 'Untrusted mutation',
          message: 'Must not persist',
          idempotencyKey: 'r26-missing-csrf-token',
        }),
      });
      return response.status;
    }, REAL_API);
    expect(csrf).toBe(403);
  } finally {
    await context.close();
  }
});
