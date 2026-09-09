import { expect, test, type Frame, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { seedLanguage } from './fixtures';
import { api, newJar, otpFor, REAL_API, type Jar } from './real-api';
import {
  assertFontsReady,
  freezeMotion,
  injectVendoredFonts,
  neutraliseHarnessFontWeight,
  serveVendoredAssets,
} from './prototype-assets';

// Sprint 09B.29 — TEMPORARY. Deleted once parity is reached.
//
// Answers two questions with evidence rather than assertion, for BOTH
// activation screens:
//
//  1. WHERE are the differing pixels? Handled by `e2e/assets/diff-regions.mjs`,
//     which runs over the artefacts this and the gate spec leave behind.
//  2. WHY? A side-by-side dump of the computed styles and boxes of the
//     corresponding elements in the reference and the implementation.
//
// The reference half opens the immutable prototype under exactly the asset
// layer, fonts and harness neutralisations the reference CAPTURE uses, so the
// numbers printed here are the numbers the snapshot was taken at.

const HERE = dirname(fileURLToPath(import.meta.url));
const FLAG_KEY = 'hsm.ff.providerOnboardingV2';
const PASSWORD = 'a-reasonable-passphrase-1';
const SURFACE = { width: 388, height: 764 };

const PROTOTYPE = pathToFileURL(
  join(
    HERE,
    '..',
    '..',
    '..',
    'docs',
    'provider-experience-v2',
    'reference',
    'provider-onboarding-prototype.html',
  ),
).href;

const SHELL = '[data-testid="onboarding-v2-shell"]';

interface Pair {
  name: string;
  ref: string;
  impl: string;
}

/** Screen 0 — activation. */
const SCREEN_0_PAIRS: Pair[] = [
  { name: 'topbar', ref: '.hsm-topbar', impl: `${SHELL} header > div:first-child` },
  {
    name: 'topbar-close',
    ref: '.hsm-topbar .hsm-icon-action',
    impl: '[data-testid="onboarding-v2-close"]',
  },
  {
    name: 'topbar-close-svg',
    ref: '.hsm-topbar .hsm-icon-action svg',
    impl: '[data-testid="onboarding-v2-close"] svg',
  },
  { name: 'topbar-title', ref: '.hsm-topbar h1', impl: `${SHELL} h1` },
  { name: 'progress', ref: '.hsm-progress', impl: '[data-testid="onboarding-v2-progress-bar"]' },
  { name: 'hero', ref: '.hsm-hero', impl: '[data-testid="activation-hero"]' },
  { name: 'hero-icon', ref: '.hsm-hero-icon', impl: '[data-testid="activation-hero"] > span' },
  {
    name: 'hero-icon-svg',
    ref: '.hsm-hero-icon svg',
    impl: '[data-testid="activation-hero"] > span svg',
  },
  {
    name: 'hero-heading',
    ref: '.hsm-hero .hsm-heading',
    impl: '[data-testid="activation-hero"] h2',
  },
  { name: 'hero-lead', ref: '.hsm-hero .hsm-lead', impl: '[data-testid="activation-hero"] p' },
  { name: 'panel', ref: '.hsm-panel', impl: '[data-testid="activation-panel"]' },
  { name: 'panel-title', ref: '.hsm-panel h2', impl: '[data-testid="activation-panel"] h3' },
  { name: 'panel-body', ref: '.hsm-panel p', impl: '[data-testid="activation-panel"] p' },
  { name: 'sticky-bar', ref: '.hsm-sticky', impl: '[data-testid="onboarding-v2-sticky"]' },
  { name: 'primary', ref: '.hsm-sticky .hsm-primary', impl: '[data-testid="activation-cta"]' },
];

/** Screen 1 — role/session synchronization. */
const SCREEN_1_PAIRS: Pair[] = [
  { name: 'topbar', ref: '.hsm-topbar', impl: `${SHELL} header > div:first-child` },
  { name: 'topbar-title', ref: '.hsm-topbar h1', impl: `${SHELL} h1` },
  { name: 'topbar-subtitle', ref: '.hsm-topbar p', impl: '[data-testid="onboarding-v2-progress"]' },
  { name: 'progress', ref: '.hsm-progress', impl: '[data-testid="onboarding-v2-progress-bar"]' },
  { name: 'center', ref: '.hsm-center', impl: '[data-testid="activation-sync-screen"]' },
  { name: 'center-icon', ref: '.hsm-center-icon', impl: '[data-testid="activation-sync-icon"]' },
  {
    name: 'center-icon-svg',
    ref: '.hsm-center-icon svg',
    impl: '[data-testid="activation-sync-icon"] svg',
  },
  {
    name: 'center-heading',
    ref: '.hsm-center > h1',
    impl: '[data-testid="activation-sync-heading"]',
  },
  { name: 'center-lead', ref: '.hsm-center > p', impl: '[data-testid="activation-sync-lead"]' },
  {
    name: 'alert',
    ref: '.hsm-center .hsm-alert',
    impl: '[data-testid="activation-sync-notice"] > div',
  },
  {
    name: 'alert-svg',
    ref: '.hsm-center .hsm-alert > span svg',
    impl: '[data-testid="activation-sync-notice"] svg',
  },
  {
    name: 'alert-title',
    ref: '.hsm-center .hsm-alert h2',
    impl: '[data-testid="activation-sync-notice"] [data-part="title"]',
  },
  {
    name: 'alert-body',
    ref: '.hsm-center .hsm-alert p',
    impl: '[data-testid="activation-sync-notice"] [data-part="body"]',
  },
  { name: 'sticky-bar', ref: '.hsm-sticky', impl: '[data-testid="onboarding-v2-sticky"]' },
  { name: 'primary', ref: '.hsm-sticky .hsm-primary', impl: '[data-testid="activation-sync-cta"]' },
];

const PROPS = [
  'display',
  'gridTemplateColumns',
  'alignContent',
  'justifyItems',
  'flexDirection',
  'backgroundColor',
  'color',
  'textAlign',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'gap',
  'rowGap',
  'columnGap',
  'borderRadius',
  'borderTopWidth',
  'borderTopColor',
  'boxShadow',
  'boxSizing',
  'minHeight',
  'position',
] as const;

/** Font family is declared differently on the two sides by design — the
 *  prototype names its own fallback chain — and the VENDORED faces are what
 *  both actually render in. Comparing the declaration produces noise on every
 *  element, so the fact that matters (the resolved family) is asserted by
 *  `assertFontsReady` instead. */
const NOISE = new Set(['fontFamily']);

async function describe(
  target: Page | Frame,
  selector: string,
  originSelector: string,
): Promise<Record<string, string> | null> {
  return target.evaluate(
    ([sel, origin, props]) => {
      const el = document.querySelector(sel as string);
      if (!el) return null;
      const o = document.querySelector(origin as string)!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const out: Record<string, string> = {
        x: (r.x - o.x).toFixed(1),
        y: (r.y - o.y).toFixed(1),
        w: r.width.toFixed(1),
        h: r.height.toFixed(1),
      };
      for (const p of props as string[]) out[p] = (cs as unknown as Record<string, string>)[p];
      return out;
    },
    [selector, originSelector, PROPS as unknown as string[]] as const,
  );
}

/** The prototype, under the reference capture's exact conditions. */
async function openPrototype(page: Page): Promise<Frame> {
  await serveVendoredAssets(page);
  await page.setViewportSize({ width: 422, height: 900 });
  await page.goto(PROTOTYPE);
  await page.waitForSelector('iframe');
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  await frame.waitForSelector('#hsm-phone-content');
  await injectVendoredFonts(frame);
  await neutraliseHarnessFontWeight(frame);
  await freezeMotion(frame);
  await assertFontsReady(frame);
  await frame.waitForFunction(() => document.querySelectorAll('#hsm-phone-content svg').length > 0);
  return frame;
}

async function setLanguage(frame: Frame, lang: 'en' | 'ar'): Promise<void> {
  const want = lang === 'ar' ? 'rtl' : 'ltr';
  if ((await frame.getAttribute('.hsm-phone-inner', 'dir')) !== want)
    await frame.click('#hsm-lang');
  await frame.waitForFunction(
    (d) => document.querySelector('.hsm-phone-inner')?.getAttribute('dir') === d,
    want,
  );
  await frame.waitForFunction(() => document.querySelectorAll('#hsm-phone-content svg').length > 0);
}

async function selectScreen(frame: Frame, index: number): Promise<void> {
  await frame.selectOption('#hsm-screen-picker', String(index));
  await frame.waitForFunction(
    (i) => (document.getElementById('hsm-screen-picker') as HTMLSelectElement).value === String(i),
    index,
  );
  await frame.waitForFunction(() => document.querySelectorAll('#hsm-phone-content svg').length > 0);
}

test.describe('DIAGNOSTIC — visual residue', () => {
  test.skip(!REAL_API, 'needs the real stack');
  test.describe.configure({ timeout: 240_000 });

  test('computed style comparison, screens 0 and 1 (en)', async ({ page, context }) => {
    const frame = await openPrototype(page);
    await setLanguage(frame, 'en');

    // ── implementation ──────────────────────────────────────────────────
    const impl = await context.newPage();
    await serveVendoredAssets(impl);
    await impl.addInitScript(([k]) => window.localStorage.setItem(k, 'true'), [FLAG_KEY]);
    await seedLanguage(context, 'en');
    await impl.setViewportSize(SURFACE);

    const jar: Jar = newJar();
    const email = `vdiag-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
    const reg = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
      method: 'POST',
      body: { email, password: PASSWORD, firstName: 'Sam', lastName: 'Seeker' },
    });
    expect(reg.status).toBeLessThan(400);
    expect(
      (
        await api(jar, '/v1/auth/verify-otp', {
          method: 'POST',
          body: { challengeId: reg.body.challengeId, code: await otpFor(email) },
        })
      ).status,
    ).toBe(200);

    await impl.goto('/login');
    await impl.locator('input[type="email"]').fill(email);
    await impl.locator('input[type="password"]').fill(PASSWORD);
    await impl.getByRole('button', { name: 'Log In', exact: true }).click();
    const otp = impl.getByTestId('otp-input');
    await otp.waitFor({ state: 'visible', timeout: 45_000 });
    await otp.fill(await otpFor(email));
    await impl.getByRole('button', { name: 'Confirm' }).click();
    await impl.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });

    const lines: string[] = [];
    const machine: Record<string, unknown> = {};

    const compare = async (label: string, pairs: Pair[]) => {
      lines.push(`\n══════════ ${label} ══════════`);
      const rows: Record<string, unknown> = {};
      for (const p of pairs) {
        const a = await describe(frame, p.ref, '#hsm-phone-content');
        const b = await describe(impl, p.impl, SHELL);
        rows[p.name] = { ref: a, impl: b };
        lines.push(`\n### ${p.name}`);
        if (!a || !b) {
          lines.push(
            `  MISSING  ref=${a ? 'present' : 'ABSENT'}  impl=${b ? 'present' : 'ABSENT'}`,
          );
          continue;
        }
        if (a.x !== b.x || a.y !== b.y)
          lines.push(`  pos    ref=(${a.x},${a.y})  impl=(${b.x},${b.y})  <-- DIFFERS`);
        if (a.w !== b.w || a.h !== b.h)
          lines.push(`  size   ref=${a.w}x${a.h}  impl=${b.w}x${b.h}  <-- DIFFERS`);
        for (const k of PROPS) {
          if (NOISE.has(k)) continue;
          if (a[k] !== b[k]) lines.push(`  ${k.padEnd(20)} ref=${a[k]}  impl=${b[k]}`);
        }
      }
      machine[label] = rows;
    };

    // ── screen 0 ────────────────────────────────────────────────────────
    await selectScreen(frame, 0);
    await setLanguage(frame, 'en');
    await impl.goto('/provider/activate');
    await impl.getByTestId('activation-hero').waitFor();
    await freezeMotion(impl);
    await assertFontsReady(impl);
    await compare('screen-0-activation', SCREEN_0_PAIRS);

    // ── screen 1 ────────────────────────────────────────────────────────
    // Held, not faked: the real rotation is delayed so the transient screen
    // can be measured, and it completes for real afterwards.
    await impl.route('**/v1/auth/refresh', async (route) => {
      await new Promise((r) => setTimeout(r, 12_000));
      await route.continue();
    });
    await selectScreen(frame, 1);
    await setLanguage(frame, 'en');
    await impl.getByTestId('activation-cta').click();
    await impl.getByTestId('activation-sync-notice').waitFor({ timeout: 30_000 });
    // Same reason as the gate spec: the click leaves the pointer over screen
    // 1's sticky action, which sits exactly where screen 0's did.
    await impl.mouse.move(4, 120);
    await freezeMotion(impl);
    await assertFontsReady(impl);
    await compare('screen-1-sync', SCREEN_1_PAIRS);

    writeFileSync(join(HERE, '..', 'visual-diagnostic.txt'), lines.join('\n'));
    writeFileSync(join(HERE, '..', 'visual-diagnostic.json'), JSON.stringify(machine, null, 2));
    console.log(lines.join('\n'));
  });
});
