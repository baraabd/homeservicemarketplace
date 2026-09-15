import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AdminProviderReviewWorkspace } from '../components/AdminProviderReviewWorkspace';
import { REVIEW_COPY } from '../copy';
import { reviewFixture } from './fixtures';

const PATH = '/v1/admin/providers/provider-1/review';
let mock: MockAdapter;
let review: AdminProviderReview;
function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <AdminProviderReviewWorkspace providerProfileId="provider-1" />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  localStorage.clear();
  review = reviewFixture();
  mock = new MockAdapter(api);
  mock.onGet(PATH).reply(() => [200, review]);
  mock.onGet(`${PATH}/history`).reply(200, { items: [], nextCursor: null });
  mock.onGet('/v1/services/equipment').reply(200, { items: [] });
  mock.onGet('/v1/admin/providers/provider-1/portfolio').reply(200, { items: [] });
});
afterEach(() => {
  mock.restore();
  vi.restoreAllMocks();
});

describe('Admin application dossier', () => {
  it('keeps submitted facts distinct from current profile and renders all six tasks', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Current provider' });
    expect(screen.getByText('Submitted biography')).toBeInTheDocument();
    expect(screen.queryByText('Changed current biography')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^review-section-/)).toHaveLength(6);
    fireEvent.click(screen.getByTestId('review-source-current'));
    expect(screen.getByText('Changed current biography')).toBeInTheDocument();
    expect(screen.queryByText('Submitted biography')).not.toBeInTheDocument();
  });
  it('does not reconstruct absent historical facts from current profile', async () => {
    review.submission!.snapshot = null;
    review.availableActions = ['requestChanges'];
    review.blockers = [{ code: 'SNAPSHOT_UNAVAILABLE' }];
    setup();
    await screen.findByText(REVIEW_COPY.en.historicalMissing);
    expect(screen.queryByText('Changed current biography')).not.toBeInTheDocument();
    expect(screen.getAllByText(REVIEW_COPY.en.notCaptured).length).toBeGreaterThan(5);
    expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
  });
  it('renders server permission failures without keeping dossier data visible', async () => {
    setup();
    await screen.findByText('Submitted biography');
    mock.onGet(PATH).reply(403, { error: { code: 'FORBIDDEN' } });
    fireEvent.click(screen.getByTestId('review-refresh'));
    await screen.findByText(REVIEW_COPY.en.forbidden);
    expect(screen.queryByText('Submitted biography')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
  });
  it('uses Arabic direction and localized review tasks', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    setup();
    await screen.findByRole('heading', { name: 'Current provider' });
    expect(screen.getByTestId('admin-provider-review-workspace')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'البيانات والهوية' })).toBeInTheDocument();
  });
});

describe('review decisions', () => {
  it('requires review acknowledgement and sends exact submission/revision before replacing capabilities with the server answer', async () => {
    let payload: Record<string, unknown> | null = null;
    mock.onPost(`${PATH}/approve`).reply((config) => {
      payload = JSON.parse(config.data);
      review = {
        ...review,
        canWork: true,
        availableActions: [],
        provider: { ...review.provider, onboardingState: 'ACCEPTED' },
      };
      return [200, { changed: true, review }];
    });
    setup();
    fireEvent.click(await screen.findByTestId('review-approve'));
    fireEvent.click(screen.getByTestId('review-confirm'));
    expect(payload).toBeNull();
    fireEvent.click(screen.getByTestId('review-approval-ack'));
    fireEvent.click(screen.getByTestId('review-confirm'));
    await screen.findByText(REVIEW_COPY.en.decisionSuccess);
    expect(payload).toMatchObject({
      submissionId: 'submission-1',
      expectedRevision: 'a'.repeat(64),
      reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
    });
    expect(payload!.idempotencyKey).toEqual(expect.any(String));
    expect(screen.getAllByText(REVIEW_COPY.en.allowed).length).toBeGreaterThan(0);
  });
  it('keeps correction instructions and internal notes through a conflict, then uses the explicitly refreshed revision', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    mock.onPost(`${PATH}/request-changes`).reply((config) => {
      payloads.push(JSON.parse(config.data));
      if (payloads.length === 1) {
        review = { ...review, revision: 'b'.repeat(64) };
        return [409, { error: { code: 'CONFLICT' } }];
      }
      review = { ...review, availableActions: [] };
      return [200, { changed: true, review }];
    });
    setup();
    await screen.findByTestId('review-private-note');
    fireEvent.change(screen.getByTestId('review-private-note'), {
      target: { value: 'Private internal note' },
    });
    fireEvent.click(screen.getByTestId('review-request-changes'));
    fireEvent.change(screen.getByTestId('review-correction-field-0'), {
      target: { value: 'verificationDocuments' },
    });
    fireEvent.change(screen.getByTestId('review-correction-task-0'), {
      target: { value: 'WORK_AREA' },
    });
    fireEvent.change(screen.getByTestId('review-correction-message-0'), {
      target: { value: 'Please confirm the district.' },
    });
    fireEvent.click(screen.getByTestId('review-confirm'));
    await screen.findByTestId('review-conflict');
    expect(screen.getByTestId('review-correction-message-0')).toHaveValue(
      'Please confirm the district.',
    );
    let refreshFailed = false;
    mock.onGet(PATH).reply(() => {
      if (!refreshFailed) {
        refreshFailed = true;
        return [503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } }];
      }
      return [200, review];
    });
    fireEvent.click(screen.getByTestId('review-conflict-refresh'));
    await screen.findByText(REVIEW_COPY.en.failed);
    expect(screen.getByTestId('review-correction-message-0')).toHaveValue(
      'Please confirm the district.',
    );
    expect(screen.getByTestId('review-conflict')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('review-conflict-refresh'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('review-private-note')).toHaveValue('Private internal note');
    fireEvent.click(screen.getByTestId('review-request-changes'));
    expect(screen.getByTestId('review-correction-message-0')).toHaveValue(
      'Please confirm the district.',
    );
    fireEvent.click(screen.getByTestId('review-confirm'));
    await screen.findByText(REVIEW_COPY.en.decisionSuccess);
    expect(payloads[1]).toMatchObject({
      expectedRevision: 'b'.repeat(64),
      note: 'Private internal note',
      feedback: [{ taskId: 'WORK_AREA', providerMessage: 'Please confirm the district.' }],
    });
    expect(JSON.stringify(payloads[1].feedback)).not.toContain('Private internal note');
    expect(payloads[0].feedback).toEqual([
      expect.not.objectContaining({ field: 'verificationDocuments' }),
    ]);
    expect(payloads[1].feedback).toEqual([
      expect.not.objectContaining({ field: 'verificationDocuments' }),
    ]);
    expect(payloads[0].idempotencyKey).not.toBe(payloads[1].idempotencyKey);
  });
  it('retries a lost decision response with the same idempotency key and restores keyboard focus on cancel', async () => {
    const payloads: Array<{ idempotencyKey: string }> = [];
    mock.onPost(`${PATH}/approve`).reply((config) => {
      payloads.push(JSON.parse(config.data));
      return [503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } }];
    });
    setup();
    const opener = await screen.findByTestId('review-approve');
    fireEvent.click(opener);
    fireEvent.click(screen.getByTestId('review-approval-ack'));
    fireEvent.click(screen.getByTestId('review-confirm'));
    await screen.findByTestId('review-command-error');
    fireEvent.click(screen.getByTestId('review-confirm'));
    await waitFor(() => expect(payloads).toHaveLength(2));
    expect(payloads[0].idempotencyKey).toBe(payloads[1].idempotencyKey);
    await waitFor(() => expect(screen.getByTestId('review-confirm')).not.toBeDisabled());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
