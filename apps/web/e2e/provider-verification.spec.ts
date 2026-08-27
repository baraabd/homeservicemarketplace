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
