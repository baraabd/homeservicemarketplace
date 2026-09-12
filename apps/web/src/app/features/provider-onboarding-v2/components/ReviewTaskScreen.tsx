import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Pencil, Send, ShieldCheck } from 'lucide-react';
import type { ProviderOnboardingReview, ReviewGroup } from '@homeservicemarketplace/contracts';

import {
  useAcceptTerms,
  useOnboardingReview,
  useSubmitApplication,
} from '../../../hooks/provider/useProviderOnboardingReview';
import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import { useProviderProfile } from '../../../hooks/provider/useProviderProfile';
import { ProviderCard, ProviderNotice, ProviderStatusBadge } from '../../provider-ui';
import { REVIEW_COPY, blockerLine, type Lang, type ReviewCopy } from '../copy/review-copy';
import { TASK_TITLES } from '../copy/onboarding-hub-copy';
import { reviewRows, type ReviewRow } from '../hub-task-summary';
import { OnboardingAlert } from './OnboardingAlert';
import { OnboardingTimeline, type OnboardingTimelineStep } from './OnboardingTimeline';

// Sprint 9B.23 — V2 Task 6: review, terms, and submission.
// Sprint 09B.29 Phase 5A — the approved design's THREE screens.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
//
// THIS SCREEN STILL DECIDES NOTHING.
//
// The button is disabled on the server's `canSubmit`, the consent carries the
// server's `version`, the submit echoes the server's `draftVersion`, and the
// confirmation is drawn because the server's lifecycle says the application is
// in. Nothing here counts blockers, evaluates completeness or infers readiness
// — the rules live in `evaluateOnboarding()`, and a second copy here would be a
// second policy.
//
// WHAT THE APPROVED DESIGN CHANGED
//
// One screen became three, addressed as `REVIEW_SUBMISSION`, `#terms`, and —
// after submission — the same route again:
//
//   review     four summary ROWS that read the answers back, each with a
//              pencil to the task that owns it. Not the nine repeated cards
//              the baseline had, and not a list of ticks either: a provider
//              confirming an application needs to see WHAT they said, which is
//              the only thing that makes a confirmation meaningful.
//   terms      the readiness alert, the consent itself, and what happens after.
//              Consent moved off the review screen because agreeing to a legal
//              document is not the same act as checking your phone number, and
//              putting them on one screen meant the provider scrolled past the
//              terms to reach the button.
//   submitted  a confirmation and a three-step timeline. The old green banner
//              said "submitted" and nothing about where the application now
//              sits in a queue the provider cannot see.
//
// WHAT SURVIVED, AND WHERE IT WENT
//
// The server's GROUPS are still rendered — but only the ones that describe an
// application that is NOT ready, because the approved screen depicts one that
// is. BLOCKING keeps its deep link; OPTIONAL keeps its advice. WAITING lost its
// card and gained a badge on the row it belongs to, which is a better answer to
// the same question: the specialty line now says "In review" beside the
// specialty, instead of a separate card several rows away. And COMPLETE lost its
// tick list to the four summary rows, which say the same thing with the data in
// it.

export type ReviewPart = 'review' | 'terms' | 'submitted';

/**
 * A primary action the CHROME draws but the body owns.
 *
 * The consent screen's action is a server command with preconditions the chrome
 * cannot see — `canSubmit`, the consent version, a readiness refetch that runs
 * first. The chrome cannot synthesise it, and a button up there that merely
 * looked like it submitted would be the worst kind of parity: right in a
 * screenshot, inert in use. So the body publishes it upward and the chrome
 * renders it in the approved position.
 */
export interface TaskPrimaryCommand {
  /**
   * `null` means "the words are the chrome's".
   *
   * The approved consent screen's action reads "Submit for review", which lives
   * in the chrome copy beside every other screen's primary. The body supplies a
   * label only for the state the chrome has no word for — the one in flight.
   */
  label: string | null;
  testId: string;
  disabled: boolean;
  pending: boolean;
  run: () => void;
}

interface ReviewTaskProps {
  lang: Lang;
  /** Which of the three approved screens. Resolved from the URL and the
   *  lifecycle by `taskScreenKeyFor`, so the chrome and the body cannot
   *  disagree about which one they are drawing. */
  part: ReviewPart;
  onPrimaryCommand?: (command: TaskPrimaryCommand | null) => void;
}

// ─── Container ──────────────────────────────────────────────────────────────

export function ReviewTask({ lang, part, onPrimaryCommand }: ReviewTaskProps) {
  const copy = REVIEW_COPY[lang];
  const navigate = useNavigate();
  const query = useOnboardingReview(lang);
  const accept = useAcceptTerms();
  const submit = useSubmitApplication();
  const [conflict, setConflict] = useState(false);

  const review = query.data;

  const onAcceptTerms = () => {
    if (!review) return;
    setConflict(false);
    accept.mutate(
      { draftVersion: review.draftVersion, termsVersion: review.terms.version },
      { onError: (err) => setConflict(isConflict(err)) },
    );
  };

  /**
   * One submission at a time, decided without waiting for a render.
   *
   * The button's `disabled` cannot close this window on its own: it is
   * published to the chrome from an effect, so it reflects `submitPending` one
   * render LATE, and two taps inside that gap both find an enabled control.
   * A ref is the only thing that answers "has one already started" at the
   * instant of the second tap, and filing two applications is not something the
   * server should have to de-duplicate for us.
   */
  const submitting = useRef(false);

  const onSubmit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setConflict(false);

    // REFRESH READINESS FIRST, and submit against what comes back.
    //
    // The review on screen may be seconds or minutes old — another tab could
    // have edited the draft, or an operator could have published new terms.
    // Submitting the version we rendered would hand the server a token it has
    // to reject, and the provider would see a 409 they did nothing to cause.
    const release = () => {
      submitting.current = false;
    };

    let fresh;
    try {
      fresh = await query.refetch();
    } catch {
      release();
      return;
    }

    const current = fresh.data;
    if (!current || !current.canSubmit) {
      release();
      return;
    }

    submit.mutate(
      { draftVersion: current.draftVersion },
      {
        // Released on BOTH outcomes. A failed submit the provider can retry is
        // the whole reason the conflict line exists, and a latch that never
        // reopened would leave them reading it beside a button that does
        // nothing.
        onError: (err) => {
          release();
          setConflict(isConflict(err));
        },
        onSuccess: release,
      },
    );
  };

  const editable =
    review !== undefined &&
    review.lifecycleState !== 'SUBMITTED' &&
    review.lifecycleState !== 'DOCUMENTS_REQUIRED' &&
    review.lifecycleState !== 'ACCEPTED';

  // ── Publishing the consent screen's action ────────────────────────────────
  //
  // `run` goes through a ref so the effect can depend on the four PRIMITIVE
  // values that actually change what the button looks like. Depending on the
  // handler itself would re-publish on every render, and a setState in an
  // effect that runs every render is an infinite loop.
  const submitRef = useRef(onSubmit);
  // Synced in an effect rather than during render: a ref written while
  // rendering is not safe under concurrent React, which may start a render it
  // then throws away. By the time anything can CLICK the button, effects have
  // flushed and the ref holds the current handler.
  useEffect(() => {
    submitRef.current = onSubmit;
  });

  const submitPending = submit.isPending || query.isRefetching;
  const canSubmit = review?.canSubmit === true;
  const submitLabel = submitPending ? copy.submitting : null;
  const publish = part === 'terms' && review !== undefined ? onPrimaryCommand : undefined;

  useEffect(() => {
    if (!publish) return;
    publish({
      label: submitLabel,
      testId: 'review-submit',
      // A REAL disabled attribute, not a styled-off div: it leaves the tab
      // order and screen readers announce it as unavailable. The reason is
      // rendered on the screen below, so "unavailable" is never the only thing
      // the provider learns.
      disabled: !canSubmit || !editable || submitPending,
      pending: submitPending,
      run: () => void submitRef.current(),
    });
    return () => publish(null);
  }, [publish, submitLabel, canSubmit, editable, submitPending]);

  if (query.isPending) {
    return (
      <div className="flex justify-center py-10" role="status" aria-live="polite">
        <span className="sr-only">{copy.heading}</span>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-pv-border border-t-pv-accent motion-reduce:animate-none" />
      </div>
    );
  }

  if (query.isError || !review) {
    return (
      <div className="flex flex-col items-start gap-3" data-testid="review-load-failed">
        <p className="break-words text-pv-label text-pv-danger">{copy.loadFailed}</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          data-testid="review-retry"
          className="min-h-11 rounded-pv-action border border-pv-accent px-3 text-pv-label font-bold text-pv-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
        >
          {copy.retry}
        </button>
      </div>
    );
  }

  if (part === 'submitted') {
    return <SubmittedConfirmation review={review} lang={lang} />;
  }

  if (part === 'terms') {
    return (
      <ConsentScreen
        review={review}
        copy={copy}
        editable={editable}
        conflict={conflict}
        acceptPending={accept.isPending}
        onAcceptTerms={onAcceptTerms}
      />
    );
  }

  return (
    <ReviewSummaryScreen
      review={review}
      copy={copy}
      lang={lang}
      editable={editable}
      onCompleteNow={(taskId) => navigate(`/provider/onboarding/${taskId}`)}
    />
  );
}

// ─── Screen 11: the summary ─────────────────────────────────────────────────

function ReviewSummaryScreen({
  review,
  copy,
  lang,
  editable,
  onCompleteNow,
}: {
  review: ProviderOnboardingReview;
  copy: ReviewCopy;
  lang: Lang;
  editable: boolean;
  onCompleteNow: (taskId: string) => void;
}) {
  const draft = useOnboardingDraft();
  const rows = reviewRows(draft.data, TASK_TITLES[lang], lang);
  const byKind = new Map(review.groups.map((g) => [g.kind, g]));

  return (
    // `.hsm-main-tight`: a 12px column, not the 18px every other task screen
    // uses. The reference tightens it here because the screen is one paragraph
    // and one panel, and 18px between them read as two unrelated blocks.
    <div className="grid gap-3" data-testid="review-screen">
      {/* `.hsm-lead`: pulled up 8px against the column's own 20px inset. */}
      <p className="-mt-2 break-words text-pv-body leading-[1.75] text-pv-muted">
        {copy.approvedLead}
      </p>

      {/* `.hsm-panel` holding `.hsm-summary-row`s. One card rather than four,
          because these are four facts about ONE application — four separate
          cards made each look like a separate decision to make again. */}
      <ProviderCard className="p-4" style={{ borderRadius: 14 }} data-testid="review-summary">
        {rows.map((row, index) => (
          <SummaryRow
            key={row.taskId}
            row={row}
            copy={copy}
            last={index === rows.length - 1}
            editable={editable}
            onCompleteNow={onCompleteNow}
          />
        ))}
      </ProviderCard>

      {/* ── What the approved screen does not depict ──────────────────────
          The reference is a READY application, so both of these render
          nothing in the state it shows. They are what a provider sees when
          the server says something is still missing, and dropping them to
          match a picture would have left a disabled button with no
          explanation — the exact defect the group model was built to fix. */}
      <GroupNotices
        group={byKind.get('BLOCKING')}
        copy={copy}
        tone="blocked"
        editable={editable}
        onCompleteNow={onCompleteNow}
      />
      <GroupNotices
        group={byKind.get('OPTIONAL')}
        copy={copy}
        tone="todo"
        editable={editable}
        onCompleteNow={onCompleteNow}
      />
    </div>
  );
}

function SummaryRow({
  row,
  copy,
  last,
  editable,
  onCompleteNow,
}: {
  row: ReviewRow;
  copy: ReviewCopy;
  last: boolean;
  editable: boolean;
  onCompleteNow: (taskId: string) => void;
}) {
  return (
    // `.hsm-summary-row`: `1fr auto`, 10px gap, `align-items: start`, 13px of
    // vertical padding and a hairline between rows but not under the last.
    <div
      className={`grid grid-cols-[1fr_auto] items-start gap-2.5 py-[13px] ${
        last ? '' : 'border-b border-pv-border'
      }`}
      data-testid={`review-row-${row.taskId}`}
    >
      {/* `text-pv-body` is load-bearing and is not about this text.
          The title below is 13px and INLINE, so the line box it sits in is the
          union of its own inline box and the STRUT — which takes the container's
          font size. The reference's container is 14px (the prototype wrapper's
          base) and ours is the browser's 16px, and the two produce line boxes
          that differ by about a pixel per row. Four rows of that is the 4px the
          panel was short.
          Declared here rather than on the shell, because the shell's base size
          is inherited by twenty-two cells that already measure correctly. */}
      <div className="min-w-0 text-pv-body">
        {/* 13px at weight 500 — `.hsm-summary-row strong` declares only the
            size, and the reference's own computed weight there is 500, not the
            `bolder` a bare `strong` would take from the UA. Left INLINE, as the
            reference has it: `display: block` would make the line box exactly
            21px and lose the half-leading the 14px strut contributes. */}
        <strong className="break-words text-pv-label font-medium text-pv-text">{row.title}</strong>
        {/* 12px muted, 3px below the title, on the 1.65 line height it inherits
            from `.hsm-panel p`. */}
        <p className="mt-[3px] break-words text-pv-help leading-[1.65] text-pv-muted">
          {row.value}
        </p>
      </div>

      {/* A badge where there is nothing to change, a pencil where there is.
          The specialty row is waiting on an admin: offering an edit control
          beside it would invite the provider to redo work that is already done
          and is not what is holding the application up. */}
      {row.waiting ? (
        <ProviderStatusBadge tone="waiting" shape="pill" label={copy.rowInReview} />
      ) : (
        // `.hsm-icon-action`: a 44x44 transparent square with a 12px radius.
        // The whole square is the target, not the 16px glyph inside it, and the
        // accessible name names the ROW — "Edit: Work area" — because four
        // buttons all called "Edit" are four identical stops for a screen
        // reader user moving through the panel.
        <button
          type="button"
          onClick={() => onCompleteNow(row.taskId)}
          disabled={!editable}
          aria-label={`${copy.editRow}: ${row.title}`}
          data-testid={`review-edit-${row.taskId}`}
          className="grid h-11 w-11 place-items-center rounded-xl text-pv-muted hover:bg-pv-surface-sunken disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
        >
          <Pencil size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** A server group, as notices. Renders nothing for a group the server omitted
 *  or sent empty, which is what the approved ready state produces. */
function GroupNotices({
  group,
  copy,
  tone,
  editable,
  onCompleteNow,
}: {
  group: ReviewGroup | undefined;
  copy: ReviewCopy;
  tone: 'blocked' | 'todo';
  editable: boolean;
  onCompleteNow: (taskId: string) => void;
}) {
  if (!group || group.items.length === 0) return null;
  const headingId = `review-group-${group.kind.toLowerCase()}`;

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-2">
      {/* The heading stays in the accessibility tree but off the screen: the
          approved design has no section titles here, and a provider reading a
          single amber card does not need "Needs your attention" written above
          it. A screen-reader user moving by landmark still gets the grouping. */}
      <h3 id={headingId} className="sr-only">
        {group.kind === 'BLOCKING' ? copy.groupBlocking : copy.groupOptional}
      </h3>
      <ul className="grid min-w-0 gap-2 p-0" data-testid={`review-group-${group.kind}`}>
        {group.items.map((item) => (
          <li key={item.id} className="min-w-0 list-none">
            <ProviderNotice
              tone={tone}
              title={
                group.kind === 'BLOCKING'
                  ? blockerLine(copy, item.field, item.code)
                  : copy.optionalPortfolioEmpty
              }
              actionLabel={item.taskId && editable ? copy.completeNow : undefined}
              onAction={
                item.taskId && editable ? () => onCompleteNow(item.taskId as string) : undefined
              }
              data-testid={
                group.kind === 'BLOCKING'
                  ? `review-blocking-${item.field ?? item.code}`
                  : `review-optional-${item.code}`
              }
              actionTestId={
                group.kind === 'BLOCKING'
                  ? `review-complete-now-${item.field ?? item.code}`
                  : `review-optional-link-${item.code}`
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Screen 12: consent and submission ──────────────────────────────────────

function ConsentScreen({
  review,
  copy,
  editable,
  conflict,
  acceptPending,
  onAcceptTerms,
}: {
  review: ProviderOnboardingReview;
  copy: ReviewCopy;
  editable: boolean;
  conflict: boolean;
  acceptPending: boolean;
  onAcceptTerms: () => void;
}) {
  const accepted = review.terms.accepted;
  const versionId = 'terms-version-line';

  return (
    <div className="grid gap-[18px]" data-testid="terms-section">
      {/* `.hsm-alert-success`. It says what the provider has achieved AND what
          is still somebody else's — that moderation continues after submission
          — so "ready" cannot be read as "approved". */}
      <OnboardingAlert
        tone="success"
        icon={ShieldCheck}
        title={copy.readyTitle}
        body={copy.readyBody}
        density="compact"
        data-testid="terms-ready"
      />

      {/* `.hsm-consent`: a real `<label>` wrapping a real checkbox, so the
          whole 358px row is the target and the sentence is the accessible name.
          The 20px box with the UA's own side margins is what the reference
          measures, which is why no reset is applied to it here. */}
      <label
        className="flex items-start gap-2.5 rounded-xl border border-pv-border bg-pv-surface p-3.5 text-pv-label leading-[1.6]"
        data-testid="terms-consent"
      >
        <input
          type="checkbox"
          checked={accepted}
          // Controlled, and a transition the server has no command for is
          // simply not made: there is no "un-accept" endpoint, so unchecking
          // snaps back rather than pretending to revoke a recorded agreement.
          onChange={() => {
            if (!accepted) onAcceptTerms();
          }}
          disabled={!editable || acceptPending}
          aria-describedby={versionId}
          data-testid="terms-accept"
          className="mt-0.5 h-5 w-5 accent-pv-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
          style={{ marginInlineStart: '4px', marginInlineEnd: '3px' }}
        />
        <span className="min-w-0">
          <strong className="break-words font-medium text-pv-text">{copy.consentLabel}</strong>
          <br />
          {/* The wording carries the SERVER's version. A version the client
              picked would let the screen display one document while the server
              recorded agreement to another. */}
          {/* `font-normal` explicitly: the base layer gives a `<label>` weight
              500 and everything inside it inherits that, so `.hsm-help`'s 400
              had to be asked for rather than assumed. */}
          <span
            id={versionId}
            className="break-words text-pv-help font-normal leading-[1.6] text-pv-muted"
            data-testid={accepted ? 'terms-accepted' : 'terms-body'}
          >
            {copy.consentVersion(review.terms.version)}
          </span>
        </span>
      </label>

      {/* Announced, not drawn silently: a provider who agreed to v1 has not
          agreed to v2, and the screen has to say why the tick went away. */}
      {!accepted && review.terms.acceptedVersion !== null ? (
        <p
          className="break-words text-pv-help text-pv-blocked"
          data-testid="terms-stale"
          role="status"
          aria-live="polite"
        >
          {copy.termsStale}
        </p>
      ) : null}

      {/* `.hsm-panel`: what submitting costs. The reference puts it here rather
          than after the fact, which is the only place it can change a
          decision. */}
      <ProviderCard className="p-4" style={{ borderRadius: 14 }} data-testid="terms-after-submit">
        <h3
          className="break-words text-pv-input text-pv-text"
          style={{ marginBottom: 5, fontWeight: 500, lineHeight: 1.25 }}
        >
          {copy.afterSubmitTitle}
        </h3>
        <p className="break-words text-pv-label leading-[1.65] text-pv-muted">
          {copy.afterSubmitBody}
        </p>
      </ProviderCard>

      {/* ── Not depicted, and load-bearing ───────────────────────────────
          The reference shows a submittable application. These two lines are
          what the provider gets when it is not, and the first of them is the
          reason a disabled primary action is never a bare greyed-out
          control. */}
      {conflict ? (
        <p
          className="break-words text-pv-help text-pv-danger"
          data-testid="review-conflict"
          role="alert"
        >
          {copy.conflict}
        </p>
      ) : null}

      {!review.canSubmit && review.blockedReason ? (
        <p
          className="break-words text-pv-help text-pv-blocked"
          data-testid="review-blocked-reason"
          role="status"
          aria-live="polite"
        >
          <span className="font-bold">{copy.blockedPrefix} </span>
          {blockerLine(copy, review.blockedReason.field, review.blockedReason.code)}
        </p>
      ) : null}
    </div>
  );
}

// ─── Screen 13: the confirmation ────────────────────────────────────────────

function SubmittedConfirmation({ review, lang }: { review: ProviderOnboardingReview; lang: Lang }) {
  const copy = REVIEW_COPY[lang];
  const draft = useOnboardingDraft();
  const profile = useProviderProfile();

  // The SERVER's record of when it was handed in, in the provider's own zone.
  // Formatted here rather than sent as prose, and omitted entirely when the
  // server has not told us — a fabricated time under "Submitted" would be the
  // one line on this screen a provider might quote back to us.
  const submittedAt = profile.data?.profile.submittedForReviewAt ?? null;
  const zone = draft.data?.data.timezone ?? draft.data?.data.resolvedTimezone.resolved ?? undefined;
  const when = submittedAt ? describeSubmission(submittedAt, zone, lang, copy) : null;

  const steps: OnboardingTimelineStep[] = [
    { id: 'submitted', title: copy.stepSubmitted, detail: when, tone: 'done' },
    {
      id: 'under-review',
      title: copy.stepUnderReview,
      detail: copy.stepUnderReviewNow,
      tone: 'current',
    },
    {
      id: 'activation',
      title: copy.stepActivation,
      // No visible detail in the reference; the hollow ring is the statement.
      srDetail: copy.stepActivationDetail,
      tone: 'pending',
    },
  ];

  return (
    // `.hsm-center`: `align-content: center` in a box whose height the shell
    // resolves, with the reference's own 28px top gutter and a 16px column gap.
    // 31px at the bottom rather than the reference's 110px — its sticky bar is
    // absolutely positioned and overlaps this area, ours is a flex sibling and
    // does not. Both arrive at the same 638px centring box.
    <div
      className="grid flex-1 text-center"
      style={{ alignContent: 'center', gap: 16, padding: '28px 20px 31px' }}
      data-testid="review-submitted"
      role="status"
      aria-live="polite"
    >
      {/* `.hsm-center-icon`: 72px, radius 24, on the soft accent with the STRONG
          accent as its foreground. `margin: auto` rather than centring the grid,
          because the reference stretches every other child to the full column
          and centres only this one. */}
      <span
        className="flex items-center justify-center bg-pv-accent-subtle text-pv-accent-hover"
        style={{ width: '72px', height: '72px', borderRadius: 24, margin: 'auto' }}
        aria-hidden="true"
        data-testid="submitted-icon"
      >
        <Send size={16} strokeWidth={1.8} />
      </span>

      {/* `<h2>`, not the reference's `<h1>`: the shell's header already owns the
          page's h1, and skipping a level to match a tag name would break the
          heading order for no visual difference. Weight 500 — `.hsm-center h1`
          declares none and takes the prototype wrapper's medium. */}
      <h2
        className="break-words text-pv-hero text-pv-text"
        style={{ fontWeight: 500, lineHeight: 1.4 }}
      >
        {copy.sentHeading}
      </h2>

      {/* No width cap. The reference paragraph is the full column, and a
          `max-w-[46ch]` here broke its lines earlier than the reference does. */}
      <p className="break-words text-pv-body text-pv-muted" style={{ lineHeight: 1.8 }}>
        {copy.sentLead}
      </p>

      {/* Where the application actually is. The old surface said "submitted"
          and stopped, which left the provider to guess whether anything else
          was expected of them. */}
      <OnboardingTimeline steps={steps} data-testid="submitted-timeline" />

      {/* Said once, for a screen reader, when the server has told us the
          application can be pulled back. There is no control for it on the
          approved screen — withdrawal lives on the status centre — so this
          does not offer one. */}
      {review.canWithdraw ? <span className="sr-only">{copy.afterSubmitBody}</span> : null}
    </div>
  );
}

/**
 * "Today • 12:43", or a date when it was not today.
 *
 * In the PROVIDER's timezone, not the browser's: a provider in Aleppo who
 * submitted at lunchtime should not read a morning time because their phone is
 * reporting UTC. "Today" is only said when it is genuinely today in that same
 * zone, so the two halves of the sentence cannot disagree.
 */
function describeSubmission(
  iso: string,
  zone: string | undefined,
  lang: Lang,
  copy: ReviewCopy,
): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const locale = lang === 'ar' ? 'ar-EG' : 'en-GB';
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  }).format(at);

  const day = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: zone,
    }).format(value);

  if (day(at) === day(new Date())) return copy.submittedAt(time);

  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  }).format(at);
  return `${date} • ${time}`;
}

/** A 409 means the draft moved under us — the one error the provider can act
 *  on, by rereading. Everything else is left to the global error surface. */
function isConflict(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  return status === 409;
}
