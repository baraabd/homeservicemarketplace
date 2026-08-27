import { expect, test, type Page, type Route } from '@playwright/test';

import { seedLanguage, signedInAdmin, stubApi } from './fixtures';

// Sprint 9B.12 — the admin verification and policy surface in a real browser.
//
// docs/sprint-09b12/ADMIN_VERIFICATION_UX.md
//
// The component tests already prove each panel in isolation. What only a
// browser can show is the reviewer's actual path through the console: sign in,
// reach the section, work the queue, open a case, look at the evidence, decide,
// and — on the OTHER axis, in its own block — act on the account.
//
// Viewport policy follows the existing admin suite: the Admin Dashboard is a
// declared desktop surface (a 256px sidebar beside a data table), so these
// flows run at the desktop project only. Asserting them at 375px would be
// testing a surface the console was never built for, and the brief asks for
// desktop admin flows.
//
// The API is stubbed so each scenario starts from a known state. The
// authorization behind these states is proved against the real API and database
// by the API integration suite; what is under test here is what the reviewer
// sees and can reach.

// The console is built around a 256px sidebar beside a data table; the other
// admin suite documents the same policy. Below this width these flows would be
// asserting a surface the console was never designed for.
const DESKTOP_WIDTH = 1440;
const DESKTOP_ONLY = 'The admin console is a declared desktop surface; these are desktop flows.';

const QUEUE_ITEM = {
  id: 'case-1',
  providerProfileId: 'pp-1',
  providerDisplayName: 'Pat Provider',
  state: 'SUBMITTED',
  policyVersion: '2026.08-v1',
  country: 'SY',
  submittedAt: '2026-06-15T00:00:00.000Z',
  assignedToUserId: null,
  documentCount: 1,
  availableActions: ['approve', 'reject', 'requestAction'],
  blockedReason: null,
};

function verificationCase(over: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    providerProfileId: 'pp-1',
    state: 'SUBMITTED',
    policyVersion: '2026.08-v1',
    country: 'SY',
    providerType: 'INDIVIDUAL',
    submittedAt: '2026-06-15T00:00:00.000Z',
    assignedToUserId: null,
    assignedAt: null,
    decidedAt: null,
    requirements: [
      {
        kind: 'INDIVIDUAL_IDENTITY',
        serviceCategoryId: null,
        serviceCategoryLabelEn: null,
        serviceCategoryLabelAr: null,
        satisfied: true,
      },
    ],
    documents: [
      {
        id: 'doc-1',
        kind: 'INDIVIDUAL_IDENTITY',
        serviceCategoryId: null,
        serviceCategoryLabelEn: null,
        serviceCategoryLabelAr: null,
        sizeBytes: 1024,
        displayFilename: 'passport.jpg',
        scanState: 'CLEAN',
        viewable: true,
        uploadedAt: '2026-06-15T00:00:00.000Z',
        evidenceDeletedAt: null,
        supersededAt: null,
      },
    ],
    decisions: [],
    availableActions: ['approve', 'reject', 'requestAction'],
    blockedReason: null,
    workAccess: null,
    ...over,
  };
}

const POLICY = {
  version: '2026.08-v1',
  country: 'SY',
  providerType: null,
  categoryId: null,
  requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
  publishedAt: '2026-08-01T00:00:00.000Z',
  retiredAt: null,
  publishedByUserId: 'admin-1',
  isLive: true,
};

/** Provider rows for the ACCOUNT axis, each carrying what the server says is
 *  legal from its status. The drawer renders nothing without them — a missing
 *  rule fails closed, which is itself part of what these rows exercise. */
function providerRows() {
  return [
    {
      id: 'pp-active',
      status: 'ACTIVE',
      userId: 'u-1',
      email: 'active@example.com',
      displayName: 'Working Provider',
      initials: 'WP',
      ratingAvg: 4.5,
      reviewCount: 10,
      completedJobs: 5,
      verified: true,
      topPro: false,
      serviceAreaCity: 'Damascus',
      serviceAreaCountry: 'Syria',
      reviewNotes: null,
      submittedForReviewAt: '2026-08-06T00:00:00.000Z',
      reviewedAt: '2026-08-07T00:00:00.000Z',
      rejectionReason: null,
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      availableActions: ['suspend'],
    },
    {
      id: 'pp-suspended',
      status: 'SUSPENDED',
      userId: 'u-2',
      email: 'suspended@example.com',
      displayName: 'Paused Provider',
      initials: 'PP',
      ratingAvg: 4.1,
      reviewCount: 3,
      completedJobs: 1,
      verified: false,
      topPro: false,
      serviceAreaCity: 'Aleppo',
      serviceAreaCountry: 'Syria',
      reviewNotes: null,
      submittedForReviewAt: '2026-08-06T00:00:00.000Z',
      reviewedAt: '2026-08-07T00:00:00.000Z',
      rejectionReason: null,
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      availableActions: ['reactivate'],
    },
  ];
}

interface Recorded {
  path: string;
  body: unknown;
}

interface Options {
  lang?: 'en' | 'ar';
  queueItems?: unknown[];
  kase?: Record<string, unknown>;
  /** Status for a case COMMAND. 409 = someone else decided first. */
  commandStatus?: number;
  /** Status for the queue read. 403 = this reviewer may not review. */
  queueStatus?: number;
  /** Status for a restricted evidence read. */
  evidenceStatus?: number;
  /** Everything the page sent, in order. */
  sent?: Recorded[];
}

/**
 * Sign in as an admin and land on the verification section.
 *
 * `stubApi` is registered FIRST so the dashboard shell (identity, analytics,
 * notifications) renders from the same known state every other admin scenario
 * uses. The verification routes are registered second and win, because
 * Playwright matches the most recently added handler first; anything this
 * handler does not recognise falls through to the shell stub.
 */
async function openVerification(page: Page, options: Options = {}): Promise<void> {
  const lang = options.lang ?? 'en';
  const sent = options.sent ?? [];

  await seedLanguage(page, lang);
  await stubApi(page, { me: signedInAdmin(), providers: providerRows() });

  await page.route('**/v1/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST') {
      // A body-less POST (reactivate takes no reason) throws rather than
      // returning null, and losing the record would make the assertion below
      // silently vacuous.
      let body: unknown;
      try {
        body = request.postDataJSON();
      } catch {
        body = null;
      }
      sent.push({ path: pathname, body });
    }

    // ── the CASE axis ────────────────────────────────────────────────────
    if (method === 'POST' && /\/admin\/verification\/cases\/[^/]+\/[a-z-]+$/.test(pathname)) {
      if (options.commandStatus && options.commandStatus !== 200) {
        return json(
          { success: false, error: { code: 'CONFLICT', message: 'This case has moved on.' } },
          options.commandStatus,
        );
      }
      return json({ caseId: 'case-1', state: 'VERIFIED', changed: true, availableActions: [] });
    }
    if (pathname.endsWith('/admin/verification/cases/case-1/audit')) {
      return json({ items: [], nextCursor: null });
    }
    if (pathname.endsWith('/admin/verification/cases/case-1')) {
      return json(options.kase ?? verificationCase());
    }
    if (pathname.endsWith('/admin/verification/cases')) {
      if (options.queueStatus && options.queueStatus !== 200) {
        return json({ success: false, error: { code: 'FORBIDDEN' } }, options.queueStatus);
      }
      return json({ items: options.queueItems ?? [QUEUE_ITEM], nextCursor: null });
    }
    if (pathname.includes('/admin/verification/policies')) {
      if (method === 'POST') return json({ policy: POLICY });
      return json({ policies: [POLICY] });
    }

    // ── restricted evidence: the one route that serves the bytes ─────────
    if (/\/verification\/documents\/[^/]+\/content$/.test(pathname)) {
      if (options.evidenceStatus && options.evidenceStatus !== 200) {
        return json({ success: false, error: { code: 'NOT_FOUND' } }, options.evidenceStatus);
      }
      return route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        headers: { 'content-disposition': 'attachment; filename="passport.jpg"' },
        body: 'not-a-real-passport',
      });
    }

    // ── the ACCOUNT axis ─────────────────────────────────────────────────
    if (method === 'POST' && /\/admin\/providers\/[^/]+\/[a-z]+$/.test(pathname)) {
      const id = pathname.split('/admin/providers/')[1].split('/')[0];
      const row = providerRows().find((p) => p.id === id);
      return json({ ...row, status: pathname.endsWith('/suspend') ? 'SUSPENDED' : 'ACTIVE' });
    }
    if (/\/admin\/providers\/[^/]+\/verification$/.test(pathname)) {
      return json(null);
    }
    if (/\/admin\/providers\/[^/]+\/audit$/.test(pathname)) {
      return json({ items: [], nextCursor: null });
    }
    if (/\/admin\/providers\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/admin/providers/')[1];
      const row = providerRows().find((p) => p.id === id);
      return row ? json(row) : json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
    }

    return route.fallback();
  });

  await page.goto('/admin');
  await page.getByTestId('nav-verification').click();
}

/** Open the one queue row and wait for the case behind it. */
async function openCase(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pat Provider' }).click();
  await expect(page.getByTestId('case-policy-version')).toBeVisible();
}

/** Drive one case action through its confirmation. */
async function decide(page: Page, action: string, reason: string): Promise<void> {
  await page.getByTestId(`case-action-${action}`).click();
  await expect(page.getByTestId('case-action-dialog')).toBeVisible();
  await page.getByTestId('case-action-reason').selectOption(reason);
  await page.getByTestId('case-action-confirm').click();
}

test.describe('Admin verification — desktop reviewer flows', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < DESKTOP_WIDTH, DESKTOP_ONLY);

  test('the queue lists what is waiting, and a case opens from it', async ({ page }) => {
    await openVerification(page);

    await expect(page.getByTestId('verification-queue')).toBeVisible();
    await expect(page.getByTestId('queue-row-case-1')).toContainText('Pat Provider');
    await expect(page.getByTestId('queue-row-case-1')).toContainText('Awaiting review');

    await openCase(page);
    await expect(page.getByTestId('case-policy-version')).toContainText('2026.08-v1');
  });

  test('the two lifecycle axes stay in separate blocks', async ({ page }) => {
    // Approving a case judges the documents. Suspending an account judges
    // conduct. A single merged action list would have to pick one verb for two
    // decisions, and a reviewer would eventually make one meaning the other.
    await openVerification(page);
    await openCase(page);

    await expect(page.getByTestId('case-actions')).toContainText(
      'Case actions decide the documents. Account actions decide the account. They are separate.',
    );
    // The account axis is a different panel, on the same screen, with its own
    // list of what the server says is legal.
    await expect(page.getByText('Working Provider')).toBeVisible();
  });

  test('evidence review reaches the audited route, not the object store', async ({ page }) => {
    const reads: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/verification/documents/')) reads.push(r.url());
    });
    await openVerification(page);
    await openCase(page);

    await expect(page.getByText('Identity documents are restricted.', { exact: false }))
      .toBeVisible
      // The reviewer is told their reads are audited. Detection only deters
      // the people who know about it.
      ();
    await page.getByRole('button', { name: 'View document: Identity document' }).click();

    await expect
      .poll(() => reads.length, { message: 'the view button never asked for the document' })
      .toBe(1);
    expect(reads[0]).toContain('/v1/verification/documents/doc-1/content');
    await expect(page.getByTestId('evidence-open-error')).toHaveCount(0);
  });

  test('a refused evidence read says the attempt was recorded', async ({ page }) => {
    // The server answers a denial and a missing document identically, so the
    // reviewer is told only what is true: it could not be opened, and the
    // attempt is on their record.
    await openVerification(page, { evidenceStatus: 404 });
    await openCase(page);

    await page.getByRole('button', { name: 'View document: Identity document' }).click();
    await expect(page.getByTestId('evidence-open-error')).toContainText('was recorded');
  });

  test('a document the server marked unviewable cannot be opened', async ({ page }) => {
    // `viewable` is computed server-side. The client does not decide it from
    // the scan state — that would put an authorization rule in React.
    await openVerification(page, {
      kase: verificationCase({
        documents: [
          {
            ...verificationCase().documents[0],
            scanState: 'INFECTED',
            viewable: false,
          },
        ],
      }),
    });
    await openCase(page);

    await expect(page.getByRole('button', { name: /Cannot be opened/ })).toBeDisabled();
  });

  for (const [flow, action, reason] of [
    ['request changes', 'requestAction', 'DOCUMENT_MISSING'],
    ['rejection', 'reject', 'DOCUMENT_MISMATCH'],
    ['approval', 'approve', 'DOCUMENTS_COMPLETE_AND_LEGIBLE'],
  ] as const) {
    test(`${flow} captures a reason and carries the state the reviewer saw`, async ({ page }) => {
      const sent: Recorded[] = [];
      await openVerification(page, { sent });
      await openCase(page);

      await page.getByTestId(`case-action-${action}`).click();
      // Confirming without a reason sends nothing at all.
      await page.getByTestId('case-action-confirm').click();
      await expect(page.getByTestId('case-action-validation')).toBeVisible();
      expect(sent.filter((s) => s.path.includes('/admin/verification/cases/'))).toHaveLength(0);

      await page.getByTestId('case-action-reason').selectOption(reason);
      await page.getByTestId('case-action-confirm').click();

      const commands = () => sent.filter((r) => r.path.includes('/admin/verification/cases/'));
      await expect.poll(() => commands().length).toBe(1);
      expect(commands()[0].body).toMatchObject({
        reasonCode: reason,
        // The optimistic-concurrency guard. Without it the server cannot tell
        // that this reviewer was looking at a case someone else has moved.
        expectedState: 'SUBMITTED',
      });
    });
  }

  test('revocation states what it does before it is confirmed', async ({ page }) => {
    const sent: Recorded[] = [];
    await openVerification(page, {
      sent,
      kase: verificationCase({
        state: 'VERIFIED',
        availableActions: ['revoke'],
        workAccess: {
          active: true,
          status: 'ACTIVE',
          source: 'VERIFIED_DOCUMENTS',
          grantedAt: '2026-06-01T00:00:00.000Z',
          expiresAt: '2027-06-01T00:00:00.000Z',
          revokedAt: null,
        },
      }),
    });
    await openCase(page);

    // Whether they can work RIGHT NOW is a different fact from the case state,
    // and it is the fact a revoke decision turns on.
    await expect(page.getByTestId('work-access-state')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('work-access-source')).toContainText('VERIFIED_DOCUMENTS');

    await page.getByTestId('case-action-revoke').click();
    await expect(page.getByTestId('case-action-dialog')).toContainText(
      'ends this provider’s ability to take work immediately',
    );

    await page.getByTestId('case-action-reason').selectOption('TRUST_AND_SAFETY_ACTION');
    await page.getByTestId('case-action-confirm').click();
    await expect
      .poll(() => sent.map((s) => s.path))
      .toContain('/v1/admin/verification/cases/case-1/revoke');
  });

  test('a stale-state conflict is recoverable, not a dead end', async ({ page }) => {
    await openVerification(page, { commandStatus: 409 });
    await openCase(page);
    await decide(page, 'approve', 'DOCUMENTS_COMPLETE_AND_LEGIBLE');

    const conflict = page.getByTestId('case-actions-conflict');
    await expect(conflict).toContainText('Someone else got there first');
    // A permission failure is a different thing and must not be claimed here.
    await expect(page.getByTestId('case-actions-forbidden')).toHaveCount(0);
    // The actions stay, so the reviewer can reload and decide again.
    await expect(page.getByTestId('case-action-approve')).toBeVisible();
    await conflict.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByTestId('case-policy-version')).toBeVisible();
  });

  test('an unauthorized reviewer is told, not handed buttons that will fail', async ({ page }) => {
    await openVerification(page, { queueStatus: 403 });

    const error = page.getByTestId('queue-error');
    await expect(error).toContainText('You do not have permission');
    // Retrying a 403 forever is not a recovery, so no retry is offered.
    await expect(error.getByRole('button', { name: 'Reload' })).toHaveCount(0);
    await expect(page.getByTestId('queue-table')).toHaveCount(0);
    // And an error is not an empty queue — "nothing to review" would send a
    // reviewer home.
    await expect(page.getByTestId('queue-empty')).toHaveCount(0);
  });

  test('the confirmation is a real dialog a keyboard user can leave', async ({ page }) => {
    await openVerification(page);
    await openCase(page);

    await page.getByTestId('case-action-reject').click();
    const dialog = page.getByTestId('case-action-dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Focus returns to the button that opened it, not to the top of the page.
    await expect(page.getByTestId('case-action-reject')).toBeFocused();
  });

  test('policy versions are inspectable and append-only', async ({ page }) => {
    await openVerification(page);

    const panel = page.getByTestId('policy-panel');
    await expect(panel).toContainText('Policies are append-only');
    await expect(page.getByTestId('policy-row-2026.08-v1')).toBeVisible();
    await expect(page.getByTestId('policy-live-2026.08-v1')).toHaveAttribute('data-live', 'true');
    // Editing a published version would change what a provider was judged
    // against after they were judged. The control is absent, not disabled.
    await expect(panel.getByRole('button', { name: /edit/i })).toHaveCount(0);
    await expect(page.getByTestId('policy-retire-2026.08-v1')).toBeVisible();
  });
});

test.describe('Admin verification — the account axis', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < DESKTOP_WIDTH, DESKTOP_ONLY);

  for (const [flow, provider, label, path] of [
    ['suspension', 'Working Provider', 'Suspend', '/v1/admin/providers/pp-active/suspend'],
    [
      'reactivation',
      'Paused Provider',
      'Reactivate',
      '/v1/admin/providers/pp-suspended/reactivate',
    ],
  ] as const) {
    test(`${flow} is offered only where the server allows it`, async ({ page }) => {
      const sent: Recorded[] = [];
      await openVerification(page, { sent });

      await page.getByText(provider).click();
      await expect(page.getByRole('button', { name: label })).toBeEnabled();
      await page.getByRole('button', { name: label }).click();

      await expect.poll(() => sent.map((s) => s.path)).toContain(path);
    });
  }

  test('an account action the server did not offer is not clickable', async ({ page }) => {
    // The component owns no transition table: it renders what it is told. An
    // enabled Approve on a provider the server would refuse teaches reviewers
    // to click and hope.
    await openVerification(page);

    await page.getByText('Working Provider').click();
    await expect(page.getByRole('button', { name: 'Reactivate' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
});

test.describe('Admin verification — Arabic', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < DESKTOP_WIDTH, DESKTOP_ONLY);

  test('the whole surface renders right-to-left in Arabic', async ({ page }) => {
    await openVerification(page, { lang: 'ar' });

    await expect(page.getByTestId('admin-verification-workspace')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('verification-queue')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('policy-panel')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('verification-queue')).toContainText('قائمة التحقق');

    await page.getByRole('button', { name: 'Pat Provider' }).click();
    await expect(page.getByTestId('case-actions')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('case-action-reject')).toContainText('رفض');
  });
});
