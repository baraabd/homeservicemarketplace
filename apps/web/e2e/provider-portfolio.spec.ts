import { expect, test, type Page } from '@playwright/test';

import {
  expectContainedInParent,
  expectLegible,
  expectNoHorizontalPageOverflow,
  htmlLangDir,
  seedLanguage,
} from './fixtures';

// Sprint 9B.10 — the provider portfolio in a real browser, EN and AR.
//
// What this pins beyond "it renders":
//
//   1. The reorder controls mean the same thing in both directions. "Move
//      earlier" moves an item towards the START of the reading order, which is
//      the RIGHT-hand side in Arabic. A unit test can assert the request body;
//      only a browser can show the glyph actually flipped and the layout
//      actually mirrored.
//
//   2. The gallery does not overflow a phone. It is a grid of images inside a
//      column that already has padding, and grids are where horizontal
//      overflow appears first.
//
//   3. The destructive action is confirmed, in both languages, with real
//      focus and real dialog semantics rather than a window.confirm.

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

const PROFILE = {
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
  },
};

/** A 1×1 transparent GIF, so the grid renders real images without a network
 *  fetch that Playwright would have to wait on. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function portfolioItem(id: string, title: string, position: number, state = 'APPROVED') {
  return {
    id,
    media: { url: PIXEL, contentType: 'image/jpeg' },
    title,
    description: null,
    serviceCategoryId: null,
    position,
    moderationState: state,
    moderationReason: state === 'REJECTED' ? 'FACE_VISIBLE' : null,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

const COPY = {
  en: {
    section: 'Your work',
    empty: 'No photos yet',
    add: 'Add photo',
    earlier: 'Move earlier',
    later: 'Move later',
    remove: 'Remove',
    confirmTitle: 'Remove this photo?',
    keep: 'Keep it',
    pending: 'Being checked',
    rejected: 'Not published',
  },
  ar: {
    section: 'أعمالك',
    empty: 'لا توجد صور بعد',
    add: 'إضافة صورة',
    earlier: 'تقديم',
    later: 'تأخير',
    remove: 'إزالة',
    confirmTitle: 'إزالة هذه الصورة؟',
    keep: 'الاحتفاظ بها',
    pending: 'قيد المراجعة',
    rejected: 'غير منشورة',
  },
} as const;

interface Options {
  items?: ReturnType<typeof portfolioItem>[];
  remainingSlots?: number;
  onReorder?: (ids: string[]) => void;
  onDelete?: (id: string) => void;
}

async function openPortfolio(
  page: Page,
  lang: 'en' | 'ar' = 'en',
  options: Options = {},
): Promise<void> {
  const items = options.items ?? [];
  await seedLanguage(page, lang);
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown, s = 200) =>
      route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.includes('/auth/me')) return json(PROVIDER_ME);
    if (url.includes('/me/provider/portfolio/reorder')) {
      options.onReorder?.(JSON.parse(route.request().postData() ?? '{}').itemIds ?? []);
      return json({ items, remainingSlots: options.remainingSlots ?? 11, maxItems: 12 });
    }
    if (url.includes('/me/provider/portfolio')) {
      if (route.request().method() === 'DELETE') {
        options.onDelete?.(url.split('/').pop() ?? '');
        return route.fulfill({ status: 204, body: '' });
      }
      return json({ items, remainingSlots: options.remainingSlots ?? 11, maxItems: 12 });
    }
    if (url.includes('/me/provider/profile')) return json(PROFILE);
    return json({ items: [], nextCursor: null });
  });
  await page.goto('/provider');

  // The portfolio lives on the profile tab. The bottom-nav label is
  // "Profile" / "ملفي" — matched exactly rather than by a loose regex, so this
  // does not silently start clicking some other control if the nav changes.
  await page.getByRole('button', { name: lang === 'ar' ? 'ملفي' : 'Profile' }).click();
  await expect(page.getByRole('region', { name: COPY[lang].section })).toBeVisible();
}

for (const lang of ['en', 'ar'] as const) {
  const c = COPY[lang];

  test.describe(`provider portfolio (${lang})`, () => {
    test('shows the empty state with a way out of it', async ({ page }) => {
      await openPortfolio(page, lang, { items: [], remainingSlots: 12 });

      await expect(page.getByTestId('portfolio-empty')).toContainText(c.empty);
      // An empty state with no next step is a dead end.
      await expect(page.getByRole('button', { name: c.add })).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
    });

    test('renders the gallery and its moderation states', async ({ page }) => {
      await openPortfolio(page, lang, {
        items: [
          portfolioItem('a', 'Kitchen', 0, 'APPROVED'),
          portfolioItem('b', 'Bathroom', 1, 'PENDING'),
          portfolioItem('c', 'Roof', 2, 'REJECTED'),
        ],
      });

      await expect(page.getByTestId('portfolio-item')).toHaveCount(3);
      await expect(page.getByText(c.pending)).toBeVisible();
      await expect(page.getByText(c.rejected)).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
    });

    test('the document direction matches the language', async ({ page }) => {
      await openPortfolio(page, lang, { items: [portfolioItem('a', 'Kitchen', 0)] });

      const { dir } = await htmlLangDir(page);
      expect(dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
    });

    test('reorder controls are labelled by intent and send the full order', async ({ page }) => {
      const sent: string[][] = [];
      await openPortfolio(page, lang, {
        items: [portfolioItem('a', 'Kitchen', 0), portfolioItem('b', 'Bathroom', 1)],
        onReorder: (ids) => sent.push(ids),
      });

      const earlier = page.getByRole('button', { name: c.earlier });
      await expect(earlier).toHaveCount(2);
      // First item cannot move earlier; second can.
      await expect(earlier.nth(0)).toBeDisabled();
      await expect(earlier.nth(1)).toBeEnabled();

      await earlier.nth(1).click();
      // Identical in both languages: direction changes how it LOOKS, never
      // what it MEANS.
      await expect.poll(() => sent[0]).toEqual(['b', 'a']);
    });

    test('the earlier arrow points towards the start of the reading order', async ({ page }) => {
      await openPortfolio(page, lang, {
        items: [portfolioItem('a', 'Kitchen', 0), portfolioItem('b', 'Bathroom', 1)],
      });

      const glyph = await page.getByRole('button', { name: c.earlier }).nth(1).innerText();
      // Right in Arabic, left in English. A hard-coded arrow is wrong in one
      // of the two languages whichever way it is written.
      expect(glyph.trim()).toBe(lang === 'ar' ? '→' : '←');
    });

    test('removal is confirmed, and backing out does nothing', async ({ page }) => {
      const deleted: string[] = [];
      await openPortfolio(page, lang, {
        items: [portfolioItem('a', 'Kitchen', 0)],
        onDelete: (id) => deleted.push(id),
      });

      await page.getByRole('button', { name: c.remove }).first().click();

      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(c.confirmTitle);
      await expectLegible(dialog, 'delete confirmation');

      await dialog.getByRole('button', { name: c.keep }).click();
      await expect(dialog).toBeHidden();
      expect(deleted).toEqual([]);
    });

    test('confirming actually removes it', async ({ page }) => {
      const deleted: string[] = [];
      await openPortfolio(page, lang, {
        items: [portfolioItem('a', 'Kitchen', 0)],
        onDelete: (id) => deleted.push(id),
      });

      await page.getByRole('button', { name: c.remove }).first().click();
      await page.getByRole('alertdialog').getByRole('button', { name: c.remove }).click();

      await expect.poll(() => deleted).toEqual(['a']);
    });

    test('survives a phone viewport without horizontal overflow', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await openPortfolio(page, lang, {
        items: [
          portfolioItem('a', 'Kitchen', 0),
          portfolioItem('b', 'Bathroom', 1),
          portfolioItem('c', 'Roof', 2),
          portfolioItem('d', 'Garden', 3),
        ],
      });

      await expectNoHorizontalPageOverflow(page);
      await expectContainedInParent(page.getByTestId('portfolio-grid'), 'portfolio grid');
    });
  });
}
