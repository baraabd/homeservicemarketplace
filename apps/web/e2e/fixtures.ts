import { expect, type Locator, type Page } from '@playwright/test';

// Phase 12 — shared fixtures for the real-browser suite.
//
// Two things live here:
//   1. API stubbing, so UI-state scenarios are deterministic. The brief allows
//      UI-mocked tests for visual state coverage; the authorization behaviour
//      itself is proved against the real API by the runtime harness
//      (scripts/runtime/verify-sprint01-security.cjs).
//   2. Geometry assertions, which are the reason this suite exists at all — a
//      DOM shim reports whatever it is told, so overflow, clipping, and focus
//      visibility can only be checked in a real layout engine.

export const LANG_STORAGE_KEY = 'hsm.lang';

// ─── API stubbing ────────────────────────────────────────────────────────────

export interface StubOptions {
  /** null → unauthenticated (the API answers 401 on /auth/me). */
  me?: Record<string, unknown> | null;
  users?: unknown[];
  providers?: unknown[];
  /** Extra exact-path → JSON body overrides, matched by `url.includes`. */
  extra?: Record<string, unknown>;
}

const ADMIN_ME = {
  id: 'admin-1',
  email: 'operator@example.com',
  firstName: 'Ada',
  lastName: 'Operator',
  status: 'ACTIVE',
  emailVerifiedAt: '2026-08-01T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer', 'admin'],
};

// A row per axis-combination the dashboard must be able to render distinctly.
// The point of the fixture is that account status, roles, and admin-access
// request status VARY INDEPENDENTLY across these rows — if the UI ever
// collapses them, one of these rows renders wrongly.
export const ADMIN_USER_ROWS = [
  {
    id: 'u-active-customer',
    email: 'customer@example.com',
    firstName: 'Cara',
    lastName: 'Customer',
    status: 'ACTIVE',
    isActive: true,
    emailVerifiedAt: '2026-08-01T00:00:00.000Z',
    mfaEnabled: false,
    roles: ['customer'],
    adminAccessRequestStatus: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    // ACTIVE account, ordinary roles, but a PENDING admin request. This is the
    // row that used to be mis-described as "Admin active".
    id: 'u-active-pending-admin',
    email: 'hopeful@example.com',
    firstName: 'Hope',
    lastName: 'Ful',
    status: 'ACTIVE',
    isActive: true,
    emailVerifiedAt: '2026-08-02T00:00:00.000Z',
    mfaEnabled: false,
    roles: ['customer'],
    adminAccessRequestStatus: 'PENDING',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'u-suspended-provider',
    email: 'suspended@example.com',
    firstName: 'Sam',
    lastName: 'Suspended',
    status: 'SUSPENDED',
    isActive: false,
    emailVerifiedAt: '2026-08-03T00:00:00.000Z',
    mfaEnabled: false,
    roles: ['customer', 'provider'],
    adminAccessRequestStatus: 'REJECTED',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  },
  {
    id: 'u-real-admin',
    email: 'operator@example.com',
    firstName: 'Ada',
    lastName: 'Operator',
    status: 'ACTIVE',
    isActive: true,
    emailVerifiedAt: '2026-08-04T00:00:00.000Z',
    mfaEnabled: false,
    roles: ['customer', 'admin'],
    adminAccessRequestStatus: 'APPROVED',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  },
  {
    id: 'u-locked',
    email: 'locked@example.com',
    firstName: 'Lee',
    lastName: 'Locked',
    status: 'LOCKED',
    isActive: false,
    emailVerifiedAt: null,
    mfaEnabled: false,
    roles: ['customer'],
    adminAccessRequestStatus: 'CANCELLED',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  },
];

export const PROVIDER_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export function adminProviderRows() {
  return PROVIDER_STATUSES.map((status, i) => ({
    id: `pp-${status.toLowerCase()}`,
    status,
    userId: `u-${i}`,
    email: `${status.toLowerCase()}@example.com`,
    displayName: `${status} Provider`,
    initials: 'PP',
    ratingAvg: 4.5,
    reviewCount: 10,
    completedJobs: 5,
    verified: status === 'ACTIVE',
    topPro: false,
    serviceAreaCity: 'Gothenburg',
    serviceAreaCountry: 'Sweden',
    reviewNotes: null,
    submittedForReviewAt: status === 'DRAFT' ? null : '2026-08-06T00:00:00.000Z',
    reviewedAt: status === 'ACTIVE' || status === 'REJECTED' ? '2026-08-07T00:00:00.000Z' : null,
    rejectionReason: status === 'REJECTED' ? 'Service area outside current coverage.' : null,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
  }));
}

/**
 * Intercepts every `/v1/**` call so a scenario renders from a known state.
 * Unmatched calls answer with an empty collection rather than failing, so a
 * new query added to a screen cannot silently turn a scenario red for an
 * unrelated reason.
 */
export async function stubApi(page: Page, options: StubOptions = {}): Promise<void> {
  const {
    me = null,
    users = ADMIN_USER_ROWS,
    providers = adminProviderRows(),
    extra = {},
  } = options;

  await page.route('**/v1/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    for (const [fragment, body] of Object.entries(extra)) {
      if (url.includes(fragment)) return json(body);
    }

    if (url.includes('/auth/me')) {
      return me
        ? json(me)
        : json({ success: false, error: { code: 'AUTH_INVALID_CREDENTIALS' } }, 401);
    }
    if (url.includes('/admin/users')) {
      // The detail endpoint returns ONE user, the list endpoint returns a
      // collection. Answering both with a collection left the detail drawer
      // stuck on its loading state, so its action controls never rendered.
      const detail = new RegExp('\\/admin\\/users\\/([^/?]+)').exec(url);
      if (detail) {
        const found = (users as Array<{ id: string }>).find((u) => u.id === detail[1]);
        return found ? json(found) : json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
      }
      return json({ items: users, nextCursor: null });
    }
    if (url.includes('/admin/roles')) {
      return json({
        items: [
          { id: 'r-customer', name: 'customer', description: null },
          { id: 'r-provider', name: 'provider', description: null },
          { id: 'r-admin', name: 'admin', description: 'Platform admin' },
        ],
      });
    }
    if (url.includes('/admin/providers')) return json({ items: providers, nextCursor: null });
    if (url.includes('/admin/access-requests')) return json({ items: [], nextCursor: null });
    if (url.includes('/notifications/unread-count')) return json({ count: 0 });

    // The dashboard overview reads nested aggregates and would throw on a
    // bare `{ items: [] }`. Shapes mirror the contracts exactly; the numbers
    // are arbitrary because these scenarios assert LAYOUT, not arithmetic.
    if (url.includes('/admin/analytics/overview')) return json(ANALYTICS_OVERVIEW);
    if (url.includes('/admin/analytics/revenue')) {
      return json({
        range: RANGE,
        currency: 'SAR',
        platformFeeRateBps: 1000,
        buckets: [
          {
            date: '2026-08-01',
            grossEarnings: 100,
            platformFees: 10,
            netProviderEarnings: 90,
            completedBookings: 1,
          },
          {
            date: '2026-08-02',
            grossEarnings: 250,
            platformFees: 25,
            netProviderEarnings: 225,
            completedBookings: 2,
          },
        ],
      });
    }
    if (url.includes('/admin/analytics')) return json(ANALYTICS_OVERVIEW);
    if (url.includes('/admin/financials/summary')) return json(FINANCIALS_SUMMARY);

    return json({ items: [], nextCursor: null });
  });
}

const RANGE = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' };

const ANALYTICS_OVERVIEW = {
  range: RANGE,
  counts: {
    users: 42,
    providers: 8,
    requests: 17,
    bookingsCompleted: 5,
    bookingsCancelled: 1,
    disputesOpen: 0,
  },
  revenue: {
    grossWithinRange: 350,
    platformFeesWithinRange: 35,
    netProviderEarningsWithinRange: 315,
    grossLifetime: 1200,
  },
  currency: 'SAR',
  platformFeeRateBps: 1000,
  generatedAt: RANGE.to,
};

const FINANCIALS_SUMMARY = {
  totalRevenue: 1200,
  totalPlatformFees: 120,
  totalProviderEarnings: 1080,
  totalRefunds: 0,
  pendingBalance: 300,
  completedBookingsCount: 5,
  currency: 'SAR',
  platformFeeRateBps: 1000,
  generatedAt: RANGE.to,
};

export function signedInAdmin(): Record<string, unknown> {
  return { ...ADMIN_ME };
}

// ─── language ────────────────────────────────────────────────────────────────

/** The visible control a user would actually click. Never a direct state poke. */
export function langToggle(page: Page): Locator {
  return page.getByRole('button', { name: 'Switch language' });
}

export async function htmlLangDir(page: Page): Promise<{ lang: string; dir: string }> {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
  }));
}

/**
 * Seed the persisted language BEFORE the app boots, so a scenario can start in
 * Arabic without clicking through. Uses the same key the app writes, which is
 * itself part of what the persistence test verifies.
 */
export async function seedLanguage(page: Page, lang: 'en' | 'ar'): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [LANG_STORAGE_KEY, lang],
  );
}

// ─── geometry ────────────────────────────────────────────────────────────────

/**
 * The PAGE must never scroll sideways. Checked against the documentElement
 * rather than a wrapper, because horizontal overflow is what the user actually
 * experiences — a wrapper that fits while the document does not is still broken.
 *
 * A 1px allowance absorbs sub-pixel rounding in the layout engine; anything
 * beyond that is a real overflow.
 */
export async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    overflow.scrollWidth - overflow.clientWidth,
    `page scrolls horizontally by ${overflow.scrollWidth - overflow.clientWidth}px ` +
      `(scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(1);
}

/** Every matched element must sit inside its own offsetParent's box. */
export async function expectContainedInParent(locator: Locator, label: string): Promise<void> {
  const count = await locator.count();
  expect(count, `${label}: expected at least one element to check`).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const el = locator.nth(i);
    const overflowing = await el.evaluate((node) => {
      const parent = (node as HTMLElement).parentElement;
      if (!parent) return null;
      const a = (node as HTMLElement).getBoundingClientRect();
      const b = parent.getBoundingClientRect();
      // Only report escapes the user can see; a 1px bleed is rounding.
      return {
        left: b.left - a.left,
        right: a.right - b.right,
        text: (node.textContent ?? '').trim().slice(0, 40),
      };
    });
    if (!overflowing) continue;
    expect(
      Math.max(overflowing.left, overflowing.right),
      `${label}: "${overflowing.text}" escapes its container ` +
        `(left ${overflowing.left.toFixed(1)}px, right ${overflowing.right.toFixed(1)}px)`,
    ).toBeLessThanOrEqual(1);
  }
}

/** Rendered, non-zero-sized, and not clipped to nothing. */
export async function expectLegible(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label}: not visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label}: has no layout box`).not.toBeNull();
  expect(box!.width, `${label}: zero width`).toBeGreaterThan(0);
  expect(box!.height, `${label}: zero height`).toBeGreaterThan(0);

  // Text that is present but scrolled out of its own box reads as truncated to
  // the user even though it is technically "visible".
  const clipped = await locator.evaluate((node) => {
    const el = node as HTMLElement;
    return {
      hiddenX: el.scrollWidth - el.clientWidth,
      hiddenY: el.scrollHeight - el.clientHeight,
      overflow: getComputedStyle(el).overflow,
    };
  });
  if (clipped.overflow === 'hidden') {
    expect(clipped.hiddenY, `${label}: text is vertically clipped`).toBeLessThanOrEqual(1);
  }
}

/**
 * Keyboard focus must remain perceivable. A control that takes focus with no
 * visible indicator is unusable for anyone not using a mouse.
 */
export async function expectVisibleFocusIndicator(locator: Locator, label: string): Promise<void> {
  await locator.focus();
  const style = await locator.evaluate((node) => {
    const s = getComputedStyle(node as HTMLElement);
    return {
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      boxShadow: s.boxShadow,
      isFocused: document.activeElement === node,
    };
  });
  expect(style.isFocused, `${label}: did not take focus`).toBe(true);
  const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  const hasRing = style.boxShadow !== 'none' && style.boxShadow.length > 0;
  expect(
    hasOutline || hasRing,
    `${label}: focused with no visible indicator (outline ${style.outlineStyle} ` +
      `${style.outlineWidth}, box-shadow ${style.boxShadow})`,
  ).toBe(true);
}
