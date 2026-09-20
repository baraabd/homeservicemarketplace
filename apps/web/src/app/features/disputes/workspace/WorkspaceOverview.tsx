import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { CaseDate } from '../../case-ui/CasePrimitives';
import { WORKSPACE_COPY, translatedLabel } from './copy';

// Sprint 12D — the verified source records, as a panel rather than a collapsed
// disclosure.
//
// These are the facts a decision is supposed to rest on, and in the anchor-link
// layout they sat inside a `<details>` that defaulted to closed, above four
// sections that were all already expanded. The reviewer had to open the least
// prominent element on the page to see the only part of it the server vouches
// for. Given a tab of its own it is the first thing the workspace offers.
//
// The source labelling is unchanged and deliberate: each row still names the
// record it came from, and `sourceHint` still says that a booked amount is not
// proof of payment. Nothing here is a staff conclusion.
export function WorkspaceOverview({
  view,
  lang,
}: {
  view: DisputeWorkspaceView;
  lang: 'en' | 'ar';
}) {
  const t = WORKSPACE_COPY[lang];
  return (
    <section id="case-overview" className="case-card case-stack cw-section">
      <h2>{t.facts}</h2>
      <p className="case-muted">{t.sourceHint}</p>
      <dl>
        {view.facts.map((f, i) => (
          <div key={`${f.source}-${f.label}-${i}`}>
            <dt>{translatedLabel(t.factsLabels, f.label, t.source)}</dt>
            <dd>
              <bdi dir="auto">{f.value}</bdi>
            </dd>
            <p className="cw-meta">
              {t.source}:{' '}
              <bdi dir="ltr">
                {f.source}/{f.id}
              </bdi>
            </p>
            <p className="cw-meta">
              {t.recorded}: <CaseDate value={f.recordedAt} lang={lang} />
            </p>
          </div>
        ))}
      </dl>
    </section>
  );
}
