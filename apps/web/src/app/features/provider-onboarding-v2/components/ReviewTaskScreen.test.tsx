import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderOnboardingReview } from '@homeservicemarketplace/contracts';

import { ReviewTaskScreen } from './ReviewTaskScreen';
import { REVIEW_COPY } from '../copy/review-copy';

// Sprint 9B.23 — V2 Task 6.
//
// The presentational component is asserted directly: every decision this
// screen renders is the SERVER's, so the tests feed it server responses and
// check that it renders them faithfully rather than re-deriving anything.

const EN = REVIEW_COPY.en;
const AR = REVIEW_COPY.ar;

function review(over: Partial<ProviderOnboardingReview> = {}): ProviderOnboardingReview {
  return {
    groups: [
      { kind: 'BLOCKING', items: [] },
      { kind: 'WAITING', items: [] },
      { kind: 'OPTIONAL', items: [] },
      { kind: 'COMPLETE', items: [] },
    ],
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
    ...over,
  };
}

const blocker = (field: string, code: string, taskId: string) => ({
  id: `blocking:${field}:${code}`,
  field,
  code,
  step: null,
  taskId,
  count: null,
});

function renderScreen(
  data: ProviderOnboardingReview = review(),
  over: Partial<Parameters<typeof ReviewTaskScreen>[0]> = {},
) {
  const props = {
    review: data,
    lang: 'en' as const,
    editable: true,
    onCompleteNow: vi.fn(),
    onAcceptTerms: vi.fn(),
    onSubmit: vi.fn(),
    acceptPending: false,
    submitPending: false,
    conflict: false,
    ...over,
  };
  render(<ReviewTaskScreen {...props} />);
  return props;
}

describe('a disabled submission always explains the next action', () => {
  it('disables the button when the server says it cannot submit', () => {
    renderScreen(
      review({ canSubmit: false, blockedReason: blocker('bio', 'TOO_SHORT', 'PORTFOLIO') }),
    );
    expect(screen.getByTestId('review-submit')).toBeDisabled();
  });

  it('names the ONE next action beside it', () => {
    renderScreen(
      review({ canSubmit: false, blockedReason: blocker('bio', 'TOO_SHORT', 'PORTFOLIO') }),
    );
    expect(screen.getByTestId('review-blocked-reason')).toHaveTextContent(
      EN.blocker['bio:TOO_SHORT'],
    );
  });

  it('never shows a disabled button with no reason at all', () => {
    // The defect this screen replaces: a greyed-out control and nine red
    // messages, none of which says which one is blocking.
    renderScreen(
      review({
        canSubmit: false,
        blockedReason: blocker('phoneNumber', 'REQUIRED', 'BASICS_IDENTITY'),
      }),
    );
    expect(screen.getByTestId('review-submit')).toBeDisabled();
    expect(screen.getByTestId('review-blocked-reason').textContent?.trim().length).toBeGreaterThan(
      EN.blockedPrefix.length,
    );
  });

  it('announces the reason politely rather than interrupting', () => {
    renderScreen(
      review({ canSubmit: false, blockedReason: blocker('bio', 'REQUIRED', 'PORTFOLIO') }),
    );
    expect(screen.getByTestId('review-blocked-reason')).toHaveAttribute('aria-live', 'polite');
  });

  it('enables the button when the server says it can submit', () => {
    renderScreen();
    expect(screen.getByTestId('review-submit')).not.toBeDisabled();
  });

  it('does not re-derive readiness from the group contents', () => {
    // canSubmit true while a BLOCKING item is present is a server state this
    // screen must render faithfully, not "correct".
    renderScreen(
      review({
        canSubmit: true,
        groups: [{ kind: 'BLOCKING', items: [blocker('bio', 'REQUIRED', 'PORTFOLIO')] }],
      }),
    );
    expect(screen.getByTestId('review-submit')).not.toBeDisabled();
  });
});

describe('the four groups', () => {
  it('renders a blocking item as an amber card with a deep link', () => {
    const props = renderScreen(
      review({ groups: [{ kind: 'BLOCKING', items: [blocker('bio', 'REQUIRED', 'PORTFOLIO')] }] }),
    );
    fireEvent.click(screen.getByTestId('review-complete-now-bio'));
    expect(props.onCompleteNow).toHaveBeenCalledWith('PORTFOLIO');
  });

  it('gives every blocking item somewhere to go', () => {
    renderScreen(
      review({
        groups: [
          {
            kind: 'BLOCKING',
            items: [
              blocker('bio', 'REQUIRED', 'PORTFOLIO'),
              blocker('serviceAreaCity', 'REQUIRED', 'WORK_AREA'),
            ],
          },
        ],
      }),
    );
    expect(screen.getByTestId('review-complete-now-bio')).toBeInTheDocument();
    expect(screen.getByTestId('review-complete-now-serviceAreaCity')).toBeInTheDocument();
  });

  it('renders a waiting item WITHOUT an action, because there is nothing to do', () => {
    renderScreen(
      review({
        groups: [
          {
            kind: 'WAITING',
            items: [
              {
                id: 'w',
                field: null,
                code: 'SPECIALTY_REVIEW',
                step: null,
                taskId: null,
                count: 3,
              },
            ],
          },
        ],
      }),
    );
    expect(screen.getByTestId('review-waiting-SPECIALTY_REVIEW')).toHaveTextContent('3');
    expect(screen.queryByText(EN.completeNow)).not.toBeInTheDocument();
  });

  it('renders an optional item as advice, not as an error', () => {
    renderScreen(
      review({
        groups: [
          {
            kind: 'OPTIONAL',
            items: [
              {
                id: 'o',
                field: null,
                code: 'PORTFOLIO_EMPTY',
                step: 'PROFILE',
                taskId: 'PORTFOLIO',
                count: null,
              },
            ],
          },
        ],
      }),
    );
    const card = screen.getByTestId('review-optional-PORTFOLIO_EMPTY');
    expect(card).toHaveTextContent(EN.optionalPortfolioEmpty);
    // Neutral border, not amber: a suggestion that looks like a requirement
    // sends providers to fix something that was never blocking them.
    expect(card.className).not.toMatch(/amber/);
  });

  it('renders completed steps with their label', () => {
    renderScreen(
      review({
        groups: [
          {
            kind: 'COMPLETE',
            items: [
              {
                id: 'c',
                field: null,
                code: null,
                step: 'IDENTITY',
                taskId: 'BASICS_IDENTITY',
                count: null,
              },
            ],
          },
        ],
      }),
    );
    expect(screen.getByTestId('review-complete-IDENTITY')).toHaveTextContent(EN.stepLabel.IDENTITY);
  });

  it('omits a group the server sent empty rather than showing a bare heading', () => {
    renderScreen();
    expect(screen.queryByTestId('review-group-BLOCKING')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-group-WAITING')).not.toBeInTheDocument();
  });

  it('falls back to a usable sentence for a code it has no copy for', () => {
    // A policy rule added without copy must still produce an actionable card.
    renderScreen(
      review({
        groups: [
          { kind: 'BLOCKING', items: [blocker('somethingNew', 'WEIRD', 'BASICS_IDENTITY')] },
        ],
      }),
    );
    expect(screen.getByTestId('review-blocking-somethingNew')).toHaveTextContent(
      EN.blockerFallback,
    );
    expect(screen.getByTestId('review-complete-now-somethingNew')).toBeInTheDocument();
  });
});

describe('terms', () => {
  it('shows the wording for the version the SERVER served', () => {
    renderScreen(
      review({
        terms: { ...review().terms, accepted: false, acceptedVersion: null, version: 'v9' },
      }),
    );
    expect(screen.getByTestId('terms-body')).toHaveTextContent('v9');
  });

  it('offers acceptance when the current version is not accepted', () => {
    const props = renderScreen(
      review({ terms: { ...review().terms, accepted: false, acceptedVersion: null } }),
    );
    fireEvent.click(screen.getByTestId('terms-accept'));
    expect(props.onAcceptTerms).toHaveBeenCalled();
  });

  it('says the terms CHANGED when an older version was accepted', () => {
    renderScreen(
      review({
        terms: { ...review().terms, accepted: false, acceptedVersion: 'v1', version: 'v2' },
      }),
    );
    expect(screen.getByTestId('terms-stale')).toHaveTextContent(EN.termsStale);
  });

  it('does not show the stale notice to someone who never accepted anything', () => {
    renderScreen(review({ terms: { ...review().terms, accepted: false, acceptedVersion: null } }));
    expect(screen.queryByTestId('terms-stale')).not.toBeInTheDocument();
  });

  it('confirms which version was agreed to once accepted', () => {
    renderScreen();
    expect(screen.getByTestId('terms-accepted')).toHaveTextContent('v2');
    expect(screen.queryByTestId('terms-accept')).not.toBeInTheDocument();
  });
});

describe('submission', () => {
  it('asks the container to submit', () => {
    const props = renderScreen();
    fireEvent.click(screen.getByTestId('review-submit'));
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it('disables the button while a submit is in flight, so a double tap cannot fire twice', () => {
    renderScreen(review(), { submitPending: true });
    expect(screen.getByTestId('review-submit')).toBeDisabled();
    expect(screen.getByTestId('review-submit')).toHaveTextContent(EN.submitting);
  });

  it('shows a submitted application as done, and says it grants nothing', () => {
    renderScreen(review({ lifecycleState: 'DOCUMENTS_REQUIRED' }));
    expect(screen.getByTestId('review-submitted')).toHaveTextContent(EN.submittedBody);
    expect(screen.queryByTestId('review-submit')).not.toBeInTheDocument();
  });

  it('reports a conflict as something to reread rather than a failure', () => {
    renderScreen(review(), { conflict: true });
    expect(screen.getByTestId('review-conflict')).toHaveTextContent(EN.conflict);
    expect(screen.getByTestId('review-conflict')).toHaveAttribute('role', 'alert');
  });

  it('refuses to act once the application is no longer editable', () => {
    renderScreen(review(), { editable: false });
    expect(screen.getByTestId('review-submit')).toBeDisabled();
  });
});

describe('the sticky action container', () => {
  it('is sticky rather than fixed, so it cannot cover the last row', () => {
    renderScreen();
    const bar = screen.getByTestId('review-action-bar');
    expect(bar.className).toMatch(/sticky/);
    expect(bar.className).not.toMatch(/fixed/);
  });

  // The bottom safe-area inset is NOT asserted here. React writes inline
  // styles through the CSSOM and jsdom rejects `calc()` containing `env()`
  // outright, so the attribute reads `bottom: 0px` and a passing assertion
  // would only prove jsdom dropped the rule. It is asserted in a real engine
  // in e2e/provider-onboarding-v2-review.spec.ts instead.
});

describe('accessibility', () => {
  it('gives every group a heading its section is labelled by', () => {
    renderScreen(
      review({ groups: [{ kind: 'BLOCKING', items: [blocker('bio', 'REQUIRED', 'PORTFOLIO')] }] }),
    );
    const heading = screen.getByText(EN.groupBlocking);
    expect(heading.id).toBe('review-group-blocking');
    expect(heading.closest('section')).toHaveAttribute('aria-labelledby', 'review-group-blocking');
  });

  it('exposes the actions as real buttons, so they are reachable by keyboard', () => {
    renderScreen(
      review({ groups: [{ kind: 'BLOCKING', items: [blocker('bio', 'REQUIRED', 'PORTFOLIO')] }] }),
    );
    expect(screen.getByTestId('review-complete-now-bio').tagName).toBe('BUTTON');
    expect(screen.getByTestId('review-submit').tagName).toBe('BUTTON');
  });

  it('announces the submitted state politely', () => {
    renderScreen(review({ lifecycleState: 'SUBMITTED' }));
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('Arabic', () => {
  it('renders the Arabic copy', () => {
    renderScreen(
      review({ canSubmit: false, blockedReason: blocker('bio', 'REQUIRED', 'PORTFOLIO') }),
      {
        lang: 'ar',
      },
    );
    expect(screen.getByTestId('review-blocked-reason')).toHaveTextContent(
      AR.blocker['bio:REQUIRED'],
    );
    expect(screen.getByTestId('review-submit')).toHaveTextContent(AR.submit);
  });

  it('localises the waiting count into Arabic-Indic digits', () => {
    renderScreen(
      review({
        groups: [
          {
            kind: 'WAITING',
            items: [
              {
                id: 'w',
                field: null,
                code: 'SPECIALTY_REVIEW',
                step: null,
                taskId: null,
                count: 3,
              },
            ],
          },
        ],
      }),
      { lang: 'ar' },
    );
    // ٣ — a Latin "3" inside Arabic copy is the thing localisation is for.
    expect(screen.getByTestId('review-waiting-SPECIALTY_REVIEW').textContent).toMatch(/[٠-٩]/);
  });

  it('shows the terms version in the Arabic wording too', () => {
    renderScreen(
      review({
        terms: { ...review().terms, accepted: false, acceptedVersion: null, version: 'v2' },
      }),
      { lang: 'ar' },
    );
    expect(screen.getByTestId('terms-body')).toHaveTextContent('v2');
  });
});
