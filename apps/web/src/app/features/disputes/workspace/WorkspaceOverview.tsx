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
    // `cw-facts` carries the existing dl/dd/group-separator rules. They were
    // written for the old `<details class="… cw-facts">` wrapper and stopped
    // applying when this markup moved into its own panel.
    <section id="case-overview" className="case-card case-stack cw-section cw-facts">
      <h2>{t.facts}</h2>
      <p className="case-muted">{t.sourceHint}</p>
      <dl>
        {view.facts.map((f, i) => (
          // A `div` inside a `dl` is a definition GROUP, and a group may hold
          // nothing but `dt` and `dd`. The provenance lines are part of what
          // the term is defined as — where the fact came from and when it was
          // recorded — so they belong inside the `dd`, not beside it.
          <div key={`${f.source}-${f.label}-${i}`}>
            <dt>{translatedLabel(t.factsLabels, f.label, t.source)}</dt>
            <dd>
              <bdi dir="auto">{f.value}</bdi>
              <p className="cw-meta">
                {t.source}:{' '}
                <bdi dir="ltr">
                  {f.source}/{f.id}
                </bdi>
              </p>
              <p className="cw-meta">
                {t.recorded}: <CaseDate value={f.recordedAt} lang={lang} />
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
