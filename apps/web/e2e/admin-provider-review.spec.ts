import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type {
  AdminPortfolioListResponse,
  AdminProviderReview,
  AdminProviderSummary,
  AdminProviderReviewHistoryResponse,
  ApproveAdminProviderReviewRequest,
  ProviderReviewSnapshot,
  RequestAdminProviderReviewChangesRequest,
} from '@homeservicemarketplace/contracts';
import {
  expectNoHorizontalPageOverflow,
  htmlLangDir,
  seedLanguage,
  signedInAdmin,
} from './fixtures';

// UI-state fixtures only. These tests exercise the real Admin route and browser
// layout; they do not prove authorization or persistence. The matching real
// PostgreSQL HTTP suite owns those claims. Screenshots are attached to the CI
// report for human inspection, never labelled as inspected by these tests.
const PROFILE = 'review-provider';
const ROOT = `/v1/admin/providers/${PROFILE}`;
const STAMP = '2026-09-14T09:30:00.000Z';
const SECTION_NAMES = {
  en: [
    'Basics & identity',
    'Services & experience',
    'Work area',
    'Working hours',
    'Profile & portfolio',
    'Submission & consent',
  ],
  ar: [
    'البيانات والهوية',
    'الخدمات والخبرة',
    'منطقة العمل',
    'أوقات العمل',
    'الملف ومعرض الأعمال',
    'الطلب والموافقة',
  ],
} as const;
const NOTE = 'Internal note retained while resolving the conflict.';
const INSTRUCTION = 'Please confirm the district and service radius before resubmitting.';
const SNAPSHOT: ProviderReviewSnapshot = {
  schemaVersion: 1,
  capturedAt: STAMP,
  providerProfileId: PROFILE,
  profile: {
    displayName: 'أحمد الخطيب · Ahmad Al Khatib',
    profileImageUrl: null,
    providerType: 'INDIVIDUAL',
    legalBusinessName: null,
    phoneNumber: '+963900000111',
    phoneVerifiedAt: null,
    email: 'ahmad@example.test',
    emailVerified: true,
    headline: 'Residential electrical maintenance',
    bio: 'Experienced electrician for residential repairs, careful safety inspections and reliable appointments.',
    additionalInformation:
      'ألتزم بتوضيح خطوات العمل والتكلفة قبل البدء وتنظيف المكان بعد الانتهاء.',
    yearsOfExperience: 8,
    professionSince: '2018-01-01T00:00:00.000Z',
    transportMode: null,
    transportModes: ['CAR'],
  },
  services: {
    primaryGroupIds: ['home-maintenance'],
    primarySpecialtyId: 'electrical',
    equipmentCodes: ['MULTIMETER'],
    specialties: [
      {
        id: 'electrical',
        slug: 'electrical',
        labelEn: 'Electrical maintenance',
        labelAr: 'صيانة التمديدات الكهربائية والأجهزة المنزلية',
        state: 'APPROVED',
        applicationId: 'application-1',
        requestedAt: STAMP,
        reviewedAt: STAMP,
      },
    ],
  },
  workArea: {
    country: 'سوريا',
    countryCode: 'SY',
    city: 'دمشق',
    lat: 33.5138,
    lng: 36.2765,
    radiusKm: 20,
    workshopAddressLine: 'المزة، شارع الجلاء، بجانب مركز الخدمات',
    workshopLat: null,
    workshopLng: null,
    areas: [
      {
        cityId: 'damascus',
        districtId: 'mezzeh',
        neighborhoodId: null,
        labelEn: 'Mezzeh',
        labelAr: 'حي المزة والمناطق المحيطة',
      },
    ],
  },
  availability: {
    timezone: 'Asia/Damascus',
    intervals: [
      { dayOfWeek: 0, startMinute: 540, endMinute: 1020, timezone: 'Asia/Damascus' },
      { dayOfWeek: 2, startMinute: 600, endMinute: 1200, timezone: 'Asia/Damascus' },
    ],
  },
  consent: { acceptedVersion: 'terms-2026-09', acceptedAt: STAMP },
  portfolio: [
    {
      id: 'portfolio-1',
      mediaAssetId: 'portfolio-asset-1',
      revision: 3,
      title: 'Kitchen lighting installation',
      description: 'تركيب إنارة المطبخ مع تنظيم التوصيلات الكهربائية.',
      serviceCategoryId: 'electrical',
      position: 0,
      publicationRightAckAt: STAMP,
      publicationRightAckVersion: 'publication-2026-09',
      moderationState: 'PENDING',
    },
  ],
};
function fixture(): AdminProviderReview {
  return {
    provider: {
      id: PROFILE,
      userId: 'provider-owner',
      displayName: SNAPSHOT.profile.displayName,
      email: SNAPSHOT.profile.email,
      accountStatus: 'ACTIVE',
      providerStatus: 'PENDING_REVIEW',
      onboardingState: 'DOCUMENTS_REQUIRED',
      verificationState: 'PENDING',
      standingState: 'GOOD',
    },
    revision: 'a'.repeat(64),
    submission: {
      id: 'submission-1',
      submittedAt: STAMP,
      policyVersion: 'onboarding-v1',
      decision: null,
      decidedAt: null,
      snapshot: structuredClone(SNAPSHOT),
      feedback: null,
    },
    current: structuredClone(SNAPSHOT),
    verification: {
      id: 'case-1',
      providerProfileId: PROFILE,
      state: 'SUBMITTED',
      policyVersion: 'identity-sy-v1',
      country: 'SY',
      providerType: 'INDIVIDUAL',
      submittedAt: STAMP,
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
          id: 'document-1',
          kind: 'INDIVIDUAL_IDENTITY',
          serviceCategoryId: null,
          serviceCategoryLabelEn: null,
          serviceCategoryLabelAr: null,
          detectedMimeType: 'application/pdf',
          sizeBytes: IDENTITY_PDF.byteLength,
          displayFilename: 'Identity document.pdf',
          scanState: 'CLEAN',
          viewable: true,
          uploadedAt: STAMP,
          evidenceDeletedAt: null,
          supersededAt: null,
        },
      ],
      decisions: [],
      availableActions: [],
      blockedReason: null,
      workAccess: null,
    },
    categoryApplications: [],
    capabilities: {
      allowed: ['VIEW_OWN_PROFILE', 'MANAGE_VERIFICATION'],
      capabilities: ['VIEW_MARKETPLACE', 'SUBMIT_BID', 'MANAGE_BOOKINGS', 'VIEW_EARNINGS'].map(
        (capability) => ({
          capability: capability as
            | 'VIEW_MARKETPLACE'
            | 'SUBMIT_BID'
            | 'MANAGE_BOOKINGS'
            | 'VIEW_EARNINGS',
          allowed: false,
          reason: 'AWAITING_REVIEW',
        }),
      ),
      nextActions: ['WAIT_FOR_REVIEW'],
      primaryReason: 'AWAITING_REVIEW',
    },
    canWork: false,
    availableActions: ['approve', 'requestChanges'],
    blockers: [],
    permissions: { canDecide: true, canViewEvidence: true, canModeratePortfolio: true },
  };
}
const PORTFOLIO: AdminPortfolioListResponse = {
  items: [
    {
      id: 'portfolio-1',
      title: 'Kitchen lighting installation',
      description: 'تركيب إنارة المطبخ',
      media: { url: `${ROOT}/portfolio/portfolio-1/media`, contentType: 'image/png' },
      serviceCategoryId: 'electrical',
      position: 0,
      moderationState: 'PENDING',
      moderationReason: null,
      revision: 3,
      createdAt: STAMP,
      updatedAt: STAMP,
      moderatedAt: null,
      reviewBlockedReason: null,
      availableActions: ['APPROVE', 'REJECT'],
      history: [],
    },
  ],
};
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII=',
  'base64',
);
// A valid one-page PDF exercises the sandboxed renderer as well as download.
// These are synthetic test bytes, never user identity evidence.
function identityPdfFixture(): Buffer {
  const stream = 'BT /F1 16 Tf 24 100 Td (Synthetic identity fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(content);
}
const IDENTITY_PDF = identityPdfFixture();

function summaryFixture(review: AdminProviderReview): AdminProviderSummary {
  const accepted = review.provider.providerStatus === 'ACTIVE';
  return {
    id: PROFILE,
    userId: 'provider-owner',
    displayName: review.provider.displayName,
    email: review.provider.email,
    initials: 'AK',
    status: accepted
      ? 'ACTIVE'
      : review.provider.providerStatus === 'REJECTED'
        ? 'REJECTED'
        : 'PENDING_REVIEW',
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: accepted,
    topPro: false,
    serviceAreaCity: 'Damascus',
    serviceAreaCountry: 'SY',
    reviewNotes: null,
    submittedForReviewAt: review.submission?.submittedAt ?? null,
    reviewedAt: review.submission?.decidedAt ?? null,
    createdAt: STAMP,
    updatedAt: STAMP,
    account: { status: 'ACTIVE', isActive: true, deletedAt: null },
    onboardingState: accepted
      ? 'ACCEPTED'
      : review.provider.providerStatus === 'REJECTED'
        ? 'RETURNED'
        : 'DOCUMENTS_REQUIRED',
    verificationState: accepted ? 'VERIFIED' : 'PENDING',
    standingState: 'GOOD',
    verificationCase: accepted
      ? null
      : { id: 'case-1', state: 'SUBMITTED', submittedAt: STAMP, assignedTo: null },
    portfolio: { total: 1, pending: 1, approved: 0, rejected: 0 },
    workAccess: {
      canWork: review.canWork,
      hasLiveGrant: accepted,
      denialReason: accepted ? null : 'AWAITING_REVIEW',
    },
    attentionReasons: accepted
      ? ['PORTFOLIO_REVIEW_REQUIRED']
      : ['APPLICATION_REVIEW_REQUIRED', 'IDENTITY_IN_REVIEW', 'PORTFOLIO_REVIEW_REQUIRED'],
    availableActions: accepted && review.permissions.canDecide ? ['suspend'] : [],
  };
}
function historyFixture(review: AdminProviderReview): AdminProviderReviewHistoryResponse {
  return {
    items: review.submission
      ? [
          {
            id: 'history-submission-1',
            kind: 'SUBMITTED',
            occurredAt: review.submission.submittedAt,
            actor: { id: 'provider-owner', displayName: review.provider.displayName },
            submission: {
              id: review.submission.id,
              submittedAt: review.submission.submittedAt,
              policyVersion: review.submission.policyVersion,
              reviewedRevision: null,
            },
            subject: null,
            contentRevision: null,
            reason: null,
            privateNote: null,
            feedback: null,
          },
        ]
      : [],
    nextCursor: null,
  };
}
interface HarnessOptions {
  review?: AdminProviderReview;
  denied?: boolean;
  conflictOnce?: boolean;
  path?: string;
}
async function open(page: Page, lang: 'en' | 'ar', options: HarnessOptions = {}) {
  let review = options.review ?? fixture();
  let conflict = options.conflictOnce ?? false;
  const decisions: Array<
    ApproveAdminProviderReviewRequest | RequestAdminProviderReviewChangesRequest
  > = [];
  const evidenceReads: string[] = [];
  const portfolioReads: string[] = [];
  const directoryQueries: URLSearchParams[] = [];
  await seedLanguage(page, lang);
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/auth/me')) return json(signedInAdmin());
    if (path === `${ROOT}/review`)
      return options.denied ? json({ error: { code: 'FORBIDDEN' } }, 403) : json(review);
    if (path === ROOT) return json(summaryFixture(review));
    if (path === `${ROOT}/review/history`) return json(historyFixture(review));
    if (path === `${ROOT}/review/approve` || path === `${ROOT}/review/request-changes`) {
      const body = route.request().postDataJSON();
      decisions.push(body);
      if (conflict) {
        conflict = false;
        review = { ...review, revision: 'b'.repeat(64) };
        return json(
          {
            error: {
              code: 'CONFLICT',
              message: 'Review changed',
              details: { reason: 'STALE_REVIEW' },
            },
          },
          409,
        );
      }
      const accepted = path.endsWith('/approve');
      review = {
        ...review,
        revision: 'c'.repeat(64),
        availableActions: [],
        canWork: accepted,
        provider: {
          ...review.provider,
          providerStatus: accepted ? 'ACTIVE' : 'REJECTED',
          onboardingState: accepted ? 'ACCEPTED' : 'RETURNED',
        },
        submission: {
          ...review.submission!,
          decision: accepted ? 'ACCEPTED' : 'RETURNED',
          decidedAt: STAMP,
          feedback: accepted
            ? null
            : {
                requestedAt: STAMP,
                items: body.feedback.map((item: object, index: number) => ({
                  ...item,
                  id: `feedback-${index}`,
                })),
              },
        },
      };
      return json({ changed: true, review });
    }
    if (path === `${ROOT}/portfolio`) return json(PORTFOLIO);
    if (path === `${ROOT}/portfolio/portfolio-1/media`) {
      portfolioReads.push(path);
      return route.fulfill({
        contentType: 'image/png',
        body: PNG,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (path === '/v1/verification/documents/document-1/content') {
      evidenceReads.push(path);
      return route.fulfill({
        body: IDENTITY_PDF,
        contentType: 'application/pdf',
        headers: {
          'Content-Disposition': 'attachment; filename="Identity document.pdf"',
          'Access-Control-Expose-Headers': 'Content-Disposition',
          'Cache-Control': 'private, no-store',
        },
      });
    }
    if (path === '/v1/admin/providers') {
      directoryQueries.push(url.searchParams);
      const next = url.searchParams.get('cursor') === 'page-two';
      return json({
        items: [
          {
            ...summaryFixture(review),
            id: next ? PROFILE : 'first-provider',
            displayName: next ? SNAPSHOT.profile.displayName : 'First page provider',
            email: 'provider@example.test',
            initials: 'AP',
            status: 'PENDING_REVIEW',
            serviceAreaCity: 'Damascus',
            serviceAreaCountry: 'SY',
            submittedForReviewAt: STAMP,
          },
        ],
        total: 2,
        counts: { all: 2, pendingReview: 2, active: 0, returned: 0, suspended: 0, draft: 0 },
        nextCursor: next ? null : 'page-two',
      });
    }
    if (path.includes('/notifications/unread-count')) return json({ count: 0 });
    return json({ items: [], nextCursor: null });
  });
  await page.goto(options.path ?? `/admin/providers/${PROFILE}`);
  if (!options.denied && !options.path)
    await expect(page.getByTestId('admin-provider-review-workspace')).toBeVisible();
  return { decisions, evidenceReads, portfolioReads, directoryQueries };
}

for (const lang of ['en', 'ar'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`six-task dossier is legible and accessible (${lang}, ${theme}, UI fixture)`, async ({
      page,
    }, testInfo) => {
      await open(page, lang);
      if (theme === 'dark')
        await page
          .getByRole('button', { name: lang === 'ar' ? 'الوضع الداكن' : 'Dark theme', exact: true })
          .click();
      expect((await htmlLangDir(page)).dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
      for (const name of SECTION_NAMES[lang]) {
        const section = page.getByRole('region', { name, exact: true });
        await expect(section).toBeVisible();
        await expect(section.getByRole('heading', { level: 2 })).toBeVisible();
      }
      await expect(page.getByTestId('review-approve')).toBeEnabled();
      await expectNoHorizontalPageOverflow(page);
      const audit = await new AxeBuilder({ page })
        .include('[data-testid="admin-provider-review-workspace"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      await testInfo.attach('axe-admin-dossier.json', {
        body: JSON.stringify(audit, null, 2),
        contentType: 'application/json',
      });
      expect(audit.violations).toEqual([]);
      const screenshot = testInfo.outputPath(`admin-dossier-${lang}-${theme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
      await testInfo.attach(`Admin dossier ${lang} ${theme} (API fixture)`, {
        path: screenshot,
        contentType: 'image/png',
      });
    });
  }

  test(`approval requires explicit accessible confirmation (${lang})`, async ({ page }) => {
    const state = await open(page, lang);
    const opener = page.getByTestId('review-approve');
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(
      lang === 'ar' ? 'هل توافق على هذا الطلب؟' : 'Approve this application?',
    );
    expect(state.decisions).toHaveLength(0);
    // Keyboard containment in a real browser, including Shift+Tab wrap.
    await dialog.getByTestId('review-confirm').focus();
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByTestId('review-approval-ack').check();
    await page.getByTestId('review-confirm').click();
    await expect.poll(() => state.decisions.length).toBe(1);
    expect(state.decisions[0]).toMatchObject({
      submissionId: 'submission-1',
      expectedRevision: 'a'.repeat(64),
    });
    expect(state.decisions[0].idempotencyKey.length).toBeGreaterThan(7);
  });
}

test('a 409 keeps correction instructions and private notes until a refreshed decision is confirmed', async ({
  page,
}) => {
  const state = await open(page, 'en', { conflictOnce: true });
  await page.getByTestId('review-private-note').fill(NOTE);
  await page.getByTestId('review-request-changes').click();
  await page.getByTestId('review-correction-task-0').selectOption('WORK_AREA');
  await page.getByTestId('review-correction-message-0').fill(INSTRUCTION);
  await page.getByTestId('review-confirm').click();
  await expect(page.getByTestId('review-conflict')).toBeVisible();
  expect(state.decisions[0]).toMatchObject({
    expectedRevision: 'a'.repeat(64),
    note: NOTE,
    feedback: [expect.objectContaining({ taskId: 'WORK_AREA', providerMessage: INSTRUCTION })],
  });
  await expect(page.getByTestId('review-correction-message-0')).toHaveValue(INSTRUCTION);
  await page.getByRole('dialog').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByTestId('review-private-note')).toHaveValue(NOTE);
  await page.getByTestId('review-request-changes').click();
  await expect(page.getByTestId('review-correction-message-0')).toHaveValue(INSTRUCTION);
  await page.getByTestId('review-confirm').click();
  await expect.poll(() => state.decisions.length).toBe(2);
  expect(state.decisions[1]).toMatchObject({ expectedRevision: 'b'.repeat(64), note: NOTE });
  expect(state.decisions[1].idempotencyKey).not.toBe(state.decisions[0].idempotencyKey);
});

test('restricted evidence and pending portfolio bytes are fetched only after an explicit action', async ({
  page,
}) => {
  const state = await open(page, 'en');
  await expect(page.getByTestId('review-portfolio-portfolio-1')).toBeVisible();
  expect(state.evidenceReads).toEqual([]);
  expect(state.portfolioReads).toEqual([]);
  await expect(page.locator('img[src*="verification/"]')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByTestId('review-evidence-download-document-1').click();
  expect((await download).suggestedFilename()).toBe('Identity document.pdf');
  expect(state.evidenceReads).toEqual(['/v1/verification/documents/document-1/content']);
  await page.getByTestId('review-evidence-document-1').click();
  const identityDialog = page.getByRole('dialog');
  await expect(identityDialog.getByTestId('identity-evidence-pdf')).toBeVisible();
  await expect(identityDialog.getByRole('region')).toHaveAttribute('aria-busy', 'false');
  await identityDialog.getByTestId('identity-evidence-zoom-in').click();
  await expect(identityDialog.getByRole('group')).toContainText('125%');
  await expect.poll(() => state.evidenceReads.length).toBe(2);
  await page.keyboard.press('Escape');
  await expect(identityDialog).not.toBeVisible();
  await expect(page.getByTestId('review-evidence-document-1')).toBeFocused();
  await page.getByTestId('review-portfolio-open-portfolio-1').click();
  await expect.poll(() => state.portfolioReads.length).toBe(1);
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
});

test('read-only reviewers can inspect metadata without decision or evidence access', async ({
  page,
}) => {
  const review = fixture();
  review.permissions = { canDecide: false, canViewEvidence: false, canModeratePortfolio: false };
  review.availableActions = [];
  review.blockers = [{ code: 'PERMISSION_REQUIRED' }];
  review.verification!.documents[0]!.viewable = false;
  const state = await open(page, 'en', { review });
  await expect(page.getByTestId('review-evidence-document-1')).toBeDisabled();
  await expect(page.getByTestId('review-approve')).toHaveCount(0);
  await expect(page.getByTestId('review-request-changes')).toHaveCount(0);
  expect(state.decisions).toEqual([]);
  expect(state.evidenceReads).toEqual([]);
});

test('historic missing fields remain distinct from the current profile', async ({ page }) => {
  const review = fixture();
  review.submission!.snapshot = null;
  review.current.profile.displayName = 'Current profile name only';
  review.availableActions = ['requestChanges'];
  review.blockers = [{ code: 'SNAPSHOT_UNAVAILABLE' }];
  await open(page, 'en', { review });
  await expect(
    page.getByRole('region', { name: 'Basics & identity', exact: true }),
  ).not.toContainText('Current profile name only');
  await expect(page.getByTestId('review-approve')).toHaveCount(0);
  await page.getByTestId('review-source-current').click();
  await expect(page.getByRole('region', { name: 'Basics & identity', exact: true })).toContainText(
    'Current profile name only',
  );
});

test('a forbidden dossier exposes neither submitted fields nor controls', async ({ page }) => {
  await open(page, 'en', { denied: true });
  await expect(
    page.getByText('You do not have permission to view this provider review.'),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Basics & identity', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('review-approve')).toHaveCount(0);
});

test('directory pagination, filters and the return route survive opening a provider', async ({
  page,
}) => {
  const state = await open(page, 'en', {
    path: '/admin/providers?status=PENDING_REVIEW&query=Ahmad',
  });
  const directory = page.getByTestId('admin-provider-directory');
  await expect(directory).toBeVisible();
  await directory.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/cursor=page-two/);
  await directory
    .getByRole('link', { name: `Open profile ${SNAPSHOT.profile.displayName}` })
    .click();
  await expect(page.getByTestId('admin-provider-review-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Back to providers', exact: true }).click();
  await expect(directory).toBeVisible();
  const restored = new URL(page.url());
  expect(restored.searchParams.get('status')).toBe('PENDING_REVIEW');
  expect(restored.searchParams.get('query')).toBe('Ahmad');
  expect(restored.searchParams.get('cursor')).toBe('page-two');
  expect(
    state.directoryQueries.some(
      (query) => query.get('cursor') === 'page-two' && query.get('query') === 'Ahmad',
    ),
  ).toBe(true);
  await expectNoHorizontalPageOverflow(page);
});

test('Arabic dossier adapts to narrow phones and small desktop without losing actions', async ({
  page,
}, testInfo) => {
  await open(page, 'ar');
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalPageOverflow(page);
    const action = page.getByTestId('review-approve');
    await action.scrollIntoViewIfNeeded();
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    // Capture the normal sticky-header position after verifying the action.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`admin-ar-width-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});
