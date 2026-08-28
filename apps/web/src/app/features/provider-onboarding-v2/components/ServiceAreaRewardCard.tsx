import { Lock, Check, Circle } from 'lucide-react';
import type {
  ProviderExpansionCriterionView,
  ProviderServiceAreaExpansionView,
} from '@homeservicemarketplace/contracts';

import type { ServiceAreaCopy } from '../copy/service-area-copy';

// Sprint 9B.20 — the earned service-area reward card.
//
// docs/sprint-09b20/EARNED_SERVICE_AREA.md
//
// THIS COMPONENT CONTAINS NO ELIGIBILITY LOGIC, and that is the point of it.
//
// It does not decide whether to show itself, what tier the provider holds,
// whether a criterion is met, or what the ceiling is. Every one of those
// arrives from the server as a resolved answer. A formula in React would be a
// second copy of the rules that nobody could audit, that every provider could
// read out of the bundle, and that would disagree with the server the first
// time an operator published a different ladder.
//
// What it does contain is the refusal to promise anything. A wider radius is
// permission, not work — see the copy file.

interface ServiceAreaRewardCardProps {
  /** Optional on purpose. This block is NEW, and a client can be handed a
   *  draft that predates it — a cached response, a rolling deploy, an older
   *  API. An absent block must read as "do not show", not crash the screen the
   *  provider is trying to finish. */
  expansion: ProviderServiceAreaExpansionView | undefined;
  copy: ServiceAreaCopy;
}

export function ServiceAreaRewardCard({ expansion, copy }: ServiceAreaRewardCardProps) {
  // The server said no, or said nothing at all. Neither is an invitation to
  // guess: with no answer there is no card.
  if (expansion === undefined || !expansion.show) return null;

  const unlocked = expansion.currentTier !== null;
  const atTop = unlocked && expansion.nextTier === null;

  return (
    <section
      aria-labelledby="reward-heading"
      className="min-w-0 rounded-2xl border border-slate-200 p-3 dark:border-slate-700"
      data-testid="expansion-reward-card"
      data-state={unlocked ? 'unlocked' : 'locked'}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className={
            unlocked
              ? 'mt-0.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400'
              : 'mt-0.5 flex-shrink-0 text-slate-400'
          }
          aria-hidden="true"
        >
          {unlocked ? <Check size={18} /> : <Lock size={18} />}
        </span>
        <h2
          id="reward-heading"
          className="min-w-0 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
          data-testid="reward-title"
        >
          {unlocked ? copy.rewardUnlockedTitle(expansion.allowedMaxKm) : copy.rewardLockedTitle}
        </h2>
      </div>

      {/* The ONE benefit claim this feature makes, and it is qualified. */}
      <p
        className="mt-1 break-words text-slate-500 dark:text-slate-400"
        style={{ fontSize: '12px' }}
        data-testid="reward-benefit"
      >
        {copy.rewardBenefit}
      </p>
      {/* Said out loud rather than implied: earning a wider limit does not
          move the radius the provider chose, and nothing here will. */}
      <p
        className="mt-1 break-words text-slate-500 dark:text-slate-400"
        style={{ fontSize: '12px' }}
        data-testid="reward-no-obligation"
      >
        {copy.rewardNoObligation}
      </p>

      {expansion.nextTier !== null && (
        <p
          className="mt-2 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '13px', fontWeight: 600 }}
          data-testid="reward-next-tier"
        >
          {copy.rewardNextTier(expansion.nextTier.maxKm)}
        </p>
      )}
      {atTop && (
        <p
          className="mt-2 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
          data-testid="reward-at-top"
        >
          {copy.rewardAtTop}
        </p>
      )}

      {expansion.progress.length > 0 && (
        <>
          <h3
            className="mt-3 break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px', fontWeight: 600 }}
            id="reward-progress-heading"
          >
            {copy.rewardProgressLabel}
          </h3>
          <ul
            className="mt-1 flex min-w-0 flex-col gap-2"
            aria-labelledby="reward-progress-heading"
            data-testid="reward-progress-list"
          >
            {expansion.progress.map((criterion) => (
              <CriterionRow key={criterion.key} criterion={criterion} copy={copy} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CriterionRow({
  criterion,
  copy,
}: {
  criterion: ProviderExpansionCriterionView;
  copy: ServiceAreaCopy;
}) {
  const name = copy.criterionNames[criterion.key] ?? criterion.key;
  const status = criterion.met ? copy.rewardMet : copy.rewardNotMet;
  const value = describeValue(criterion, copy);

  return (
    <li
      className="flex min-w-0 items-start gap-2"
      data-testid={`reward-criterion-${criterion.key}`}
      data-met={criterion.met ? 'true' : 'false'}
    >
      {/* Colour is never the only carrier: the status word is real text, read
          out by a screen reader and visible to anyone who cannot tell the tick
          from the ring. */}
      <span
        className={
          criterion.met
            ? 'mt-0.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400'
            : 'mt-0.5 flex-shrink-0 text-slate-400'
        }
        aria-hidden="true"
      >
        {criterion.met ? <Check size={14} /> : <Circle size={14} />}
      </span>
      <span className="min-w-0 flex-1 break-words" style={{ fontSize: '13px' }}>
        <span className="text-slate-900 dark:text-white">{name}</span>
        {value !== null && (
          <span
            className="ms-1 text-slate-500 dark:text-slate-400"
            data-testid={`reward-criterion-value-${criterion.key}`}
          >
            {value}
          </span>
        )}
      </span>
      <span
        className="flex-shrink-0 text-slate-500 dark:text-slate-400"
        style={{ fontSize: '12px' }}
      >
        {status}
      </span>
    </li>
  );
}

/**
 * The "3 of 10" beside a criterion, or null when there is nothing to show.
 *
 * Null for every WITHHELD criterion — but note that this function is not what
 * withholds them. The server already sent `current: null, target: null` for
 * those; this only declines to render a pair that is not there. Doing the
 * redaction here instead would put the rule one refactor away from being
 * skipped, and would ship the thresholds in the bundle regardless.
 */
function describeValue(
  criterion: ProviderExpansionCriterionView,
  copy: ServiceAreaCopy,
): string | null {
  if (criterion.current === null || criterion.target === null) return null;
  if (criterion.key === 'RATING') {
    return copy.rewardRatingOf(criterion.current, criterion.target);
  }
  return copy.rewardCountOf(criterion.current, criterion.target);
}
