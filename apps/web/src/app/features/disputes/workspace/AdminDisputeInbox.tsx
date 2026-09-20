import { useState } from 'react';
import { Link } from 'react-router';
import { DISPUTE_WORKSPACE_STATES } from '@homeservicemarketplace/contracts';
import { useLang } from '../../../i18n/LanguageContext';
import { CaseBadge, CaseDate, CaseEmpty, CaseNotice } from '../../case-ui/CasePrimitives';
import { DisputeSection } from '../../../components/admin/DisputesSection';
import { useAdminDisputeQueue } from './api';
import { WORKSPACE_COPY, WORKSPACE_STATES } from './copy';
import '../../case-ui/case-ui.css';
import '../../admin-provider-review/admin-review.css';
import './workspace.css';
const FILTER_KEY = 'hsm.dispute-queue-view.v1';
function savedFilter() {
  try {
    const value = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') as {
      state?: unknown;
      mine?: unknown;
    };
    return {
      state:
        typeof value.state === 'string' && DISPUTE_WORKSPACE_STATES.some((s) => s === value.state)
          ? value.state
          : '',
      mine: value.mine === true,
    };
  } catch {
    return { state: '', mine: false };
  }
}
export function AdminDisputeInbox() {
  const { lang, dir, darkMode } = useLang(),
    t = WORKSPACE_COPY[lang];
  const [filter, setFilter] = useState(savedFilter);
  const [saved, setSaved] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const query = useAdminDisputeQueue(filter.state, filter.mine);
  const rows = query.isError ? [] : (query.data?.pages.flatMap((p) => p.items) ?? []);
  const counts = query.isError ? undefined : query.data?.pages[0]?.counts;
  function store() {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({ state: filter.state, mine: filter.mine }));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }
  return (
    <div
      className={`case-ui admin-review case-admin case-stack${darkMode ? ' dark' : ''}`}
      dir={dir}
      lang={lang}
      data-testid="admin-dispute-inbox"
    >
      <header className="cw-header">
        <div>
          <h1>{t.queue}</h1>
          <p className="case-muted">{t.queueHint}</p>
        </div>
        <button
          className="case-button"
          type="button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t.refreshQueue}
        </button>
      </header>
      <div className="cw-metrics">
        {(['all', 'unassigned', 'overdue', 'appeals'] as const).map((key) => (
          <div className="case-card cw-metric" key={key}>
            <span>{t[key]}</span>
            <strong>{counts?.[key].toLocaleString(lang) ?? '—'}</strong>
          </div>
        ))}
      </div>
      <section className="case-card case-stack" aria-label={t.filter}>
        <div className="cw-filter">
          <label className="case-field">
            {t.state}
            <select
              value={filter.state}
              onChange={(e) => {
                setFilter((f) => ({ ...f, state: e.target.value }));
                setSaved(false);
              }}
            >
              <option value="">{t.all}</option>
              {DISPUTE_WORKSPACE_STATES.map((s) => (
                <option value={s} key={s}>
                  {WORKSPACE_STATES[lang][s]}
                </option>
              ))}
            </select>
          </label>
          <label className="cw-check">
            <input
              type="checkbox"
              checked={filter.mine}
              onChange={(e) => {
                setFilter((f) => ({ ...f, mine: e.target.checked }));
                setSaved(false);
              }}
            />
            <span>{t.mine}</span>
          </label>
          <button className="case-button" type="button" onClick={store}>
            {t.saveView}
          </button>
        </div>
        {saved && (
          <p role="status" className="cw-meta">
            {t.viewSaved}
          </p>
        )}
      </section>
      {query.isPending ? (
        <p role="status">{t.loading}</p>
      ) : query.isError ? (
        <CaseNotice alert>
          {t.failed}
          <button className="case-button" type="button" onClick={() => void query.refetch()}>
            {t.retry}
          </button>
        </CaseNotice>
      ) : !rows.length ? (
        <CaseEmpty title={t.empty}>{t.emptyHint}</CaseEmpty>
      ) : (
        <ul className="cw-items">
          {rows.map((row) => (
            <li className="case-card cw-list-item" key={row.disputeId}>
              <div className="case-stack">
                <div className="cw-status-row">
                  <CaseBadge>{WORKSPACE_STATES[lang][row.state]}</CaseBadge>
                  {row.overdue && <CaseBadge>{t.overdue}</CaseBadge>}
                </div>
                <p className="case-reference">
                  <bdi dir="ltr">{row.reference}</bdi>
                </p>
                <p className="cw-meta">
                  {row.unassigned
                    ? t.unassigned
                    : row.assignedToYou
                      ? t.youAssigned
                      : t.otherAssigned}
                </p>
                <p className="cw-meta">
                  {t.due}: <CaseDate value={row.dueAt} lang={lang} />
                </p>
              </div>
              <Link
                className="case-button"
                to={`/admin/disputes/${encodeURIComponent(row.disputeId)}`}
              >
                {t.open}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && !query.isError && (
        <button
          className="case-button"
          type="button"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {t.more}
        </button>
      )}
      <details
        className="case-card cw-disclosure"
        onToggle={(e) => setLegacy(e.currentTarget.open)}
      >
        <summary>{t.legacy}</summary>
        <div>
          <p className="case-muted">{t.legacyHint}</p>
          {legacy && <DisputeSection lang={lang} />}
        </div>
      </details>
    </div>
  );
}
