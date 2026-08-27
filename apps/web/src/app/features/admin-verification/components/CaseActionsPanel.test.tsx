import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdminVerificationCase } from '@homeservicemarketplace/contracts';

import { LanguageProvider } from '../../../i18n/LanguageContext';
import { CaseActionsPanel } from './CaseActionsPanel';
import { UI } from '../copy/verification-copy';

// Sprint 9B.12 — the case-action panel.
//
// The load-bearing assertion is a NEGATIVE one: this component contains no
// transition table, so it renders exactly what the server sent and nothing
// else. A test that only checked "approve appears for SUBMITTED" would pass
// against a component that had quietly grown its own rules.

function kase(over: Partial<AdminVerificationCase> = {}): AdminVerificationCase {
  return {
    id: 'c1',
    providerProfileId: 'pp-1',
    state: 'SUBMITTED',
    policyVersion: 'v1',
    country: 'SY',
    providerType: 'INDIVIDUAL',
    submittedAt: '2026-08-01T00:00:00.000Z',
    assignedToUserId: null,
    assignedAt: null,
    decidedAt: null,
    requirements: [],
    documents: [],
    decisions: [],
    availableActions: ['approve', 'reject'],
    blockedReason: null,
    workAccess: null,
    ...over,
  } as AdminVerificationCase;
}

function renderPanel(
  props: Partial<Parameters<typeof CaseActionsPanel>[0]> = {},
  lang: 'en' | 'ar' = 'en',
) {
  window.localStorage.setItem('hsm.lang', lang);
  const onRun = props.onRun ?? vi.fn().mockResolvedValue({});
  const result = render(
    <LanguageProvider>
      <CaseActionsPanel verificationCase={kase()} onRun={onRun} {...props} />
    </LanguageProvider>,
  );
  return { ...result, onRun };
}

describe('the server decides what is offered', () => {
  it('renders exactly the actions the server sent', () => {
    renderPanel({ verificationCase: kase({ availableActions: ['assign', 'requestAction'] }) });

    expect(screen.getByTestId('case-action-assign')).toBeInTheDocument();
    expect(screen.getByTestId('case-action-requestAction')).toBeInTheDocument();
    // Not offered by the server, so not rendered — even though `approve` is
    // legal from SUBMITTED in the abstract. The component owns no such rule.
    expect(screen.queryByTestId('case-action-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('case-action-reject')).not.toBeInTheDocument();
  });

  it('renders NOTHING extra for a state it might have opinions about', () => {
    renderPanel({ verificationCase: kase({ state: 'VERIFIED', availableActions: ['revoke'] }) });

    const panel = screen.getByTestId('case-actions');
    const buttons = within(panel).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('data-testid', 'case-action-revoke');
  });

  it.each([
    ['SELF_REVIEW', UI.en.selfReview],
    ['TERMINAL_STATE', UI.en.terminalState],
    ['NOT_SUBMITTED', UI.en.notSubmitted],
  ])('explains %s rather than showing an empty panel', (blockedReason, expected) => {
    renderPanel({
      verificationCase: kase({ availableActions: [], blockedReason: blockedReason as never }),
    });
    expect(screen.getByTestId('case-actions-none')).toHaveTextContent(expected);
  });

  it('says the two axes are separate', () => {
    // A reviewer who conflates them suspends someone for a blurry passport.
    renderPanel();
    expect(screen.getByTestId('case-actions')).toHaveTextContent(UI.en.axisNote);
  });
});

describe('reason capture', () => {
  it('will not send an action that needs a reason without one', async () => {
    const { onRun } = renderPanel();

    fireEvent.click(screen.getByTestId('case-action-reject'));
    fireEvent.click(screen.getByTestId('case-action-confirm'));

    expect(await screen.findByTestId('case-action-validation')).toHaveTextContent(
      UI.en.reasonRequired,
    );
    expect(onRun).not.toHaveBeenCalled();
  });

  it('sends the reason, the note and the state the reviewer was looking at', async () => {
    const { onRun } = renderPanel({ verificationCase: kase({ state: 'IN_REVIEW' }) });

    fireEvent.click(screen.getByTestId('case-action-reject'));
    fireEvent.change(screen.getByTestId('case-action-reason'), {
      target: { value: 'DOCUMENT_MISMATCH' },
    });
    fireEvent.change(screen.getByTestId('case-action-note'), {
      target: { value: 'checked twice' },
    });
    fireEvent.click(screen.getByTestId('case-action-confirm'));

    await waitFor(() =>
      expect(onRun).toHaveBeenCalledWith({
        action: 'reject',
        reasonCode: 'DOCUMENT_MISMATCH',
        note: 'checked twice',
        // The optimistic-concurrency guard: without this the server cannot
        // tell that this reviewer was looking at a stale case.
        expectedState: 'IN_REVIEW',
      }),
    );
  });

  it('tells the reviewer the provider never sees the note', () => {
    // A reviewer who believed otherwise would either write nothing useful or
    // write something they would not want read back to them.
    renderPanel();
    fireEvent.click(screen.getByTestId('case-action-reject'));
    expect(screen.getByTestId('case-action-dialog')).toHaveTextContent(UI.en.noteHint);
  });

  it('warns what approving actually does before it happens', () => {
    renderPanel({ verificationCase: kase({ availableActions: ['approve'] }) });
    fireEvent.click(screen.getByTestId('case-action-approve'));
    expect(screen.getByTestId('case-action-dialog')).toHaveTextContent(UI.en.confirmApprove);
  });

  it('cancelling sends nothing', async () => {
    const { onRun } = renderPanel();
    fireEvent.click(screen.getByTestId('case-action-reject'));
    fireEvent.click(screen.getByTestId('case-action-cancel'));

    await waitFor(() => expect(screen.queryByTestId('case-action-dialog')).not.toBeInTheDocument());
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe('focus management', () => {
  it('moves focus into the dialog and back to the opener on cancel', async () => {
    // A keyboard reviewer who cancels must not be dropped at the top of the
    // document and made to tab back through the whole case.
    renderPanel();
    const opener = screen.getByTestId('case-action-reject');
    fireEvent.click(opener);

    await waitFor(() => expect(screen.getByTestId('case-action-dialog')).toHaveFocus());

    fireEvent.click(screen.getByTestId('case-action-cancel'));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('closes on Escape', async () => {
    // A modal a keyboard user cannot dismiss is a trap.
    renderPanel();
    fireEvent.click(screen.getByTestId('case-action-reject'));
    fireEvent.keyDown(screen.getByTestId('case-action-dialog'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('case-action-dialog')).not.toBeInTheDocument());
  });

  it('marks the dialog as modal for assistive technology', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('case-action-reject'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});

describe('failures a reviewer must be able to tell apart', () => {
  it('shows a stale-state conflict with a way to recover', () => {
    const onReload = vi.fn();
    renderPanel({ errorStatus: 409, onReload });

    const conflict = screen.getByTestId('case-actions-conflict');
    expect(conflict).toHaveTextContent(UI.en.conflictTitle);
    fireEvent.click(within(conflict).getByRole('button', { name: UI.en.reload }));
    expect(onReload).toHaveBeenCalled();
  });

  it('keeps the actions visible during a conflict, so the reviewer can retry', () => {
    renderPanel({ errorStatus: 409 });
    expect(screen.getByTestId('case-action-reject')).toBeInTheDocument();
  });

  it('replaces the actions entirely on a permission failure', () => {
    // Offering buttons that will be refused teaches people to click and hope.
    renderPanel({ errorStatus: 403 });
    expect(screen.getByTestId('case-actions-forbidden')).toHaveTextContent(UI.en.forbiddenBody);
    expect(screen.queryByTestId('case-action-reject')).not.toBeInTheDocument();
  });

  it('a conflict is NOT a permission failure', () => {
    renderPanel({ errorStatus: 409 });
    expect(screen.queryByTestId('case-actions-forbidden')).not.toBeInTheDocument();
  });
});

describe('Arabic', () => {
  it('renders the Arabic labels and direction', () => {
    renderPanel({}, 'ar');
    const panel = screen.getByTestId('case-actions');
    expect(panel).toHaveAttribute('dir', 'rtl');
    expect(panel).toHaveTextContent(UI.ar.caseActions);
    expect(screen.getByTestId('case-action-reject')).toHaveTextContent(UI.ar.actionReject);
  });
});
