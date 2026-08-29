import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Check, Clock, Lightbulb } from 'lucide-react';
import type {
  ProviderOnboardingReview,
  ReviewGroup,
  ReviewItem,
} from '@homeservicemarketplace/contracts';

import {
  useAcceptTerms,
  useOnboardingReview,
  useSubmitApplication,
} from '../../../hooks/provider/useProviderOnboardingReview';
import {
  REVIEW_COPY,
  blockerLine,
  formatCount,
  type Lang,
  type ReviewCopy,
} from '../copy/review-copy';

// Sprint 9B.23 — V2 Task 6: review, terms, and submission.
//
// docs/sprint-09b23/REVIEW_AND_SUBMIT.md
//
// THIS SCREEN DECIDES NOTHING.
//
// It renders `groups` in the order the server sends them, disables the button
// on the server's `canSubmit`, and shows the server's `blockedReason` as the
// one next action. It does not count blockers, does not evaluate completeness
// and does not infer readiness from what it can see — the rules live in
// `evaluateOnboarding()`, and a second copy here would be a second policy.
//
// WHAT REPLACED WHAT
//
// The old surface was nine repeated summary cards with red validation text
// scattered through them: everything looked equally wrong, nothing said what
// to do first, and a provider could read the whole screen without learning
// which single thing was blocking them. This is four groups with one verb —
// BLOCKING carries a deep link, OPTIONAL is advice, WAITING is somebody else's
// queue, COMPLETE is reassurance — and one named next action beside the button.

interface ReviewTaskScreenProps {
  review: ProviderOnboardingReview;
  lang: Lang;
  /** False once the application is in a state that no longer accepts edits. */
  editable: boolean;
  onCompleteNow: (taskId: string) => void;
  onAcceptTerms: () => void;
  onSubmit: () => void;
  acceptPending: boolean;
  submitPending: boolean;
  /** A 409 from either write: the draft moved under us. */
  conflict: boolean;
}

const groupOrder: ReadonlyArray<ReviewGroup['kind']> = [
  'BLOCKING',
  'WAITING',
  'OPTIONAL',
  'COMPLETE',
];

export function ReviewTaskScreen({
  review,
  lang,
  editable,
  onCompleteNow,
  onAcceptTerms,
  onSubmit,
  acceptPending,
  submitPending,
  conflict,
}: ReviewTaskScreenProps) {
  const copy = REVIEW_COPY[lang];

  const submitted =
    review.lifecycleState === 'SUBMITTED' || review.lifecycleState === 'DOCUMENTS_REQUIRED';

  const byKind = new Map(review.groups.map((g) => [g.kind, g]));

  if (submitted) {
    return (
      <div className="flex min-w-0 flex-col gap-3" data-testid="review-submitted">
        <div
          className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950"
          role="status"
          aria-live="polite"
        >
          <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
            <Check size={16} className="text-emerald-700 dark:text-emerald-400" />
          </span>
          <div className="min-w-0">
            <p
              className="break-words text-emerald-900 dark:text-emerald-200"
              style={{ fontSize: '13px', fontWeight: 600 }}
            >
              {copy.submitted}
            </p>
            {/* Says out loud that this grants nothing. A provider who reads
                "submitted" and assumes they can start working has been misled
                by the absence of a sentence. */}
            <p
              className="mt-1 break-words text-emerald-800 dark:text-emerald-300"
              style={{ fontSize: '12px' }}
            >
              {copy.submittedBody}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="review-screen">
      <p className="break-words text-slate-500 dark:text-slate-400" style={{ fontSize: '13px' }}>
        {copy.intro}
      </p>

      {/* ── the groups ─────────────────────────────────────────────────── */}
      {groupOrder.map((kind) => {
        const group = byKind.get(kind);
        if (!group || group.items.length === 0) return null;
        return (
          <GroupSection
            key={kind}
            group={group}
            copy={copy}
            lang={lang}
            editable={editable}
            onCompleteNow={onCompleteNow}
          />
        );
      })}

      {/* ── terms ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="terms-heading" className="min-w-0">
        <h3
          id="terms-heading"
          className="break-words text-slate-900 dark:text-slate-100"
          style={{ fontSize: '13px', fontWeight: 600 }}
        >
          {copy.termsHeading}
        </h3>

        {/* The wording carries the SERVER's version. Showing a version the
            client picked would let the screen display one document while the
            server recorded agreement to another. */}
        <p
          className="mt-1 break-words text-slate-600 dark:text-slate-300"
          style={{ fontSize: '12px' }}
          data-testid="terms-body"
        >
          {copy.termsBody(review.terms.version)}
        </p>

        {review.terms.accepted ? (
          <p
            className="mt-2 flex items-center gap-1.5 break-words text-emerald-700 dark:text-emerald-400"
            style={{ fontSize: '12px' }}
            data-testid="terms-accepted"
          >
            <Check size={14} aria-hidden="true" />
            {copy.termsAccepted(review.terms.version)}
          </p>
        ) : (
          <>
            {review.terms.acceptedVersion !== null ? (
              <p
                className="mt-2 break-words text-amber-700 dark:text-amber-400"
                style={{ fontSize: '12px' }}
                data-testid="terms-stale"
                role="status"
                aria-live="polite"
              >
                {copy.termsStale}
              </p>
            ) : null}
            <div className="mt-2">
              <button
                type="button"
                onClick={onAcceptTerms}
                disabled={!editable || acceptPending}
                data-testid="terms-accept"
                className="w-full rounded-xl border border-indigo-300 px-3 text-indigo-700 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300"
                style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
              >
                {copy.termsAccept}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── the sticky action container ────────────────────────────────── */}
      {/* STICKY, not fixed, and the difference is the point.
          `position: fixed` is taken out of flow, so it sits ON TOP of the last
          rows and — on iOS — is shoved upward by the on-screen keyboard, which
          is exactly the "covering content / fighting the keyboard" this task
          names. A sticky element participates in layout: content scrolls under
          it only while there is more to scroll, the last row is always
          reachable, and the keyboard pushes the viewport rather than the bar.
          The bottom inset keeps it clear of the home indicator. */}
      <div
        className="sticky z-10 -mx-4 border-t border-slate-100 bg-white px-4 pt-3 dark:border-slate-700 dark:bg-slate-800"
        style={{
          bottom: 0,
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
        }}
        data-testid="review-action-bar"
      >
        {conflict ? (
          <p
            className="mb-2 break-words text-rose-600"
            style={{ fontSize: '12px' }}
            data-testid="review-conflict"
            role="alert"
          >
            {copy.conflict}
          </p>
        ) : null}

        {/* The ONE next action, from the server. A disabled button that cannot
            say why is the defect this replaces, so this line is rendered
            whenever the button is disabled — never a bare greyed-out control. */}
        {!review.canSubmit && review.blockedReason ? (
          <p
            className="mb-2 break-words text-amber-700 dark:text-amber-400"
            style={{ fontSize: '12px' }}
            data-testid="review-blocked-reason"
            role="status"
            aria-live="polite"
          >
            <span style={{ fontWeight: 600 }}>{copy.blockedPrefix} </span>
            {blockerLine(copy, review.blockedReason.field, review.blockedReason.code)}
          </p>
        ) : null}

        {/* A REAL disabled attribute, not a styled-off div: it removes the
            control from the tab order and screen readers announce it as
            unavailable. The reason is rendered above, so "unavailable" is
            never the only thing the provider learns. */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!review.canSubmit || !editable || submitPending}
          data-testid="review-submit"
          className="w-full rounded-xl bg-indigo-600 px-3 text-white disabled:opacity-50"
          style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
        >
          {submitPending ? copy.submitting : copy.submit}
        </button>
      </div>
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function GroupSection({
  group,
  copy,
  lang,
  editable,
  onCompleteNow,
}: {
  group: ReviewGroup;
  copy: ReviewCopy;
  lang: Lang;
  editable: boolean;
  onCompleteNow: (taskId: string) => void;
}) {
  const heading =
    group.kind === 'BLOCKING'
      ? copy.groupBlocking
      : group.kind === 'OPTIONAL'
        ? copy.groupOptional
        : group.kind === 'WAITING'
          ? copy.groupWaiting
          : copy.groupComplete;

  const headingId = `review-group-${group.kind.toLowerCase()}`;

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h3
        id={headingId}
        className="break-words text-slate-900 dark:text-slate-100"
        style={{ fontSize: '13px', fontWeight: 600 }}
      >
        {heading}
      </h3>
      <ul className="mt-2 flex min-w-0 flex-col gap-2" data-testid={`review-group-${group.kind}`}>
        {group.items.map((item) => (
          <li key={item.id} className="min-w-0">
            <GroupItem
              item={item}
              kind={group.kind}
              copy={copy}
              lang={lang}
              editable={editable}
              onCompleteNow={onCompleteNow}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GroupItem({
  item,
  kind,
  copy,
  lang,
  editable,
  onCompleteNow,
}: {
  item: ReviewItem;
  kind: ReviewGroup['kind'];
  copy: ReviewCopy;
  lang: Lang;
  editable: boolean;
  onCompleteNow: (taskId: string) => void;
}) {
  if (kind === 'COMPLETE') {
    return (
      <p
        className="flex items-center gap-1.5 break-words text-slate-600 dark:text-slate-300"
        style={{ fontSize: '12px' }}
        data-testid={`review-complete-${item.step}`}
      >
        {/* aria-hidden: the tick is decoration. The row already reads as
            complete because it is under the "Done" heading, and a screen
            reader announcing "check mark" adds nothing. */}
        <Check size={14} className="flex-shrink-0 text-emerald-600" aria-hidden="true" />
        {item.step ? (copy.stepLabel[item.step] ?? item.step) : ''}
      </p>
    );
  }

  if (kind === 'WAITING') {
    const count = formatCount(item.count ?? 0, lang);
    const line =
      item.code === 'SPECIALTY_REVIEW'
        ? copy.waitingSpecialties(count)
        : copy.waitingPortfolio(count);
    return (
      <div
        className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
        data-testid={`review-waiting-${item.code}`}
      >
        <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
          <Clock size={16} className="text-slate-500" />
        </span>
        {/* Informational, not an error: there is no action, so there is no
            button. A "Complete now" on somebody else's queue would be a lie. */}
        <p
          className="min-w-0 break-words text-slate-600 dark:text-slate-300"
          style={{ fontSize: '12px' }}
        >
          {line}
        </p>
      </div>
    );
  }

  if (kind === 'OPTIONAL') {
    return (
      <div
        className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
        data-testid={`review-optional-${item.code}`}
      >
        <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
          <Lightbulb size={16} className="text-slate-500" />
        </span>
        <div className="min-w-0">
          {/* Neutral on purpose. Amber here would make a suggestion look like
              a requirement, and a provider who fixes everything amber and
              still cannot submit has been misled. */}
          <p
            className="break-words text-slate-600 dark:text-slate-300"
            style={{ fontSize: '12px' }}
          >
            {copy.optionalPortfolioEmpty}
          </p>
          {item.taskId && editable ? (
            <button
              type="button"
              className="mt-1 rounded text-blue-700 underline dark:text-blue-400"
              style={{ fontSize: '12px' }}
              onClick={() => onCompleteNow(item.taskId as string)}
              data-testid={`review-optional-link-${item.code}`}
            >
              {copy.completeNow}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // BLOCKING
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
      data-testid={`review-blocking-${item.field ?? item.code}`}
    >
      <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
        <AlertTriangle size={16} className="text-amber-700 dark:text-amber-400" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-amber-900 dark:text-amber-200" style={{ fontSize: '12px' }}>
          {blockerLine(copy, item.field, item.code)}
        </p>
        {item.taskId ? (
          <button
            type="button"
            className="mt-1.5 rounded border border-amber-400 px-2 py-1 text-amber-900 dark:border-amber-700 dark:text-amber-200"
            style={{ fontSize: '12px', minHeight: '32px' }}
            onClick={() => onCompleteNow(item.taskId as string)}
            disabled={!editable}
            data-testid={`review-complete-now-${item.field ?? item.code}`}
          >
            {copy.completeNow}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Container ──────────────────────────────────────────────────────────────

export function ReviewTask({ lang }: { lang: Lang }) {
  const copy = REVIEW_COPY[lang];
  const navigate = useNavigate();
  const query = useOnboardingReview(lang);
  const accept = useAcceptTerms();
  const submit = useSubmitApplication();
  const [conflict, setConflict] = useState(false);

  if (query.isPending) {
    return (
      <div className="flex justify-center py-10" role="status" aria-live="polite">
        <span className="sr-only">{copy.heading}</span>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col items-start gap-2" data-testid="review-load-failed">
        <p className="break-words text-rose-600" style={{ fontSize: '13px' }}>
          {copy.loadFailed}
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          data-testid="review-retry"
          className="rounded-xl border border-indigo-300 px-3 text-indigo-700 dark:border-indigo-700 dark:text-indigo-300"
          style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
        >
          {copy.retry}
        </button>
      </div>
    );
  }

  const review = query.data;
  const editable =
    review.lifecycleState !== 'SUBMITTED' &&
    review.lifecycleState !== 'DOCUMENTS_REQUIRED' &&
    review.lifecycleState !== 'ACCEPTED';

  const onAcceptTerms = () => {
    setConflict(false);
    accept.mutate(
      { draftVersion: review.draftVersion, termsVersion: review.terms.version },
      { onError: (err) => setConflict(isConflict(err)) },
    );
  };

  const onSubmit = async () => {
    setConflict(false);

    // REFRESH READINESS FIRST, and submit against what comes back.
    //
    // The review on screen may be seconds or minutes old — another tab could
    // have edited the draft, or an operator could have published new terms.
    // Submitting the version we rendered would hand the server a token it has
    // to reject, and the provider would see a 409 they did nothing to cause.
    const fresh = await query.refetch();
    const current = fresh.data;
    if (!current || !current.canSubmit) return;

    submit.mutate(
      { draftVersion: current.draftVersion },
      { onError: (err) => setConflict(isConflict(err)) },
    );
  };

  return (
    <ReviewTaskScreen
      review={review}
      lang={lang}
      editable={editable}
      onCompleteNow={(taskId) => navigate(`/provider/onboarding/${taskId}`)}
      onAcceptTerms={onAcceptTerms}
      onSubmit={() => void onSubmit()}
      acceptPending={accept.isPending}
      submitPending={submit.isPending || query.isRefetching}
      conflict={conflict}
    />
  );
}

/** A 409 means the draft moved under us — the one error the provider can act
 *  on, by rereading. Everything else is left to the global error surface. */
function isConflict(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  return status === 409;
}
