import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { LEGACY_PUBLICATION_ACK_TEXT } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AdminProviderReviewWorkspace } from '../components/AdminProviderReviewWorkspace';
import { REVIEW_COPY, statusLabel } from '../copy';
import { reviewFixture, STAMP } from './fixtures';

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
  it.each(['en', 'ar'] as const)(
    'explains a submitted application with received evidence and unset legacy status axes in %s',
    async (lang) => {
      localStorage.setItem('hsm.lang', lang);
      review.provider.standingState = null;
      review.provider.verificationState = null;
      review.verification = {
        id: 'case-1',
        providerProfileId: 'provider-1',
        state: 'SUBMITTED',
        policyVersion: 'v1',
        country: 'SY',
        providerType: 'INDIVIDUAL',
        submittedAt: STAMP,
        assignedToUserId: null,
        assignedAt: null,
        decidedAt: null,
        requirements: [],
        documents: [
          {
            id: 'document-1',
            kind: 'INDIVIDUAL_IDENTITY',
            serviceCategoryId: null,
            serviceCategoryLabelEn: null,
            serviceCategoryLabelAr: null,
            detectedMimeType: 'image/png',
            sizeBytes: 20,
            displayFilename: 'identity.png',
            scanState: 'CLEAN',
            viewable: true,
            uploadedAt: STAMP,
            evidenceDeletedAt: null,
            supersededAt: null,
          },
        ],
        decisions: [],
        availableActions: [],
        blockedReason: null,
        workAccess: null,
      };
      setup();
      await screen.findByRole('heading', { name: 'Current provider' });
      const t = REVIEW_COPY[lang];
      const account = within(screen.getByText(t.account).parentElement!);
      expect(account.getByText(statusLabel('ACTIVE', lang))).toBeInTheDocument();
      expect(account.queryByText(t.notProvided)).not.toBeInTheDocument();
      const application = within(screen.getByText(t.application).parentElement!);
      expect(application.getByText(statusLabel('PENDING_REVIEW', lang))).toBeInTheDocument();
      expect(
        application.queryByText(statusLabel('DOCUMENTS_REQUIRED', lang)),
      ).not.toBeInTheDocument();
      const identity = within(screen.getByText(t.identity).parentElement!);
      expect(identity.getByText(statusLabel('UNVERIFIED', lang))).toBeInTheDocument();
      expect(
        identity.getByText(`${t.identityCaseState}: ${statusLabel('SUBMITTED', lang)}`),
      ).toBeInTheDocument();
      expect(identity.queryByText(t.notProvided)).not.toBeInTheDocument();
      expect(screen.queryByText(t.noEvidence)).not.toBeInTheDocument();
      expect(screen.getByTestId('review-evidence-document-1')).toBeInTheDocument();
      expect(screen.getByText(t.awaitingDecision)).toBeInTheDocument();
      expect(screen.getByText('v1')).toHaveAttribute('dir', 'ltr');
      expect(mock.history.get.some((request) => request.url?.endsWith('/content'))).toBe(false);
    },
  );
  it('focuses the loaded dossier heading without scrolling underneath the admin header', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    setup();
    const heading = await screen.findByRole('heading', { name: 'Current provider' });
    expect(heading).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
  it('keeps a recorded decision authoritative and does not invent a pending decision without a submission', async () => {
    review.submission!.decision = 'APPROVED';
    setup();
    await screen.findByRole('heading', { name: 'Current provider' });
    const decision = () =>
      within(screen.getByText(REVIEW_COPY.en.applicationDecision).parentElement!);
    expect(decision().getByText('Approved')).toBeInTheDocument();
    expect(decision().queryByText(REVIEW_COPY.en.awaitingDecision)).not.toBeInTheDocument();
    review.submission = null;
    fireEvent.click(screen.getByTestId('review-refresh'));
    await screen.findByText(REVIEW_COPY.en.noSubmission);
    expect(decision().getByText(REVIEW_COPY.en.noHistory)).toBeInTheDocument();
    expect(decision().queryByText(REVIEW_COPY.en.awaitingDecision)).not.toBeInTheDocument();
  });
  it.each(['en', 'ar'] as const)(
    'labels a legacy publication acknowledgement honestly without exposing its storage token in %s',
    async (lang) => {
      localStorage.setItem('hsm.lang', lang);
      review.submission!.snapshot!.portfolio = [
        {
          id: 'image-1',
          mediaAssetId: 'asset-1',
          revision: 1,
          title: 'Submitted project',
          description: null,
          serviceCategoryId: 'electrical',
          position: 0,
          publicationRightAckAt: STAMP,
          publicationRightAckVersion: LEGACY_PUBLICATION_ACK_TEXT,
          moderationState: 'PENDING',
        },
      ];
      setup();
      await screen.findByRole('heading', { name: 'Current provider' });
      expect(screen.getByTestId('review-section-PORTFOLIO')).toHaveTextContent(
        REVIEW_COPY[lang].legacyPublicationAck,
      );
      expect(screen.getByTestId('review-section-PORTFOLIO')).not.toHaveTextContent(
        LEGACY_PUBLICATION_ACK_TEXT,
      );
    },
  );
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
  it.each([
    [401, REVIEW_COPY.en.failed],
    [403, REVIEW_COPY.en.forbidden],
    [404, REVIEW_COPY.en.notFound],
  ] as const)(
    'hides cached dossier data after an access refetch fails with %s',
    async (status, message) => {
      setup();
      await screen.findByText('Submitted biography');
      mock.onGet(PATH).reply(status, { error: { code: 'ACCESS_UNAVAILABLE' } });
      fireEvent.click(screen.getByTestId('review-refresh'));
      await screen.findByText(message);
      expect(screen.queryByText('Submitted biography')).not.toBeInTheDocument();
      expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
    },
  );
  it('uses Arabic direction and localized review tasks', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    setup();
    await screen.findByRole('heading', { name: 'Current provider' });
    expect(screen.getByTestId('admin-provider-review-workspace')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'البيانات والهوية' })).toBeInTheDocument();
    expect(screen.getByText('Submitted biography')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('policy-v1')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('terms-v1')).toHaveAttribute('dir', 'ltr');
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
