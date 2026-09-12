import { Check, Clock } from 'lucide-react';

// Sprint 09B.29 Phase 5A — the approved prototype's `.hsm-timeline`.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
//
// WHY IT IS NOT `ProviderStatusTimeline`
//
// The workspace already has a timeline, and it is a different object. Measured
// against the reference it differs in every dimension that matters here: a 28px
// dot in a flex column against a 22px dot in a 28px grid track, a 1px hairline
// connector against a 2px one that starts 24px down, a 20px row gap against a
// 62px minimum row height, and a 14px semibold title against a 13px medium one.
//
// Retuning the workspace component to these numbers would have changed a
// surface this phase is not redesigning, so this is the onboarding rendering —
// the same reason `OnboardingAlert` exists beside `ProviderNotice`.
//
// WHAT THE SHAPE SAYS
//
// Three states, and the difference between them is the whole point of the
// screen: a filled tick for what has happened, a tinted ring for where the
// application is now, and a hollow ring for a step nobody has reached. The last
// one is how the approved confirmation says that handing an application in is
// not the same as being allowed to work (ADR 0005) — so `srDetail` exists to
// say that in words for somebody who cannot see the ring.

export type OnboardingTimelineTone = 'done' | 'current' | 'pending';

/** `.hsm-dot`, `.hsm-dot-done`, `.hsm-dot-current`. */
const DOT: Record<OnboardingTimelineTone, string> = {
  done: 'border-pv-done bg-pv-done text-white',
  current: 'border-pv-waiting bg-pv-waiting-bg text-pv-waiting',
  pending: 'border-pv-border-strong bg-pv-surface',
};

/** The prototype draws a glyph in the first two and leaves the third empty. */
const DOT_ICON: Record<OnboardingTimelineTone, typeof Check | null> = {
  done: Check,
  current: Clock,
  pending: null,
};

export interface OnboardingTimelineStep {
  id: string;
  title: string;
  /** The 11px line beneath the title. */
  detail?: string | null;
  /**
   * Said only to a screen reader.
   *
   * For facts the approved design carries in the SHAPE of a step rather than in
   * its words. Never use it for something a sighted provider also needs to
   * read — that belongs in `detail`, where it costs pixels honestly.
   */
  srDetail?: string | null;
  tone: OnboardingTimelineTone;
}

export function OnboardingTimeline({
  steps,
  'data-testid': testId,
}: {
  steps: readonly OnboardingTimelineStep[];
  'data-testid'?: string;
}) {
  return (
    // An ordered list, because it is one: the steps happen in this sequence and
    // a screen reader should say "3 of 3" rather than leaving the provider to
    // infer how much is left from three unrelated paragraphs.
    <ol className="grid list-none gap-0 p-0" data-testid={testId}>
      {steps.map((step, index) => {
        const Icon = DOT_ICON[step.tone];
        const last = index === steps.length - 1;
        return (
          <li
            key={step.id}
            className="grid min-h-[62px] grid-cols-[28px_1fr] gap-2.5"
            data-testid={`timeline-step-${step.id}`}
            data-tone={step.tone}
          >
            {/* `.hsm-timeline-mark`: a 28px track that centres its dot and
                carries the connector behind it. */}
            <span className="relative grid justify-items-center">
              {/* `top: 24px; bottom: 0` — it starts just past the 22px dot and
                  runs to the bottom of the row, which is what makes the line
                  continuous through a row whose text wrapped onto two lines.
                  Omitted on the last step rather than hidden, so no stray
                  2px stub can survive a later change. */}
              {!last ? (
                <span aria-hidden="true" className="absolute bottom-0 top-6 w-0.5 bg-pv-border" />
              ) : null}
              {/* `z-index: 1`, so the dot covers the connector rather than
                  letting a 2px line show through its fill. */}
              <span
                aria-hidden="true"
                className={`relative z-[1] grid h-[22px] w-[22px] place-items-center rounded-full border-2 ${DOT[step.tone]}`}
              >
                {/* 16px. The prototype's markup asks for 12 and its pinned
                    lucide build substitutes an `<svg>` without carrying the
                    requested size across, so every icon in the reference
                    resolves to 16 whatever it asked for. */}
                {Icon ? <Icon size={16} strokeWidth={1.8} /> : null}
              </span>
            </span>

            {/* Text alignment is INHERITED. The confirmation screen centres its
                whole column and the status centre does not; the reference
                timeline declares no alignment of its own either way. */}
            <div className="min-w-0">
              {/* `.hsm-timeline-row strong`: 13px, weight 500, a 21px line box
                  and `display: block`. */}
              <strong className="block break-words text-pv-label font-medium text-pv-text">
                {step.title}
              </strong>
              {/* `.hsm-timeline-row small`: 11px muted on the 16px line box a
                  `<small>` inherits in the approved design — NOT the 21px the
                  shell sets, which is why the leading is explicit. */}
              {step.detail ? (
                <small className="block break-words text-pv-caption font-normal leading-4 text-pv-muted">
                  {step.detail}
                </small>
              ) : null}
              {step.srDetail ? <span className="sr-only">{step.srDetail}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
