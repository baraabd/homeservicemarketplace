/* Child of the real-AppModule test. Credentials/OTP cross a private IPC pipe only.
 * No routes are intercepted and no authenticated HTTP responses are mocked. */
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
let seq = 0;
const pending = new Map();
const rpc = (kind, payload = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`IPC ${kind} timed out`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    process.send({ id, kind, payload });
  });
process.on('message', async (msg) => {
  if (msg.reply) {
    const p = pending.get(msg.reply);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(msg.reply);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.data);
    }
    return;
  }
  if (msg.kind === 'start') {
    try {
      await run(msg.data);
      process.send({ kind: 'complete' });
      process.exit(0);
    } catch (error) {
      process.send({ kind: 'failure', error: String(error.stack || error) });
      process.exit(1);
    }
  }
});
async function run(data) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox'],
  });
  const pages = {};
  const results = [];
  let caseId;
  const check = (name) => {
    results.push(name);
    process.send({ kind: 'progress', name });
  };
  const out = data.output;
  await mkdir(out, { recursive: true });
  try {
    for (const role of ['seeker', 'provider', 'reviewer', 'independent']) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      pages[role] = page;
      await page.goto(`${data.web}/login`);
      await page.locator('input[type=email]').fill(data.credentials[role].email);
      await page.locator('input[type=password]').fill(data.credentials[role].password);
      const response = page.waitForResponse(
        (r) => r.url() === `${data.api}/v1/auth/login` && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Log In', exact: true }).click();
      expect((await response).status()).toBe(200);
      await page
        .getByTestId('otp-input')
        .fill(await rpc('otp', { email: data.credentials[role].email }));
      const otp = page.waitForResponse((r) => r.url() === `${data.api}/v1/auth/verify-otp`);
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      expect((await otp).status()).toBe(200);
      await expect(page.getByTestId('otp-input')).toHaveCount(0);
    }
    check('four real password/OTP sessions');
    const c = pages.seeker,
      p = pages.provider,
      a = pages.reviewer,
      i = pages.independent;
    await c.goto(`${data.web}/disputes/new?bookingId=${encodeURIComponent(data.bookingId)}`);
    await c.locator('input[name=issue][value=SERVICE_QUALITY]').check();
    await c.getByRole('button', { name: 'Continue', exact: true }).click();
    const privateText =
      'The agreed service was incomplete. This private original statement must persist safely.';
    await c.getByTestId('case-statement').fill(privateText);
    await c.locator('input[name=outcome][value=REPERFORM]').check();
    await expect(c.getByTestId('case-draft-status')).toHaveText('Saved to the server');
    await c.reload();
    await expect(c.getByTestId('case-statement')).toHaveValue(privateText);
    check('server draft reload persistence');
    await c.getByRole('button', { name: 'Continue', exact: true }).click();
    await c.getByRole('button', { name: 'Submit for review', exact: true }).click();
    const workspace = c.getByTestId('dispute-workspace');
    await expect(workspace).toBeVisible();
    caseId = decodeURIComponent(new URL(c.url()).pathname.split('/').pop());
    await rpc('caseCreated', { caseId, privateText });
    check('booking intake and encrypted original submission');
    for (const role of ['provider', 'reviewer', 'independent'])
      await pages[role].goto(
        `${data.web}/${role === 'provider' ? 'disputes' : 'admin/disputes'}/${encodeURIComponent(caseId)}`,
      );
    await expect(p.getByTestId('dispute-workspace')).toBeVisible();
    await expect(p.getByText(privateText, { exact: true })).toHaveCount(0);
    await expect(a.getByText(privateText, { exact: true })).toBeVisible();
    async function refresh(page) {
      const b = page
        .getByTestId('dispute-workspace')
        .getByRole('button', { name: 'Refresh case', exact: true });
      await expect(b).toBeEnabled();
      await b.click();
      await expect(b).toBeEnabled();
    }
    async function command(page, label, fill) {
      await page.getByRole('button', { name: label, exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      if (fill) await fill(dialog);
      await dialog.locator('input[type=checkbox]').last().check();
      await dialog.getByTestId('workspace-command-confirm').click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole('status').filter({ hasText: 'The server confirmed this action.' }),
      ).toBeVisible();
    }
    await command(a, 'Assign reviewer', async (d) =>
      d.getByRole('combobox').selectOption(data.credentials.reviewer.id),
    );
    await command(a, 'Request information', async (d) => {
      await d.getByRole('combobox').selectOption('PROVIDER');
      await d
        .getByRole('textbox')
        .fill('Please explain which agreed service tasks were completed and when.');
    });
    await refresh(p);
    await command(p, 'Reply to this request', async (d) =>
      d
        .getByRole('textbox')
        .fill(
          'The first task was completed, but I agree that the second task needs another visit.',
        ),
    );
    await refresh(a);
    check('information deadline and private provider response');
    // Bytes are actually uploaded over multipart HTTP; the existing CI test scanner
    // scans the actual decrypted bytes via the maintenance service.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tEIAAAAASUVORK5CYII=',
      'base64',
    );
    await c
      .locator('#case-evidence input[type=file]')
      .setInputFiles({ name: 'test-evidence.png', mimeType: 'image/png', buffer: png });
    await c.getByRole('button', { name: 'Upload for scanning', exact: true }).click();
    await expect(
      c.locator('#case-evidence').getByText('Awaiting scan', { exact: true }).first(),
    ).toBeVisible();
    await rpc('scan');
    await refresh(c);
    await expect(
      c.locator('#case-evidence').getByRole('button', { name: 'View evidence', exact: true }),
    ).toBeVisible();
    await c
      .locator('#case-evidence')
      .getByRole('button', { name: 'View evidence', exact: true })
      .click();
    await expect(c.getByRole('dialog').locator('img')).toBeVisible();
    await c.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await refresh(p);
    await expect(
      p.locator('#case-evidence').getByRole('button', { name: 'View evidence', exact: true }),
    ).toHaveCount(0);
    await refresh(a);
    check('real encrypted evidence upload, scan and authorized byte read');
    await command(a, 'Build a solution', async (d) => {
      await d
        .getByLabel('Solution summary', { exact: true })
        .fill('A return visit and a written clarification resolve the remaining service issues.');
      await d.getByLabel('Remedy type', { exact: true }).selectOption('REPERFORM');
      await d
        .getByLabel('What will happen', { exact: true })
        .fill('Complete the outstanding agreed task during a mutually arranged return visit.');
      await d.getByRole('button', { name: 'Add another commitment', exact: true }).click();
      await d
        .getByLabel('What will happen', { exact: true })
        .nth(1)
        .fill('Provide written clarification of the completed and outstanding work.');
    });
    for (const page of [c, p]) {
      await refresh(page);
      await command(page, 'Accept these terms');
    }
    await refresh(a);
    await command(a, 'Record a decision', async (d) => {
      await d.getByLabel('Proposed solution', { exact: true }).selectOption({ index: 1 });
      await d.getByLabel('Structured reason', { exact: true }).selectOption('AGREED_RESOLUTION');
      await d
        .getByLabel('Explanation shared with both parties', { exact: true })
        .fill(
          'Both parties agreed to the two service commitments based on the recorded responses.',
        );
      await d
        .getByRole('group', { name: 'Event sources used for this decision', exact: true })
        .getByRole('checkbox')
        .first()
        .check();
    });
    await refresh(c);
    await refresh(p);
    await expect(c.getByRole('heading', { name: 'Decision recorded', exact: true })).toBeVisible();
    check('compound proposal, two independent consents and immutable decision');
    await command(p, 'Request independent review', async (d) =>
      d
        .getByRole('textbox')
        .fill(
          'Please independently verify that the commitment terms match the recorded agreement.',
        ),
    );
    await refresh(a);
    await expect(a.getByRole('button', { name: 'Decide the appeal', exact: true })).toHaveCount(0);
    await command(a, 'Assign reviewer', async (d) => {
      await expect(d.locator(`option[value="${data.credentials.reviewer.id}"]`)).toHaveCount(0);
      await d.getByRole('combobox').selectOption(data.credentials.independent.id);
    });
    await refresh(i);
    await command(i, 'Decide the appeal', async (d) => {
      await d.getByLabel('Proposed solution', { exact: true }).selectOption({ index: 1 });
      await d.getByLabel('Structured reason', { exact: true }).selectOption('INDEPENDENT_REVIEW');
      await d
        .getByLabel('Explanation shared with both parties', { exact: true })
        .fill(
          'An independent review confirms the recorded agreement; the original decision remains preserved.',
        );
      await d
        .getByRole('group', { name: 'Event sources used for this decision', exact: true })
        .getByRole('checkbox')
        .first()
        .check();
    });
    for (const page of [c, p]) {
      await refresh(page);
      await command(page, 'Confirm fulfilment');
    }
    await refresh(i);
    await command(i, 'Close the case');
    await refresh(c);
    await expect(c.getByRole('heading', { name: 'Closed', exact: true })).toBeVisible();
    await rpc('closed', { caseId });
    check('independent appeal, preserved original, two fulfilments and closure');
    // Render the real case, not mocked state, across the acceptance matrix.
    for (const role of ['seeker', 'reviewer']) {
      const page = pages[role];
      await refresh(page);
      for (const lang of ['en', 'ar']) {
        const target = lang === 'ar' ? 'Switch to Arabic' : 'Switch to English';
        const control = page.getByRole('button', { name: target, exact: true });
        if (await control.count()) await control.click();
        // Admin uses its existing bilingual toggle accessible names.
        if ((await page.getByTestId('dispute-workspace').getAttribute('lang')) !== lang) {
          await page.evaluate((l) => localStorage.setItem('hsm.lang', l), lang);
          await page.reload();
        }
        await expect(page.getByTestId('dispute-workspace')).toHaveAttribute('lang', lang);
        for (const width of [320, 390, 430, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(() => globalThis.document.fonts.ready);
          expect(
            await page.evaluate(
              () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
            ),
          ).toBe(true);
          const issues = (
            await new AxeBuilder({ page })
              .include('[data-testid="dispute-workspace"]')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations;
          await writeFile(
            path.join(out, `${role}-${lang}-${width}-axe.json`),
            JSON.stringify(issues, null, 2),
          );
          expect(issues).toEqual([]);
          await page.evaluate(() => globalThis.scrollTo(0, 0));
          await page.screenshot({
            path: path.join(out, `${role}-${lang}-${width}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }
      }
    }
    check('24 real-route EN/AR responsive screenshots and automated accessibility');
    await writeFile(
      path.join(out, 'summary.json'),
      JSON.stringify(
        {
          checks: results,
          transport: 'real HTTP and database; no route interception',
          scanner:
            process.env.DISPUTE_TEST_SCANNER === 'clamav'
              ? 'real ClamAV service'
              : 'deterministic test adapter, not production malware detection',
          commit: process.env.GITHUB_SHA ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    for (const [name, page] of Object.entries(pages)) {
      try {
        await page.screenshot({ path: path.join(out, `failure-${name}.png`), fullPage: true });
        await writeFile(
          path.join(out, `failure-${name}.txt`),
          await page.locator('body').innerText(),
        );
      } catch {
        /* Preserve the original browser failure if capture is unavailable. */
      }
    }
    throw error;
  } finally {
    await browser.close();
  }
}
