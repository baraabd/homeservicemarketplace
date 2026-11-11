import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminVerificationCase } from '@homeservicemarketplace/contracts';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { CaseActionsPanel, type CaseActionsPanelProps } from './CaseActionsPanel';
import { UI } from '../copy/verification-copy';

const kase: AdminVerificationCase = {
  id: 'case-a',
  providerProfileId: 'provider-a',
  state: 'SUBMITTED',
  policyVersion: 'v1',
  country: 'SY',
  providerType: 'INDIVIDUAL',
  submittedAt: '2026-11-11T12:00:00.000Z',
  assignedToUserId: null,
  assignedAt: null,
  decidedAt: null,
  requirements: [],
  documents: [],
  decisions: [],
  availableActions: ['approve', 'reject'],
  blockedReason: null,
  workAccess: null,
};

function setup(props: Partial<CaseActionsPanelProps> = {}) {
  localStorage.setItem('hsm.lang', 'en');
  const onRun = vi.fn().mockResolvedValue({});
  const tree = (next: Partial<CaseActionsPanelProps>) => (
    <LanguageProvider>
      <CaseActionsPanel verificationCase={kase} onRun={onRun} {...props} {...next} />
    </LanguageProvider>
  );
  const result = render(tree({}));
  fireEvent.click(screen.getByTestId('case-action-reject'));
  fireEvent.change(screen.getByTestId('case-action-reason'), {
    target: { value: 'DOCUMENT_MISMATCH' },
  });
  fireEvent.change(screen.getByTestId('case-action-note'), {
    target: { value: 'Note for provider A' },
  });
  return {
    ...result,
    onRun,
    update: (next: Partial<CaseActionsPanelProps>) => result.rerender(tree(next)),
  };
}

describe('case decision intent stays bound to the reviewed case', () => {
  it.each([
    ['another cached case', { id: 'case-b', providerProfileId: 'provider-b' }],
    ['a changed case state', { state: 'IN_REVIEW' }],
    ['withdrawn server permission', { availableActions: [] }],
  ] as const)('will not retarget an open confirmation after %s', (_label, change) => {
    const { onRun, update } = setup();
    update({ verificationCase: { ...kase, ...change } as AdminVerificationCase });
    expect(screen.getByTestId('case-action-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('case-action-confirm'));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByTestId('case-action-note')).toHaveValue('Note for provider A');
  });

  it('requires a successful refresh after a conflict', async () => {
    const onReload = vi.fn().mockRejectedValue(new Error('temporarily unavailable'));
    const { onRun, update } = setup({ onReload });
    update({ errorStatus: 409 });
    expect(screen.getByTestId('case-action-confirm')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: UI.en.reload }));
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    expect(screen.getByTestId('case-action-note')).toHaveValue('Note for provider A');
    expect(onRun).not.toHaveBeenCalled();
  });

  it('keeps the current decision note while refresh temporarily blocks decisions', () => {
    const { onRun, update } = setup();
    update({ readOnly: true });
    expect(screen.getByTestId('case-action-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('case-action-confirm'));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByTestId('case-action-note')).toHaveValue('Note for provider A');
    update({ readOnly: false });
    expect(screen.getByTestId('case-action-confirm')).toBeEnabled();
  });

  it('sends one decision while its response is outstanding', async () => {
    let resolve!: () => void;
    const onRun = vi.fn(
      (_input: Parameters<CaseActionsPanelProps['onRun']>[0]) =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    setup({ onRun });
    fireEvent.click(screen.getByTestId('case-action-confirm'));
    fireEvent.click(screen.getByTestId('case-action-confirm'));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0][0]).toEqual({
      caseId: 'case-a',
      action: 'reject',
      expectedState: 'SUBMITTED',
      reasonCode: 'DOCUMENT_MISMATCH',
      note: 'Note for provider A',
    });
    await act(async () => resolve());
  });

  it('shows an actionable generic failure without rendering server details', () => {
    const { update } = setup();
    update({ errorStatus: 500 });
    expect(screen.getByTestId('case-actions-failed')).toHaveTextContent(
      'Could not record the decision',
    );
    expect(screen.getByTestId('case-action-note')).toHaveValue('Note for provider A');
  });
});
