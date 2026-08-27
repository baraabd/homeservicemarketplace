import type { AdminWorkAccessStatus } from '@homeservicemarketplace/contracts';

import { useLang } from '../../../i18n/LanguageContext';
import { UI } from '../copy/verification-copy';

// Sprint 9B.12 — whether this provider can take work right now.
//
// A separate panel from the case state on purpose. "Case: VERIFIED" and "can
// take work" are different facts (ADR 0013): a verified provider whose grant
// lapsed or was revoked cannot work, and a reviewer reading only the case state
// would revoke something that is already gone — or decline to, believing it
// still live.
//
// `active` is the SERVER's computed answer, not the status column. A grant
// whose expiry has passed reports inactive even though no sweep has relabelled
// it; showing the raw column would show "ACTIVE" for access that has ended.

export interface WorkAccessPanelProps {
  workAccess: AdminWorkAccessStatus | null;
}

export function WorkAccessPanel({ workAccess }: WorkAccessPanelProps) {
  const { lang, dir } = useLang();
  const t = UI[lang];

  return (
    <section aria-label={t.workAccess} dir={dir} data-testid="work-access" className="space-y-1">
      <h4 className="text-sm font-semibold">{t.workAccess}</h4>

      {workAccess === null ? (
        <p data-testid="work-access-none" className="text-sm text-slate-600 dark:text-slate-300">
          {t.workAccessNone}
        </p>
      ) : (
        <dl className="text-sm">
          <div className="flex gap-2">
            <dt className="font-semibold">{t.workAccess}</dt>
            {/* The value is in the TEXT, not only a colour — this is the answer
                a reviewer acts on, and a green dot says nothing to a screen
                reader. */}
            <dd data-testid="work-access-state" data-active={workAccess.active ? 'true' : 'false'}>
              {workAccess.active ? t.workAccessActive : t.workAccessInactive}
            </dd>
          </div>
          {workAccess.source && (
            <div className="flex gap-2">
              <dt className="font-semibold">{t.workAccessSource}</dt>
              {/* MANUAL_OVERRIDE vs VERIFIED_DOCUMENTS is the difference
                  between access someone was GIVEN and access they EARNED, and
                  ADR 0013 requires it to stay visible. */}
              <dd data-testid="work-access-source">{workAccess.source}</dd>
            </div>
          )}
          {workAccess.expiresAt && (
            <div className="flex gap-2">
              <dt className="font-semibold">{t.workAccessExpires}</dt>
              <dd data-testid="work-access-expires">
                {new Date(workAccess.expiresAt).toLocaleDateString(lang)}
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
