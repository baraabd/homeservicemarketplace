import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { formatMinute, toWeek } from './availability/weekly-schedule';
import { DAY_NAMES, type Lang } from './copy/availability-copy';

// Sprint 09B.29 Phase 5A — what each finished row says it holds.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
//
// WHY THE COMPLETE HUB SAYS SOMETHING DIFFERENT
//
// The partial hub's rows carry GUIDANCE — "Starting point and coverage" tells
// a provider what a task will ask for. Once the task is done that sentence has
// stopped being useful and started being noise: they know what a work area is,
// because they just told us theirs.
//
// So the approved complete hub replaces it with the ANSWER. "Aleppo • 15 km",
// "Sunday–Thursday • 09:00–17:00", "3 photos uploaded". That is the difference
// between a checklist that says what it wanted and one that shows what it got,
// and it is what makes the final review screen unsurprising.
//
// WHERE THE WORDS COME FROM
//
// The draft, and nothing else. The hub response carries a static English
// sentence per task id (see `onboarding-hub-resolver.ts`), so these summaries
// cannot come from the wire without a server change — and they must be
// bilingual, which a single-language field cannot be.
//
// Composing them here is projection, not policy: every value is one the
// provider already gave us and the server already stored. Nothing decides
// whether a task is complete, and nothing is shown that the server did not
// send. A task whose data has not arrived gets no summary rather than a
// half-built one.
//
// RECORDED FOR PHASE 5B: the honest fix is for the hub response to carry these
// per-task summaries in both languages, so the client stops joining the draft
// against the hub to say what the hub already knows.

export interface HubSummaryCopy {
  /** A specialty decision is still with the platform. */
  selectionsSaved: string;
  /** "Aleppo • 15 km" */
  area: (city: string, km: number) => string;
  /** "Sunday–Thursday • 09:00–17:00" */
  hours: (days: string, window: string) => string;
  /** "Sunday–Thursday", or "Sunday, Tuesday" when they do not run together. */
  dayRange: (from: string, to: string) => string;
  dayList: (days: readonly string[]) => string;
  /** "3 photos uploaded" */
  photos: (count: number) => string;
  /** Nothing left to do but read it back. */
  readyToReview: string;
}

export const HUB_SUMMARY_COPY: Record<Lang, HubSummaryCopy> = {
  en: {
    selectionsSaved: 'Selections saved',
    area: (city, km) => `${city} • ${km} km`,
    hours: (days, window) => `${days} • ${window}`,
    dayRange: (from, to) => `${from}–${to}`,
    dayList: (days) => days.join(', '),
    photos: (count) => `${count} photo${count === 1 ? '' : 's'} uploaded`,
    readyToReview: 'Ready to review',
  },
  ar: {
    selectionsSaved: 'اختياراتك محفوظة',
    area: (city, km) => `${city} • ${km} كم`,
    hours: (days, window) => `${days} • ${window}`,
    dayRange: (from, to) => `${from}–${to}`,
    dayList: (days) => days.join('، '),
    photos: (count) => `${count} صور مرفوعة`,
    readyToReview: 'جاهز للمراجعة',
  },
};

/**
 * The days the provider works, as a range when they run together.
 *
 * "Sunday–Thursday" rather than five names, because the range is how people
 * say it and how the approved screen writes it. A week that is genuinely
 * scattered — Sunday, Tuesday, Friday — is listed, because compressing that
 * into a range would state hours the provider does not work.
 */
function describeDays(dayNumbers: readonly number[], lang: Lang): string | null {
  if (dayNumbers.length === 0) return null;
  const copy = HUB_SUMMARY_COPY[lang];
  const names = DAY_NAMES[lang];
  const sorted = [...dayNumbers].sort((a, b) => a - b);

  const consecutive = sorted.every((day, index) => index === 0 || day === sorted[index - 1]! + 1);
  if (consecutive && sorted.length > 1) {
    return copy.dayRange(names[sorted[0]!]!, names[sorted[sorted.length - 1]!]!);
  }
  return copy.dayList(sorted.map((day) => names[day]!));
}

/**
 * The one window the week shares, or nothing.
 *
 * A week with different hours on different days has no single sentence, and
 * inventing one ("09:00–17:00" over a Thursday that ends at 13:00) would be
 * worse than saying only which days.
 */
function describeWindow(
  week: readonly (readonly { startMinute: number; endMinute: number }[])[],
): string | null {
  const windows = week.flat();
  if (windows.length === 0) return null;
  const first = windows[0]!;
  const uniform = windows.every(
    (w) => w.startMinute === first.startMinute && w.endMinute === first.endMinute,
  );
  if (!uniform) return null;
  return `${formatMinute(first.startMinute)}–${formatMinute(first.endMinute)}`;
}

/**
 * What a finished row says, or `null` to keep the task's own description.
 *
 * `photoCount` is passed in rather than fetched here: the gallery is a
 * separate resource, and a pure function that reached for it could not be
 * reasoned about or tested.
 */
export function hubTaskSummary(
  taskId: string,
  status: string,
  draft: ProviderOnboardingDraftView | undefined,
  photoCount: number | null,
  lang: Lang,
): string | null {
  const copy = HUB_SUMMARY_COPY[lang];
  const data = draft?.data;

  switch (taskId) {
    case 'SERVICES_EXPERIENCE':
      // Only while the platform still has it. A completed one keeps its own
      // description, because "selections saved" would understate a decision
      // that has actually been made.
      return status === 'WAITING' ? copy.selectionsSaved : null;

    case 'WORK_AREA': {
      const city = data?.serviceAreaCity?.split(',')[0]?.trim();
      const km = data?.serviceAreaRadiusKm;
      if (!city || typeof km !== 'number') return null;
      return copy.area(city, km);
    }

    case 'WORKING_HOURS': {
      if (!Array.isArray(data?.availability) || data.availability.length === 0) return null;
      const week = toWeek(data.availability);
      const days = describeDays(
        week.map((windows, day) => (windows.length > 0 ? day : -1)).filter((day) => day >= 0),
        lang,
      );
      const window = describeWindow(week);
      if (!days) return null;
      return window ? copy.hours(days, window) : days;
    }

    case 'PORTFOLIO':
      if (photoCount === null || photoCount <= 0) return null;
      return copy.photos(photoCount);

    case 'REVIEW_SUBMISSION':
      // The only row whose summary is about what happens NEXT, because it is
      // the only task with nothing of its own to report.
      return status === 'AVAILABLE' ? copy.readyToReview : null;

    default:
      return null;
  }
}
