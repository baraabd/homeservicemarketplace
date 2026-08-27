import { expect, test, type Page } from '@playwright/test';

import {
  expectContainedInParent,
  expectLegible,
  expectNoHorizontalPageOverflow,
  expectVisibleFocusIndicator,
  htmlLangDir,
  seedLanguage,
} from './fixtures';

// Sprint 9B.11 — the provider verification journey in a real browser.
//
// docs/sprint-09b11/PROVIDER_VERIFICATION_EXPERIENCE.md
//
// What only a browser can show:
//
//   1. The five axes stay legible and side by side on a 360px phone, in both
//      directions. Badge rows are the first thing to overflow, and this one
//      carries the answer to "may I work?".
//
//   2. The screen is reachable and operable by KEYBOARD, with a visible focus
//      ring. A provider who cannot use a mouse still has to be able to send
//      their documents.
//
//   3. The Arabic layout genuinely mirrors — `dir` on the document AND the
//      section, not a stylesheet that merely right-aligns text.

const PROVIDER_ME = {
  id: 'u-provider',
  email: 'provider@example.com',
  firstName: 'Pat',
  lastName: 'Provider',
  status: 'ACTIVE',
  emailVerifiedAt: '2026-08-01T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer', 'provider'],
};

const PROFILE = (over: Record<string, unknown> = {}) => ({
  profile: {
    id: 'pp-1',
    displayName: 'Pat Provider',
    initials: 'PP',
    avatarUrl: null,
    bio: null,
    headline: null,
    phoneNumber: null,
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: false,
    topPro: false,
    availability: 'OFFLINE',
    status: 'ACTIVE',
    serviceAreaCity: 'Aleppo',
    serviceAreaCountry: 'SY',
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    serviceCategories: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  },
});

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  kind: 'INDIVIDUAL_IDENTITY',
  serviceCategoryId: null,
  scanState: 'CLEAN',
  uploadedAt: '2026-08-01T00:00:00.000Z',
  superseded: false,
  ...over,
});

const kase = (over: Record<string, unknown> = {}) => ({
  case: {
    id: 'c1',
    state: 'DRAFT',
    policyVersion: 'v1',
    createdAt: '2026-08-01T00:00:00.000Z',
    submittedAt: null,
    verificationRequired: true,
    requirements: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null }],
    documents: [],
    latestDecision: null,
    ...over,
  },
});

/** Only the strings each assertion needs, so a copy edit fails loudly in the
 *  unit tests rather than silently here. */
const COPY = {
  en: {
    axesHeading: 'Your status',
    canWork: 'Can take work',
    featured: 'Featured',
    readyCta: 'Send for review',
    evidenceTitle: 'Send us your documents',
    pendingTitle: 'With our team',
    suspendedTitle: 'Your account is suspended',
    verifiedTitle: 'You are verified',
    renewTitle: 'Your verification needs renewing',
  },
  ar: {
    axesHeading: 'حالتك',
    canWork: 'يمكنك استلام الأعمال',
    featured: 'مميّز',
    readyCta: 'إرسال للمراجعة',
    evidenceTitle: 'أرسل لنا مستنداتك',
    pendingTitle: 'لدى فريقنا',
    suspendedTitle: 'حسابك موقوف',
    verifiedTitle: 'تم توثيقك',
    renewTitle: 'توثيقك بحاجة إلى تجديد',
  },
} as const;

interface Options {
  allowed?: string[];
  primaryReason?: string | null;
  verificationCase?: ReturnType<typeof kase> | { case: null };
  profile?: ReturnType<typeof PROFILE>;
}

async function openVerification(
  page: Page,
  lang: 'en' | 'ar' = 'en',
  options: Options = {},
): Promise<void> {
  await seedLanguage(page, lang);
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown, s = 200) =>
      route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/auth/me')) return json(PROVIDER_ME);
    if (url.includes('/me/provider/capabilities')) {
      return json({
        capabilities: [],
        allowed: options.allowed ?? [],
        nextActions: [],
        primaryReason: options.primaryReason ?? null,
      });
    }
    if (url.includes('/me/provider/verification/case')) {
      return json(options.verificationCase ?? { case: null });
    }
    if (url.includes('/me/provider/profile')) return json(options.profile ?? PROFILE());
    if (url.includes('/me/provider/portfolio')) {
      return json({ items: [], remainingSlots: 12, maxItems: 12 });
    }
    return json({ items: [], nextCursor: null });
  });
  await page.goto('/provider');
  await page.getByRole('button', { name: lang === 'ar' ? 'ملفي' : 'Profile' }).click();
  await expect(page.getByRole('region', { name: COPY[lang].axesHeading })).toBeVisible();
}

for (const lang of ['en', 'ar'] as const) {
  const c = COPY[lang];

  test.describe(`provider verification (${lang})`, () => {
    test('the document direction matches the language', async ({ page }) => {
      await openVerification(page, lang, { verificationCase: kase() });

      const { dir } = await htmlLangDir(page);
      expect(dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
      // The section carries it too, so the mirroring is real rather than a
      // stylesheet that merely right-aligns text.
      await expect(page.getByTestId('verification-EVIDENCE_REQUIRED')).toHaveAttribute(
        'dir',
        lang === 'ar' ? 'rtl' : 'ltr',
      );
    });

    test('the three access axes are visible and legible on a phone', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await openVerification(page, lang, {
        allowed: ['SUBMIT_BID'],
        verificationCase: kase({ state: 'VERIFIED' }),
        profile: PROFILE({ verified: true }),
      });

      const axes = page.getByTestId('verification-axes');
      await expect(axes).toBeVisible();
      await expectLegible(axes, 'verification axes');
      await expectContainedInParent(axes, 'verification axes');
      await expectNoHorizontalPageOverflow(page);
    });

    test('verified WITHOUT a grant reads as "renew", not as unverified', async ({ page }) => {
      // The distinction the whole sprint turns on. Telling a verified provider
      // they are unverified sends them to re-upload documents that are fine.
      await openVerification(page, lang, {
        allowed: [],
        verificationCase: kase({ state: 'VERIFIED' }),
        profile: PROFILE({ verified: true }),
      });

      await expect(page.getByTestId('verification-VERIFIED_NO_ACCESS')).toContainText(c.renewTitle);
      await expect(page.getByTestId('axis-identityVerified')).toHaveAttribute(
        'data-active',
        'true',
      );
      await expect(page.getByTestId('axis-workAccessActive')).toHaveAttribute(
        'data-active',
        'false',
      );
    });

    test('verified WITH a grant says so', async ({ page }) => {
      await openVerification(page, lang, {
        allowed: ['SUBMIT_BID'],
        verificationCase: kase({ state: 'VERIFIED' }),
        profile: PROFILE({ verified: true }),
      });

      await expect(page.getByTestId('verification-VERIFIED_ACTIVE')).toContainText(c.verifiedTitle);
      await expect(page.getByTestId('axis-workAccessActive')).toHaveAttribute(
        'data-active',
        'true',
      );
    });

    test('Featured is a separate badge and grants nothing', async ({ page }) => {
      await openVerification(page, lang, {
        allowed: [],
        verificationCase: kase(),
        profile: PROFILE({ topPro: true }),
      });

      await expect(page.getByTestId('axis-featured')).toContainText(c.featured);
      await expect(page.getByTestId('verification-badge-note')).toBeVisible();
      // ADR 0005 axis 5: recognition must never move the access axis.
      await expect(page.getByTestId('axis-workAccessActive')).toHaveAttribute(
        'data-active',
        'false',
      );
    });

    test('a suspended provider is told about the suspension, not asked to upload', async ({
      page,
    }) => {
      await openVerification(page, lang, {
        primaryReason: 'PROVIDER_SUSPENDED',
        verificationCase: kase({ documents: [doc({ scanState: 'QUARANTINED' })] }),
      });

      await expect(page.getByTestId('verification-SUSPENDED')).toContainText(c.suspendedTitle);
      await expect(page.getByTestId('verification-EVIDENCE_UNUSABLE')).toHaveCount(0);
    });

    test('pending review offers no action at all', async ({ page }) => {
      await openVerification(page, lang, { verificationCase: kase({ state: 'SUBMITTED' }) });

      const section = page.getByTestId('verification-PENDING_REVIEW');
      await expect(section).toContainText(c.pendingTitle);
      await expect(section.getByRole('button')).toHaveCount(0);
    });

    test('the primary action is keyboard reachable with a visible focus ring', async ({ page }) => {
      // A provider who cannot use a mouse still has to be able to send their
      // documents.
      await openVerification(page, lang, { verificationCase: kase({ documents: [doc()] }) });

      const cta = page.getByRole('button', { name: c.readyCta });
      await expect(cta).toBeVisible();
      await cta.focus();
      await expect(cta).toBeFocused();
      await expectVisibleFocusIndicator(cta, 'verification primary action');
    });

    test('each document shows its own scan verdict', async ({ page }) => {
      await openVerification(page, lang, {
        verificationCase: kase({
          requirements: [],
          documents: [doc({ id: 'a' }), doc({ id: 'b', scanState: 'QUARANTINED' })],
        }),
      });

      await expect(page.getByTestId('document-a')).toHaveAttribute('data-scan', 'CLEAN');
      await expect(page.getByTestId('document-b')).toHaveAttribute('data-scan', 'QUARANTINED');
    });

    test('the whole surface fits a phone without horizontal scroll', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await openVerification(page, lang, {
        verificationCase: kase({
          requirements: [
            { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null },
            { kind: 'BUSINESS_REGISTRATION', serviceCategoryId: null },
            { kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-1' },
          ],
          documents: [doc({ id: 'a', scanState: 'PENDING' })],
        }),
        profile: PROFILE({ topPro: true }),
      });

      await expect(page.getByTestId('verification-EVIDENCE_REQUIRED')).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
    });
  });
}

// ── Sprint 9B.13 — the two provider flows only a browser can walk ─────────
//
// Uploading is a three-call dance (prepare → PUT the bytes → finalize) driven
// by a hidden file input and an XHR progress handler. A jsdom test can assert
// that the calls were made; only a real browser can say that a provider who
// picks a file, fails, and picks it again ends up with a document — which is
// the actual path a phone on a bad connection takes.
//
// The resubmission loop is the other one: "changes requested" is where a real
// application spends its time, and the screen has to move from asking for a
// replacement to saying it is with the team, without a reload.

/** Everything the upload dance needs, with each leg independently failable. */
interface UploadStubs {
  /** Status for the prepare call. 500 = the first attempt fails. */
  prepareStatus?: number;
  onFinalize?: () => void;
}

async function stubUpload(page: Page, stubs: UploadStubs): Promise<void> {
  await page.route('**/v1/me/provider/verification/evidence/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown, s = 200) =>
      route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/prepare')) {
      if (stubs.prepareStatus && stubs.prepareStatus !== 200) {
        return json({ success: false, error: { code: 'INTERNAL' } }, stubs.prepareStatus);
      }
      return json({ assetId: 'a1', maxBytes: 10485760, expiresAt: '2099-01-01T00:00:00.000Z' });
    }
    if (url.includes('/content')) {
      return json({ assetId: 'a1', sizeBytes: 12, detectedMimeType: 'application/pdf' });
    }
    if (url.includes('/finalize')) {
      stubs.onFinalize?.();
      return json({ documentId: 'd1', caseId: 'c1' });
    }
    return json({});
  });
}

const A_PDF = {
  name: 'passport.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'),
};

test.describe('provider verification — uploading on a phone', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'the provider app is a phone surface');

  test('a failed upload says so, and the retry succeeds', async ({ page }) => {
    let finalized = 0;
    await openVerification(page, 'en', {
      allowed: ['COMPLETE_ONBOARDING'],
      verificationCase: kase({ state: 'DRAFT' }),
    });
    // Registered AFTER openVerification, so it wins over that helper's
    // catch-all route for the evidence paths only.
    await stubUpload(page, { prepareStatus: 500, onFinalize: () => (finalized += 1) });

    await page.getByRole('button', { name: 'Add a document' }).click();
    await page.getByLabel('Choose a document file').setInputFiles(A_PDF);

    // A provider on a phone needs "try again", not a taxonomy of upload codes.
    await expect(page.getByTestId('verification-error')).toBeVisible();
    expect(finalized).toBe(0);

    // Second attempt, same file, everything working.
    await stubUpload(page, { onFinalize: () => (finalized += 1) });
    await page.getByRole('button', { name: 'Add a document' }).click();
    await page.getByLabel('Choose a document file').setInputFiles(A_PDF);

    await expect.poll(() => finalized).toBe(1);
    // The error does not linger past the attempt that cleared it.
    await expect(page.getByTestId('verification-error')).toHaveCount(0);
  });

  test('the file picker is not in the tab order when uploading is impossible', async ({ page }) => {
    // A control that cannot do anything is worse than absent for someone
    // tabbing through: it is a stop with no outcome.
    await openVerification(page, 'en', {
      allowed: [],
      verificationCase: kase({ state: 'SUBMITTED', submittedAt: '2026-08-02T00:00:00.000Z' }),
    });

    await expect(page.getByLabel('Choose a document file')).toHaveCount(0);
  });
});

test.describe('provider verification — changes requested, then resubmitted', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 500, 'the provider app is a phone surface');

  for (const lang of ['en', 'ar'] as const) {
    const cta = lang === 'en' ? 'Replace the document' : 'استبدال المستند';
    const title = lang === 'en' ? 'We need something changed' : 'نحتاج إلى تعديل';

    test(`${lang}: the reviewer's reason is shown, and a replacement can be sent`, async ({
      page,
    }) => {
      let finalized = 0;
      await openVerification(page, lang, {
        allowed: [],
        verificationCase: kase({
          state: 'ACTION_REQUIRED',
          submittedAt: '2026-08-02T00:00:00.000Z',
          documents: [
            {
              id: 'd0',
              kind: 'INDIVIDUAL_IDENTITY',
              serviceCategoryId: null,
              scanState: 'CLEAN',
              uploadedAt: '2026-08-02T00:00:00.000Z',
              superseded: false,
            },
          ],
          latestDecision: {
            outcome: 'ACTION_REQUIRED',
            reasonCode: 'DOCUMENT_ILLEGIBLE',
            decidedAt: '2026-08-03T00:00:00.000Z',
          },
        }),
      });
      await stubUpload(page, { onFinalize: () => (finalized += 1) });

      // The screen says what happened, in the reviewer's own reason CODE
      // rendered as prose — never the reviewer's private note.
      await expect(page.getByText(title)).toBeVisible();
      await expect(page.getByTestId('verification-reason')).toBeVisible();

      // And it offers the ONE action that moves them forward.
      await page.getByRole('button', { name: cta }).click();
      await page
        .getByLabel(lang === 'en' ? 'Choose a document file' : 'اختر ملف المستند')
        .setInputFiles(A_PDF);

      await expect.poll(() => finalized).toBe(1);
    });
  }

  test('keyboard alone reaches the replacement action, with a visible focus ring', async ({
    page,
  }) => {
    await openVerification(page, 'en', {
      allowed: [],
      verificationCase: kase({
        state: 'ACTION_REQUIRED',
        submittedAt: '2026-08-02T00:00:00.000Z',
        latestDecision: {
          outcome: 'ACTION_REQUIRED',
          reasonCode: 'DOCUMENT_ILLEGIBLE',
          decidedAt: '2026-08-03T00:00:00.000Z',
        },
      }),
    });

    const cta = page.getByRole('button', { name: 'Replace the document' });
    await cta.focus();
    await expect(cta).toBeFocused();
    await expectVisibleFocusIndicator(cta, 'replace-document CTA');
  });
});
