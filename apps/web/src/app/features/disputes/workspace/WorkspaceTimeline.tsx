import { useState } from 'react';
import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { CaseDate, CaseNotice } from '../../case-ui/CasePrimitives';
import { useWorkspaceHistory } from './api';
import { EVENT_LABELS, WORKSPACE_COPY, translatedLabel } from './copy';
export function WorkspaceTimeline({
  view,
  admin,
  lang,
}: {
  view: DisputeWorkspaceView;
  admin: boolean;
  lang: 'en' | 'ar';
}) {
  const t = WORKSPACE_COPY[lang];
  const [load, setLoad] = useState(false);
  const query = useWorkspaceHistory(
    view.disputeId,
    admin,
    load ? view.events[0]?.revision : undefined,
  );
  const earlier = query.isError ? [] : (query.data?.pages.flatMap((p) => p.items) ?? []);
  const events = [...earlier, ...view.events]
    .filter((e, i, items) => items.findIndex((x) => x.id === e.id) === i)
    .sort((a, b) => a.revision - b.revision);
  return (
    <section className="case-card case-stack cw-section" id="case-history">
      <h2>{t.history}</h2>
      {view.eventsTruncated && (!load || query.hasNextPage) && (
        <button
          type="button"
          className="case-button"
          disabled={query.isFetching}
          onClick={() => {
            if (!load) setLoad(true);
            else void query.fetchNextPage();
          }}
        >
          {t.olderEvents}
        </button>
      )}
      {query.isError && load && (
        <CaseNotice alert>
          {t.failed}
          <button type="button" className="case-button" onClick={() => void query.refetch()}>
            {t.retry}
          </button>
        </CaseNotice>
      )}
      <ol className="case-timeline">
        {events.map((e) => (
          <li key={e.id}>
            <strong>{EVENT_LABELS[lang][e.kind] ?? t.event}</strong>
            <p className="cw-meta">
              {translatedLabel(t.roles, e.actorRole, t.event)} · #{e.revision.toLocaleString(lang)}
            </p>
            <CaseDate value={e.occurredAt} lang={lang} />
          </li>
        ))}
      </ol>
    </section>
  );
}
