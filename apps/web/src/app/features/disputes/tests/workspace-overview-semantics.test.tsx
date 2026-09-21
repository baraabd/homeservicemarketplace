import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { WorkspaceOverview } from '../workspace/WorkspaceOverview';
import { WORKSPACE_COPY } from '../workspace/copy';

// Sprint 12D — the source-fact list must be a VALID definition list.
//
// Axe's `definition-list` rule (serious): "<dl> elements must only directly
// contain properly-ordered <dt> and <dd> groups, <script>, <template> or <div>
// elements", and a grouping <div> may itself contain only <dt>/<dd>.
//
// This markup used to live inside a `<details>` that defaulted to closed, so
// the scanner never saw it. Promoting it to a visible panel exposed
// `dl element has direct children that are not allowed: div > p` — the Source
// and Recorded lines were siblings of <dt>/<dd> rather than part of the
// definition. The fix moved them inside the <dd>; this test is the guard, and
// it encodes the rule structurally so it fails in milliseconds instead of
// waiting for the real-browser accessibility scan in CI.

const facts: DisputeWorkspaceView['facts'] = [
  {
    id: 'bk-1',
    source: 'BOOKING',
    label: 'BOOKING_STATUS',
    value: 'COMPLETED',
    recordedAt: '2026-09-19T09:00:00Z',
  },
  {
    id: 'sub-1',
    source: 'SUBMISSION',
    label: 'REQUESTED_OUTCOME',
    value: 'A return visit',
    recordedAt: '2026-09-19T10:00:00Z',
  },
];

const view = { facts } as DisputeWorkspaceView;

afterEach(cleanup);

describe('WorkspaceOverview — definition-list semantics', () => {
  it('puts nothing but dt/dd groups directly inside the dl', () => {
    render(<WorkspaceOverview view={view} lang="en" />);
    const list = document.querySelector('dl');
    expect(list).not.toBeNull();

    for (const child of Array.from(list!.children)) {
      // Axe permits div / dt / dd / script / template as direct dl children.
      expect(['DIV', 'DT', 'DD', 'SCRIPT', 'TEMPLATE']).toContain(child.tagName);
      if (child.tagName !== 'DIV') continue;
      // …and a grouping div may contain only dt and dd.
      const bad = Array.from(child.children)
        .filter((n) => !['DT', 'DD'].includes(n.tagName))
        .map((n) => `${child.tagName.toLowerCase()} > ${n.tagName.toLowerCase()}`);
      expect(bad).toEqual([]);
    }
  });

  it('keeps every fact group to exactly one term and one definition', () => {
    render(<WorkspaceOverview view={view} lang="en" />);
    const groups = Array.from(document.querySelectorAll('dl > div'));
    expect(groups).toHaveLength(facts.length);
    for (const group of groups) {
      expect(group.querySelectorAll(':scope > dt')).toHaveLength(1);
      expect(group.querySelectorAll(':scope > dd')).toHaveLength(1);
    }
  });

  it('retains the value and BOTH provenance lines inside the definition', () => {
    render(<WorkspaceOverview view={view} lang="en" />);
    const t = WORKSPACE_COPY.en;
    const dd = document.querySelectorAll('dl > div > dd')[0] as HTMLElement;

    // Provenance is not decoration: losing it would make a fact unsourced.
    expect(within(dd).getByText('COMPLETED')).toBeInTheDocument();
    expect(dd.textContent).toContain(`${t.source}:`);
    expect(dd.textContent).toContain('BOOKING/bk-1');
    expect(dd.textContent).toContain(`${t.recorded}:`);
    expect(dd.querySelector('time')).not.toBeNull();
  });

  it('never hides the metadata from assistive technology', () => {
    render(<WorkspaceOverview view={view} lang="en" />);
    for (const meta of Array.from(document.querySelectorAll('.cw-meta'))) {
      expect(meta.getAttribute('aria-hidden')).toBeNull();
    }
  });

  it('renders Arabic labels without losing provenance', () => {
    render(<WorkspaceOverview view={view} lang="ar" />);
    expect(screen.getByRole('heading', { name: WORKSPACE_COPY.ar.facts })).toBeInTheDocument();
    const dd = document.querySelectorAll('dl > div > dd')[0] as HTMLElement;
    expect(dd.textContent).toContain(`${WORKSPACE_COPY.ar.source}:`);
    expect(dd.textContent).toContain(`${WORKSPACE_COPY.ar.recorded}:`);
  });
});
