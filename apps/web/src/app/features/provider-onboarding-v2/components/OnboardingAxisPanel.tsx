import { ProviderStatusBadge } from '../../provider-ui';
import type { ProviderTone } from '../../provider-ui/status';

// Sprint 09B.29 Phase 5A — the approved prototype's `.hsm-axis`.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
// docs/adr/0005-provider-lifecycle-axes.md
//
// FOUR ANSWERS, NEVER ONE.
//
// ADR 0005 says application completion, account standing, verification and work
// access are INDEPENDENT, and the single reason this panel exists is that a
// provider cannot be told the truth about them in one sentence. "Pending
// review" — the line the V1 status screen showed — collapses all four, and a
// provider reading it cannot tell whether they are waiting on us, on a
// specialty decision, or on nothing at all.
//
// Each row is a server fact and a badge. Nothing here decides an axis; the
// caller passes what the server said, and a row it has no answer for is not
// rendered rather than guessed at.

export interface OnboardingAxisRow {
  id: string;
  label: string;
  /** The word. Never colour alone — the badge carries both. */
  status: string;
  tone: ProviderTone;
}

export function OnboardingAxisPanel({
  rows,
  'data-testid': testId,
}: {
  rows: readonly OnboardingAxisRow[];
  'data-testid'?: string;
}) {
  return (
    // `.hsm-axis`: an 8px grid on the surface, 14px padding, 12px radius, and
    // `text-align: start` declared explicitly — the active handoff centres its
    // whole column, and this panel must not inherit that. A centred pair of
    // label and badge would stop reading as a table of answers.
    <dl
      className="grid gap-2 rounded-xl border border-pv-border bg-pv-surface p-3.5 text-start"
      data-testid={testId}
    >
      {rows.map((row) => (
        // `.hsm-axis-row`: `1fr auto`, 8px gap, centred, 12px type. A
        // description list, because that is what it is — four terms and their
        // current values — and it gives a screen reader the pairing for free.
        <div
          key={row.id}
          className="grid grid-cols-[1fr_auto] items-center gap-2"
          data-testid={`axis-${row.id}`}
          data-tone={row.tone}
        >
          <dt className="min-w-0 break-words text-pv-help text-pv-text">{row.label}</dt>
          <dd className="m-0">
            <ProviderStatusBadge tone={row.tone} shape="pill" label={row.status} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
