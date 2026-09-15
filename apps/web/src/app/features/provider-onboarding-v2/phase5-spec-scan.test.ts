import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanSpecForMocking } from '../../../../e2e/phase5-spec-scan';

// Sprint 09B.29 Phase 5 — proving a spec is interception-free by READING it.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// The ledger asked the test to declare `interceptionFree: true` about itself.
// A spec that mocks every request can write that line as easily as one that
// mocks nothing, so the claim carried no information at all.
//
// This reads the spec instead. It is still not proof on its own — a trace from
// the run supplies the other half — but it closes the gap where a marker and
// the code that produced it disagree, and it does so before the run rather
// than after.

let dir: string;

function spec(source: string): string {
  const file = join(dir, 'candidate.spec.ts');
  writeFileSync(file, source);
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase5-scan-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the scan finds interception however it is written', () => {
  it('accepts a spec that mocks nothing', () => {
    const result = scanSpecForMocking(
      spec(`
        import { test, expect } from '@playwright/test';
        test('real', async ({ page }) => {
          await page.goto('/provider/onboarding');
          await expect(page.getByTestId('hub-task-list')).toBeVisible();
        });
      `),
    );
    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('catches page.route', () => {
    const result = scanSpecForMocking(
      spec(`test('x', async ({ page }) => { await page.route('**/v1/**', r => r.fulfill({})); });`),
    );
    expect(result.clean).toBe(false);
    expect(result.findings.map((f) => f.mechanism)).toContain('page.route');
  });

  it('catches context.route', () => {
    const result = scanSpecForMocking(
      spec(`test('x', async ({ context }) => { await context.route('**', r => r.abort()); });`),
    );
    expect(result.findings.map((f) => f.mechanism)).toContain('context.route');
  });

  it('catches route.fulfill even when the route call is elsewhere', () => {
    const result = scanSpecForMocking(
      spec(`const handler = (route) => route.fulfill({ status: 200, body: '{}' });`),
    );
    expect(result.findings.map((f) => f.mechanism)).toContain('route.fulfill');
  });

  it('catches HAR replay', () => {
    const result = scanSpecForMocking(
      spec(`test('x', async ({ page }) => { await page.routeFromHAR('api.har'); });`),
    );
    expect(result.findings.map((f) => f.mechanism)).toContain('routeFromHAR');
  });

  it('catches MSW and service-worker mocking', () => {
    const result = scanSpecForMocking(
      spec(`
        import { setupWorker } from 'msw/browser';
        test('x', async ({ page }) => { await page.addInitScript(() => navigator.serviceWorker.register('/mock-sw.js')); });
      `),
    );
    const found = result.findings.map((f) => f.mechanism);
    expect(found).toContain('msw');
    expect(found).toContain('serviceWorker');
  });

  it('catches a browser-local draft being seeded', () => {
    const result = scanSpecForMocking(
      spec(
        `test('x', async ({ page }) => { await page.addInitScript(() => localStorage.setItem('hsm.draft', '{}')); });`,
      ),
    );
    expect(result.findings.map((f) => f.mechanism)).toContain('localStorage-seed');
  });

  it('reports the line, so a reviewer can go and look', () => {
    const result = scanSpecForMocking(
      spec(`line one\nline two\nawait page.route('**/x', r => r.abort());\n`),
    );
    expect(result.findings[0].line).toBe(3);
  });
});

describe('the scan does not cry wolf', () => {
  it('ignores the mechanism named inside a comment', () => {
    const result = scanSpecForMocking(
      spec(`
        // This spec deliberately does NOT use page.route, because it is the
        // real-HTTP evidence for the route counter.
        test('x', async ({ page }) => { await page.goto('/'); });
      `),
    );
    expect(result.clean).toBe(true);
  });

  it('ignores a string that merely mentions the word route', () => {
    const result = scanSpecForMocking(
      spec(
        `test('x', async ({ page }) => { await page.goto('/provider/onboarding/route-test'); });`,
      ),
    );
    expect(result.clean).toBe(true);
  });
});

describe('the real suites are classified correctly', () => {
  it('classifies the existing mocked Basics spec as intercepting', async () => {
    // It intercepts `/v1/me/provider/onboarding/**`, which is the API under
    // test. That is exactly why it is PROVISIONAL_UI and cannot earn route
    // credit, however green it is.
    const { fileURLToPath } = await import('node:url');
    const { dirname, join: j } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const basics = j(here, '../../../../e2e/provider-onboarding-v2-basics.spec.ts');

    const result = scanSpecForMocking(basics);
    expect(result.clean).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
