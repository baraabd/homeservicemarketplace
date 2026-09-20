import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DisputeRemedy, DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { DecisionFields, RemedyFields, SimpleCommandFields } from '../workspace/CommandFields';
import { initialCommandFields, blankRemedy } from '../workspace/command-model';
import { WORKSPACE_COPY } from '../workspace/copy';

const view: DisputeWorkspaceView = {
  disputeId: 'synthetic-dispute',
  reference: 'DSP-TEST',
  state: 'GATHERING',
  revision: 1,
  role: 'REVIEWER',
  assignedToYou: true,
  assignedReviewer: null,
  reviewers: [{ id: 'synthetic-reviewer', label: 'Reviewer 1' }],
  participants: [],
  availableActions: [],
  canUploadEvidence: false,
  policy: { version: 'test-v1', appealWindowHours: 24, resolutionDueAt: '2026-09-21T00:00:00Z' },
  facts: [],
  events: [],
  eventsTruncated: false,
  requests: [],
  statements: [],
  evidence: [],
  proposals: [
    {
      id: 'proposal-1',
      status: 'OPEN',
      summary: 'A agreed repeat visit',
      remedies: [],
      expiresAt: '2026-09-21T00:00:00Z',
      acceptedByYou: null,
      acceptedCount: 2,
      fulfilledByYou: false,
      fulfilledCount: 0,
    },
  ],
  decisions: [],
  appeals: [],
};
afterEach(cleanup);
for (const lang of ['en', 'ar'] as const) {
  const t = WORKSPACE_COPY[lang];
  describe(`Dispute command labels (${lang})`, () => {
    it('uses exact names independent of selected options and supports separate compound commitments', () => {
      function Harness() {
        const [remedies, setRemedies] = useState<DisputeRemedy[]>([blankRemedy()]);
        return (
          <div lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <RemedyFields value={remedies} onChange={setRemedies} lang={lang} />
          </div>
        );
      }
      render(<Harness />);
      const first = screen.getByLabelText(t.type, { exact: true });
      expect(first).toHaveAccessibleName(t.type);
      fireEvent.change(first, { target: { value: 'REPERFORM' } });
      expect(screen.getByRole('combobox', { name: t.type, exact: true })).toHaveValue('REPERFORM');
      fireEvent.click(screen.getByRole('button', { name: t.addRemedy }));
      const selects = screen.getAllByLabelText(t.type, { exact: true });
      expect(selects).toHaveLength(2);
      expect(selects[0].id).not.toBe(selects[1].id);
      fireEvent.change(selects[1], { target: { value: 'RESCHEDULE' } });
      expect(selects[0]).toHaveValue('REPERFORM');
      expect(selects[1]).toHaveValue('RESCHEDULE');
      const dates = screen.getAllByLabelText(t.date, { exact: true });
      for (const date of dates) {
        expect(date).toHaveAccessibleName(t.date);
        expect(date).toHaveAccessibleDescription(Intl.DateTimeFormat().resolvedOptions().timeZone);
      }
    });
    it('keeps decision labels distinct from option contents and explanatory hints', () => {
      const set = vi.fn();
      render(
        <DecisionFields
          fields={initialCommandFields({ action: 'DECIDE' }, view)}
          set={set}
          view={view}
          lang={lang}
        />,
      );
      const proposal = screen.getByLabelText(t.proposal, { exact: true });
      expect(proposal).toHaveAccessibleName(t.proposal);
      expect(proposal).toHaveAccessibleDescription(t.noProposalHint);
      fireEvent.change(proposal, { target: { value: 'proposal-1' } });
      expect(set).toHaveBeenCalledWith({ proposalId: 'proposal-1' });
      expect(screen.getByLabelText(t.reason, { exact: true })).toHaveAccessibleName(t.reason);
      expect(screen.getByLabelText(t.rationale, { exact: true })).toHaveAccessibleDescription(
        t.rationaleHint,
      );
    });
    it('labels assignment, private replies, appeals and sensitive hold controls consistently', () => {
      const actions = [
        'ASSIGN',
        'REQUEST_INFORMATION',
        'RESPOND',
        'APPEAL',
        'HOLD_PRIVATE_TEXT',
      ] as const;
      for (const action of actions) {
        const selection = { action };
        const element = render(
          <SimpleCommandFields
            selection={selection}
            fields={initialCommandFields(selection, view)}
            set={vi.fn()}
            view={view}
            lang={lang}
          />,
        );
        const root = within(element.container);
        const label =
          action === 'ASSIGN'
            ? t.chooseReviewer
            : action === 'REQUEST_INFORMATION'
              ? t.recipient
              : action === 'APPEAL'
                ? t.appealGrounds
                : action === 'HOLD_PRIVATE_TEXT'
                  ? t.reason
                  : t.text;
        expect(root.getByLabelText(label, { exact: true })).toHaveAccessibleName(label);
        element.unmount();
      }
    });
  });
}
