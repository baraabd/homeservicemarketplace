import { useId } from 'react';

import { ProviderButton, ProviderCard, ProviderNotice } from '../../provider-ui';
import type { AutosaveStatusKind } from '../autosave-status';
import { formatMinute, weekTotals, type Week } from '../availability/weekly-schedule';
import { AVAILABILITY_COPY, DAY_NAMES, type Lang } from '../copy/availability-copy';

/** Applied hours remain visible while saving, with their durability stated
 * explicitly. This is a projection of the editor/server week, never a second
 * readiness or persistence store. */
export function AvailabilityWeekSummary({
  week,
  lang,
  timezoneDisplay,
  status,
  hasApplied,
  hasUnappliedChanges,
}: {
  week: Week;
  lang: Lang;
  timezoneDisplay: { city: string; offset: string } | null;
  status: AutosaveStatusKind;
  hasApplied: boolean;
  hasUnappliedChanges: boolean;
}) {
  const headingId = useId();
  const copy = AVAILABILITY_COPY[lang];
  const totals = weekTotals(week);
  const pending = hasApplied && status.kind !== 'saved';
  const failure = status.kind === 'error' || status.kind === 'conflict';
  const feedback =
    status.kind === 'saved'
      ? copy.appliedSaved
      : status.kind === 'error'
        ? copy.appliedFailed
        : status.kind === 'conflict'
          ? copy.saveConflict
          : status.kind === 'offline'
            ? copy.appliedOffline
            : copy.appliedSaving;

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      {hasApplied ? (
        <div data-testid="availability-apply-feedback" data-state={status.kind}>
          <ProviderNotice
            tone={failure ? 'danger' : status.kind === 'saved' ? 'done' : 'waiting'}
            title={feedback}
            description={pending ? copy.summaryPending : undefined}
          />
          {status.kind === 'error' ? (
            <ProviderButton
              tone="secondary"
              size="block"
              shape="onboarding"
              onClick={status.retry}
              className="mt-2"
              data-testid="availability-apply-retry"
            >
              {copy.saveRetry}
            </ProviderButton>
          ) : null}
        </div>
      ) : null}
      {hasUnappliedChanges ? (
        <p
          className="text-pv-label text-pv-muted"
          role="status"
          data-testid="availability-unapplied"
        >
          {copy.unappliedChanges}
        </p>
      ) : null}

      <ProviderCard className="overflow-hidden" data-testid="availability-week-summary">
        <div className="grid gap-1 border-b border-pv-border p-4">
          <h3 id={headingId} className="text-pv-heading font-semibold text-pv-text">
            {copy.summaryLegend}
          </h3>
          <p className="text-pv-label text-pv-muted">
            {totals.dayCount === 0
              ? copy.summaryEmpty
              : copy.summaryTotals(
                  totals.dayCount,
                  new Intl.NumberFormat(lang, {
                    numberingSystem: 'latn',
                    maximumFractionDigits: 2,
                  }).format(totals.totalMinutes / 60),
                )}
          </p>
          {timezoneDisplay ? (
            <p className="text-pv-help text-pv-muted">
              {copy.timezoneResolved(timezoneDisplay.city, timezoneDisplay.offset)}
            </p>
          ) : null}
        </div>
        <table className="w-full table-fixed text-start" aria-labelledby={headingId}>
          <thead className="bg-pv-surface-sunken text-pv-muted">
            <tr>
              <th scope="col" className="w-2/5 px-4 py-2 text-start text-pv-label font-medium">
                {copy.summaryDay}
              </th>
              <th scope="col" className="px-4 py-2 text-start text-pv-label font-medium">
                {copy.summaryHours}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pv-border">
            {week.map((windows, day) => (
              <tr key={day} data-testid={`availability-summary-day-${day}`}>
                <th
                  scope="row"
                  className="px-4 py-3 text-start align-top text-pv-label font-medium text-pv-text"
                >
                  {DAY_NAMES[lang][day]}
                </th>
                <td className="px-4 py-3 align-top text-pv-label text-pv-text">
                  {windows.length === 0 ? (
                    <span className="text-pv-muted">{copy.unavailable}</span>
                  ) : (
                    <ul className="grid list-none gap-1 p-0">
                      {windows.map((window, index) => (
                        <li key={index}>
                          <bdi dir="ltr" className="tabular-nums">
                            {copy.windowRange(
                              formatMinute(window.startMinute),
                              formatMinute(window.endMinute),
                            )}
                          </bdi>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ProviderCard>
    </section>
  );
}
