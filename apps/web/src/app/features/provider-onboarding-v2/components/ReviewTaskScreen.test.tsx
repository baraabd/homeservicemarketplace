import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProviderOnboardingReview } from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ReviewTask, type ReviewPart, type TaskPrimaryCommand } from './ReviewTaskScreen';
import { REVIEW_COPY } from '../copy/review-copy';

// Sprint 9B.23 — V2 Task 6.
// Sprint 09B.29 Phase 5A — one screen became three.
//
// WHAT THIS FILE PINS
//
//   - every verdict on screen is the SERVER's: readiness, the blocker, the
//     terms version, the lifecycle. Nothing is re-derived here, and the tests
//     feed server responses rather than props to keep it that way.
//   - the four summary rows read back the provider's OWN answers, in their own
//     language, and a row whose data has not arrived is omitted rather than
//     printed half-built.
//   - a decision that is with the platform gets a badge and no edit control.
//   - the consent records which WORDING was agreed to.
//   - the confirmation never says, or implies, that submitting grants access.
//
// SUPERSEDED, and recorded rather than deleted:
//
//   the four group sections   the approved review screen is four summary rows,
//                             not four headed lists. BLOCKING and OPTIONAL
//                             survive as notices below the panel, because they
//                             describe an application that is NOT ready and the
//                             reference depicts one that is. WAITING became the
//                             badge on the row it belongs to — asserted below,
//                             including that it offers no action. COMPLETE
//                             became the rows themselves, which say the same
//                             thing with the data in it.
//   the screen's own sticky   the actions are the shared chrome's now. The
//                             submit is published UP to it, and what this file
//                             asserts is the published COMMAND — its test id,
//                             when it is disabled, and that it fires once.
//                             `onboarding-submission-race.test.tsx` exercises
//                             the rendered button end to end.
//   the terms prose block     the approved consent is a checkbox and a version
//                             line. The version is still the server's and is
//                             still asserted; what went is a paragraph that
//                             restated it.

const REVIEW_URL = /\/v1\/me\/provider\/onboarding\/review/;
const DRAFT_URL = /\/v1\/me\/provider\/onboarding\/draft$/;
const PROFILE_URL = /\/v1\/me\/provider\/profile$/;
const CONSENT_STEP = /\/v1\/me\/provider\/onboarding\/steps\/CONSENT$/;

const EN = REVIEW_COPY.en;
const AR = REVIEW_COPY.ar;

// ── Server fixtures ─────────────────────────────────────────────────────────

function review(over: Partial<ProviderOnboardingReview> = {}): ProviderOnboardingReview {
  return {
    groups: [],
    canSubmit: true,
    blockedReason: null,
    terms: {
      version: 'v2',
      locale: 'en',
      accepted: true,
      acceptedVersion: 'v2',
      acceptedAt: '2026-08-29T00:00:00.000Z',
    },
    draftVersion: 7,
    lifecycleState: 'DRAFT',
    canWithdraw: false,
    ...over,
  };
}

const blocker = (field: string, code: string, taskId: string | null) => ({
  id: `blocking:${field}:${code}`,
  field,
  code,
  step: null,
  taskId,
  count: null,
});

/** A complete application, as the approved review screen reads it back. */
const DRAFT = (dataOver: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  state: 'DRAFT',
  currentStep: 'REVIEW',
  steps: [],
  completedSteps: [],
  percentComplete: 100,
  nextAction: { kind: 'SUBMIT' },
  complete: true,
  missing: [],
  version: 7,
  policyVersion: 'sprint-09b',
  lastSavedAt: null,
  editable: true,
  ...over,
  data: {
    displayName: 'Ahmad Fatal',
    phoneNumber: '0936706600',
    primarySpecialtyId: 'sp-interior',
    specialties: [
      {
        categoryId: 'sp-interior',
        labelEn: 'Interior painting',
        labelAr: 'دهانات داخلية',
        state: 'APPROVED',
      },
    ],
    yearsOfExperience: 14,
    transportMode: 'CAR',
    serviceAreaCity: 'Aleppo, Al-Furqan',
    serviceAreaRadiusKm: 15,
    timezone: 'UTC',
    resolvedTimezone: { resolved: 'UTC', display: null, needsConfirmation: false },
    availability: [0, 1, 2, 3, 4].map((dayOfWeek) => ({
      id: `av-${dayOfWeek}`,
      dayOfWeek,
      startMinute: 540,
      endMinute: 1020,
      timezone: 'UTC',
    })),
    ...dataOver,
  },
});

const PROFILE = (submittedForReviewAt: string | null = null) => ({
  profile: {
    id: 'pp-1',
    displayName: 'Ahmad Fatal',
    initials: 'AF',
    avatarUrl: null,
    status: 'DRAFT',
    submittedForReviewAt,
    reviewedAt: null,
    rejectionReason: null,
    serviceCategories: [],
    pendingCategories: [],
  },
});

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet(REVIEW_URL).reply(200, review());
  mock.onGet(DRAFT_URL).reply(200, DRAFT());
  mock.onGet(PROFILE_URL).reply(200, PROFILE());
  mock.onPatch(CONSENT_STEP).reply(200, {});
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
});

interface RenderOptions {
  data?: ProviderOnboardingReview;
  draft?: ReturnType<typeof DRAFT>;
  profile?: ReturnType<typeof PROFILE>;
  lang?: 'en' | 'ar';
  part?: ReviewPart;
}

function renderScreen(options: RenderOptions = {}) {
  const { data = review(), draft = DRAFT(), profile, lang = 'en', part = 'review' } = options;

  // Re-registered rather than appended: axios-mock-adapter matches in
  // registration order, so a handler added after the one in `beforeEach` never
  // fires and the override is silently ignored.
  mock.reset();
  mock.onGet(REVIEW_URL).reply(200, data);
  mock.onGet(DRAFT_URL).reply(200, draft);
  mock.onGet(PROFILE_URL).reply(200, profile ?? PROFILE());
  mock.onPatch(CONSENT_STEP).reply(200, {});

  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), draft);

  const published: (TaskPrimaryCommand | null)[] = [];
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ReviewTask lang={lang} part={part} onPrimaryCommand={(c) => published.push(c)} />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

  /** The command the chrome would draw right now, or null if there is none. */
  const command = () => published[published.length - 1] ?? null;
  return { published, command };
}

// ─── Screen 11: the summary ─────────────────────────────────────────────────

describe('the summary reads the application back', () => {
  it('shows the four approved rows, with the answers the provider gave', async () => {
    renderScreen();

    await screen.findByTestId('review-summary');
    expect(screen.getByTestId('review-row-BASICS_IDENTITY')).toHaveTextContent(
      'Ahmad Fatal • 0936706600',
    );
    expect(screen.getByTestId('review-row-SERVICES_EXPERIENCE')).toHaveTextContent(
      'Interior painting • 14 years • Car',
    );
    expect(screen.getByTestId('review-row-WORK_AREA')).toHaveTextContent(
      'Aleppo, Al-Furqan • 15 km',
    );
    expect(screen.getByTestId('review-row-WORKING_HOURS')).toHaveTextContent(
      'Sunday–Thursday • 09:00–17:00',
    );
  });

  it('names each row by the TASK that owns it, so the pencil goes somewhere legible', async () => {
    renderScreen();

    const row = await screen.findByTestId('review-row-WORK_AREA');
    expect(within(row).getByRole('button')).toHaveAccessibleName('Edit: Work area');
  });

  it('says nothing rather than half a sentence', async () => {
    // A work-area line missing its radius would read as a defect; the provider
    // has not finished telling us, and a confirmation is the last place to
    // print a blank.
    renderScreen({ draft: DRAFT({ serviceAreaCity: null, serviceAreaRadiusKm: null }) });

    await screen.findByTestId('review-summary');
    expect(screen.queryByTestId('review-row-WORK_AREA')).toBeNull();
    expect(screen.getByTestId('review-row-BASICS_IDENTITY')).toBeInTheDocument();
  });

  it('gives a decision that is with the PLATFORM a badge and nothing to press', async () => {
    renderScreen({
      draft: DRAFT({
        specialties: [
          {
            categoryId: 'sp-interior',
            labelEn: 'Interior painting',
            labelAr: 'دهانات داخلية',
            state: 'PENDING',
          },
        ],
      }),
    });

    const row = await screen.findByTestId('review-row-SERVICES_EXPERIENCE');
    expect(row).toHaveTextContent(EN.rowInReview);
    // An edit control here would invite the provider to redo work that is
    // already done and is not what is holding the application up.
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('does not offer an edit on an application that no longer accepts one', async () => {
    renderScreen({ data: review({ lifecycleState: 'ACCEPTED', canSubmit: false }) });

    const row = await screen.findByTestId('review-row-WORK_AREA');
    expect(within(row).getByRole('button')).toBeDisabled();
  });
});

describe('an application the server is NOT ready to take', () => {
  it('renders each blocker as a sentence with a way to fix it', async () => {
    renderScreen({
      data: review({
        canSubmit: false,
        groups: [{ kind: 'BLOCKING', items: [blocker('bio', 'TOO_SHORT', 'PORTFOLIO')] }],
      }),
    });

    expect(await screen.findByTestId('review-blocking-bio')).toHaveTextContent(
      EN.blocker['bio:TOO_SHORT']!,
    );
    expect(screen.getByTestId('review-complete-now-bio')).toBeInTheDocument();
  });

  it('falls back to a usable sentence for a code it has no copy for', async () => {
    renderScreen({
      data: review({
        canSubmit: false,
        groups: [{ kind: 'BLOCKING', items: [blocker('somethingNew', 'INVENTED', 'WORK_AREA')] }],
      }),
    });

    // Not a blank amber card: a policy rule added tomorrow still produces
    // something the provider can act on, because the card carries the task.
    expect(await screen.findByTestId('review-blocking-somethingNew')).toHaveTextContent(
      EN.blockerFallback,
    );
    expect(screen.getByTestId('review-complete-now-somethingNew')).toBeInTheDocument();
  });

  it('renders advice as advice, not as an error', async () => {
    renderScreen({
      data: review({
        groups: [
          {
            kind: 'OPTIONAL',
            items: [blocker('portfolio', 'EMPTY', 'PORTFOLIO')],
          },
        ],
      }),
    });

    expect(await screen.findByTestId('review-optional-EMPTY')).toHaveTextContent(
      EN.optionalPortfolioEmpty,
    );
  });

  it('shows nothing extra when the server sent nothing extra', async () => {
    renderScreen();

    await screen.findByTestId('review-summary');
    expect(screen.queryByTestId('review-group-BLOCKING')).toBeNull();
    expect(screen.queryByTestId('review-group-OPTIONAL')).toBeNull();
  });

  it('does not re-derive readiness from what it can see', async () => {
    // A full panel and no blockers, and the server still says no. The screen
    // reports the server, because the rules live in `evaluateOnboarding()`.
    const { command } = renderScreen({
      part: 'terms',
      data: review({ canSubmit: false, blockedReason: blocker('consent', 'REQUIRED', null) }),
    });

    expect(await screen.findByTestId('review-blocked-reason')).toHaveTextContent(
      EN.blocker['consent:REQUIRED']!,
    );
    await waitFor(() => expect(command()?.disabled).toBe(true));
  });
});

// ─── Screen 12: consent and submission ──────────────────────────────────────

describe('consent', () => {
  it('shows the version the SERVER served, never one the client chose', async () => {
    renderScreen({ part: 'terms', data: review({ terms: { ...review().terms, version: 'v9' } }) });

    expect(await screen.findByTestId('terms-accepted')).toHaveTextContent('Version v9');
  });

  it('is already ticked once the current version has been accepted', async () => {
    renderScreen({ part: 'terms' });

    const box = (await screen.findByTestId('terms-accept')) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it('records agreement when an unaccepted document is ticked', async () => {
    renderScreen({
      part: 'terms',
      data: review({
        terms: { ...review().terms, accepted: false, acceptedVersion: null, acceptedAt: null },
      }),
    });

    const box = (await screen.findByTestId('terms-accept')) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);

    // The server records WHICH wording was agreed to, so the version it served
    // is the version echoed back to it — with the draft version beside it, so a
    // draft that moved under us comes back 409 rather than recording agreement
    // against something the provider did not read.
    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const sent = JSON.parse(String(mock.history.patch[0]!.data));
    expect(sent.acceptedConsentVersion).toBe('v2');
    expect(sent.version).toBe(7);
  });

  it('does not re-record an agreement that already stands', async () => {
    renderScreen({ part: 'terms' });

    fireEvent.click(await screen.findByTestId('terms-accept'));
    // There is no un-accept command, so a second tick is not a transition the
    // screen may invent.
    await waitFor(() => expect(screen.getByTestId('terms-accept')).toBeChecked());
    expect(mock.history.patch).toHaveLength(0);
  });

  it('says the terms CHANGED when an older version was accepted', async () => {
    renderScreen({
      part: 'terms',
      data: review({
        terms: { ...review().terms, accepted: false, acceptedVersion: 'v1' },
      }),
    });

    expect(await screen.findByTestId('terms-stale')).toHaveTextContent(EN.termsStale);
  });

  it('does not show the stale notice to someone who never accepted anything', async () => {
    renderScreen({
      part: 'terms',
      data: review({
        terms: { ...review().terms, accepted: false, acceptedVersion: null, acceptedAt: null },
      }),
    });

    await screen.findByTestId('terms-section');
    expect(screen.queryByTestId('terms-stale')).toBeNull();
  });

  it('says what submitting costs BEFORE it is done, which is the only useful time', async () => {
    renderScreen({ part: 'terms' });

    expect(await screen.findByTestId('terms-after-submit')).toHaveTextContent(EN.afterSubmitBody);
    expect(screen.getByTestId('terms-ready')).toHaveTextContent(EN.readyTitle);
  });
});

describe('the submission the chrome draws', () => {
  it('is published only from the consent screen', async () => {
    const summary = renderScreen({ part: 'review' });
    await screen.findByTestId('review-summary');
    expect(summary.command()).toBeNull();
  });

  it('carries the approved test id and takes its words from the chrome', async () => {
    const { command } = renderScreen({ part: 'terms' });

    await waitFor(() => expect(command()).not.toBeNull());
    expect(command()!.testId).toBe('review-submit');
    // `null` means "the chrome's label" — the approved wording lives beside
    // every other screen's primary, not in this file.
    expect(command()!.label).toBeNull();
    expect(command()!.disabled).toBe(false);
  });

  it('is unavailable once the application is no longer editable', async () => {
    const { command } = renderScreen({
      part: 'terms',
      data: review({ lifecycleState: 'DOCUMENTS_REQUIRED', canSubmit: false }),
    });

    await waitFor(() => expect(command()?.disabled).toBe(true));
  });

  it('reports a conflict as something to reread rather than a failure', async () => {
    const data = review();
    mock.reset();
    mock.onGet(REVIEW_URL).reply(200, data);
    mock.onGet(DRAFT_URL).reply(200, DRAFT());
    mock.onGet(PROFILE_URL).reply(200, PROFILE());
    mock.onPost(/\/onboarding\/submit/).reply(409, { message: 'stale' });

    window.localStorage.setItem('hsm.lang', 'en');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT());
    let latest: TaskPrimaryCommand | null = null;
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <LanguageProvider>
            <ReviewTask
              lang="en"
              part="terms"
              onPrimaryCommand={(c) => {
                latest = c;
              }}
            />
          </LanguageProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(latest).not.toBeNull());
    latest!.run();

    expect(await screen.findByTestId('review-conflict')).toHaveTextContent(EN.conflict);
  });
});

// ─── Screen 13: the confirmation ────────────────────────────────────────────

describe('the confirmation', () => {
  const submitted = review({
    lifecycleState: 'SUBMITTED',
    canSubmit: false,
    canWithdraw: true,
  });

  it('says where the application is, not merely that it left', async () => {
    renderScreen({ part: 'submitted', data: submitted });

    const screenEl = await screen.findByTestId('review-submitted');
    expect(screenEl).toHaveTextContent(EN.sentHeading);
    expect(screenEl).toHaveTextContent(EN.sentLead);

    expect(screen.getByTestId('timeline-step-submitted')).toHaveAttribute('data-tone', 'done');
    expect(screen.getByTestId('timeline-step-under-review')).toHaveAttribute(
      'data-tone',
      'current',
    );
    expect(screen.getByTestId('timeline-step-activation')).toHaveAttribute('data-tone', 'pending');
  });

  it('never lets "submitted" be read as "allowed to work"', async () => {
    // ADR 0005 keeps application completion and work access on separate axes.
    // The approved screen says it with a hollow ring; this says it in words for
    // somebody who cannot see one.
    renderScreen({ part: 'submitted', data: submitted });

    const step = await screen.findByTestId('timeline-step-activation');
    expect(step).toHaveTextContent('does not give you access to work');
  });

  it('shows the time the SERVER recorded, in the provider’s own zone', async () => {
    const today = new Date();
    today.setUTCHours(12, 43, 0, 0);
    renderScreen({
      part: 'submitted',
      data: submitted,
      profile: PROFILE(today.toISOString()),
    });

    // Awaited rather than asserted at first paint: the timeline appears with
    // the draft, and the recorded time arrives with the provider profile.
    await waitFor(() =>
      expect(screen.getByTestId('timeline-step-submitted')).toHaveTextContent('Today • 12:43'),
    );
  });

  it('omits the time rather than inventing one the server never sent', async () => {
    renderScreen({ part: 'submitted', data: submitted, profile: PROFILE(null) });

    const step = await screen.findByTestId('timeline-step-submitted');
    expect(step).toHaveTextContent(EN.stepSubmitted);
    expect(step.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('offers no submit at all — the chrome cannot draw one here', async () => {
    const { command } = renderScreen({ part: 'submitted', data: submitted });

    await screen.findByTestId('review-submitted');
    expect(command()).toBeNull();
  });
});

// ─── Failure, language and keyboard ─────────────────────────────────────────

describe('when the review cannot be loaded', () => {
  it('says so and offers a retry rather than an empty panel', async () => {
    mock.reset();
    mock.onGet(REVIEW_URL).reply(500);
    mock.onGet(DRAFT_URL).reply(200, DRAFT());
    mock.onGet(PROFILE_URL).reply(200, PROFILE());

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <LanguageProvider>
            <ReviewTask lang="en" part="review" onPrimaryCommand={vi.fn()} />
          </LanguageProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('review-load-failed')).toHaveTextContent(EN.loadFailed);
    expect(screen.getByTestId('review-retry')).toBeInTheDocument();
  });
});

describe('Arabic', () => {
  it('reads the application back in Arabic, including the values', async () => {
    renderScreen({ lang: 'ar', draft: DRAFT({ serviceAreaCity: 'حلب، الفرقان' }) });

    await screen.findByTestId('review-summary');
    expect(screen.getByTestId('review-row-SERVICES_EXPERIENCE')).toHaveTextContent(
      'دهانات داخلية • 14 عاماً • سيارة',
    );
    // The unit travels with the language. An Arabic city beside "15 km" was a
    // real false pass on the work-area screen, and it is the same mistake here.
    expect(screen.getByTestId('review-row-WORK_AREA')).toHaveTextContent('حلب، الفرقان • 15 كم');
  });

  it('renders the Arabic consent and its version line', async () => {
    renderScreen({ lang: 'ar', part: 'terms' });

    expect(await screen.findByTestId('terms-section')).toHaveTextContent(AR.consentLabel);
    expect(screen.getByTestId('terms-accepted')).toHaveTextContent('الإصدار v2');
  });

  it('renders the Arabic confirmation', async () => {
    renderScreen({
      lang: 'ar',
      part: 'submitted',
      data: review({ lifecycleState: 'SUBMITTED', canSubmit: false }),
    });

    expect(await screen.findByTestId('review-submitted')).toHaveTextContent(AR.sentHeading);
    expect(screen.getByTestId('timeline-step-activation')).toHaveTextContent('لا يمنحك ذلك الوصول');
  });
});

describe('accessibility', () => {
  it('exposes every edit as a real button, so the panel is keyboard-operable', async () => {
    renderScreen();

    await screen.findByTestId('review-summary');
    const pencils = screen.getAllByRole('button');
    expect(pencils.length).toBeGreaterThanOrEqual(3);
    for (const pencil of pencils) expect(pencil).toHaveAttribute('type', 'button');
  });

  it('makes the consent a labelled checkbox rather than a styled div', async () => {
    renderScreen({ part: 'terms' });

    const box = await screen.findByRole('checkbox', { name: new RegExp(EN.consentLabel) });
    expect(box).toHaveAttribute('type', 'checkbox');
    // The version is wired as the field's description, so a screen reader says
    // which document is being agreed to without the user hunting for it.
    expect(box.getAttribute('aria-describedby')).toBe(
      screen.getByTestId('terms-accepted').getAttribute('id'),
    );
  });

  it('announces the confirmation politely, and as an ordered sequence', async () => {
    renderScreen({
      part: 'submitted',
      data: review({ lifecycleState: 'SUBMITTED', canSubmit: false }),
    });

    const confirmation = await screen.findByTestId('review-submitted');
    expect(confirmation).toHaveAttribute('role', 'status');
    expect(confirmation).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('submitted-timeline').tagName).toBe('OL');
  });
});
