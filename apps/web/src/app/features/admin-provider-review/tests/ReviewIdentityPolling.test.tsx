import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter } from 'react-router';
import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { createAuthQueryClient } from '../../../../lib/auth-provider';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AdminProviderReviewWorkspace } from '../components/AdminProviderReviewWorkspace';
import { IDENTITY_SCAN_REFRESH_MS } from '../identity-review-guidance';
import { reviewQueryKey } from '../api';
import { reviewFixture, STAMP } from './fixtures';

const PATH = '/v1/admin/providers/provider-1/review';
let mock: MockAdapter;
let qc: QueryClient;
let review: AdminProviderReview;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('hsm.lang', 'en');
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  review = reviewFixture();
  review.verification = {
    id: 'case-1',
    providerProfileId: 'provider-1',
    state: 'DRAFT',
    policyVersion: 'v1',
    country: 'SY',
    providerType: 'INDIVIDUAL',
    submittedAt: null,
    assignedToUserId: null,
    assignedAt: null,
    decidedAt: null,
    requirements: [
      {
        kind: 'INDIVIDUAL_IDENTITY',
        serviceCategoryId: null,
        serviceCategoryLabelEn: null,
        serviceCategoryLabelAr: null,
        satisfied: true,
      },
    ],
    documents: [
      {
        id: 'document-1',
        kind: 'INDIVIDUAL_IDENTITY',
        serviceCategoryId: null,
        serviceCategoryLabelEn: null,
        serviceCategoryLabelAr: null,
        detectedMimeType: 'image/png',
        sizeBytes: 100,
        displayFilename: 'identity.png',
        scanState: 'PENDING',
        viewable: false,
        uploadedAt: STAMP,
        evidenceDeletedAt: null,
        supersededAt: null,
      },
    ],
    decisions: [],
    availableActions: [],
    blockedReason: 'NOT_SUBMITTED',
    workAccess: null,
  };
  mock = new MockAdapter(api);
  mock.onGet(PATH).reply(() => [200, review]);
  mock.onGet(`${PATH}/history`).reply(200, { items: [], nextCursor: null });
  mock.onGet('/v1/services/equipment').reply(200, { items: [] });
  mock.onGet('/v1/admin/providers/provider-1/portfolio').reply(200, { items: [] });
});

afterEach(() => {
  cleanup();
  qc.clear();
  mock.restore();
  vi.useRealTimers();
});

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function setup() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <AdminProviderReviewWorkspace providerProfileId="provider-1" />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await tick(10);
  expect(screen.getByTestId('review-identity-next-step')).toHaveAttribute('data-step', 'scanning');
  fireEvent.change(screen.getByTestId('review-private-note'), {
    target: { value: 'Keep this private review note' },
  });
}

it('follows the safety check to completion without clearing a note or continuing to poll', async () => {
  await setup();
  review = {
    ...review,
    verification: {
      ...review.verification!,
      requirements: review.verification!.requirements.map((requirement) => ({
        ...requirement,
        satisfied: true,
      })),
      documents: review.verification!.documents.map((document) => ({
        ...document,
        scanState: 'CLEAN',
        viewable: true,
      })),
    },
  };
  await tick(IDENTITY_SCAN_REFRESH_MS + 10);
  expect(screen.getByTestId('review-identity-next-step')).toHaveAttribute('data-step', 'submit');
  expect(screen.getByTestId('review-evidence-document-1')).toBeEnabled();
  expect(screen.getByTestId('review-private-note')).toHaveValue('Keep this private review note');
  expect(mock.history.get.filter((request) => request.url === PATH)).toHaveLength(2);
  await tick(IDENTITY_SCAN_REFRESH_MS * 3);
  expect(mock.history.get.filter((request) => request.url === PATH)).toHaveLength(2);
  expect(mock.history.get.some((request) => request.url?.endsWith('/content'))).toBe(false);
  expect(mock.history.post).toHaveLength(0);
});

it('stops a failing scan refresh and keeps decisions disabled until a successful read', async () => {
  await setup();
  mock.onGet(PATH).reply(500);
  await tick(IDENTITY_SCAN_REFRESH_MS + 10);
  expect(screen.getByTestId('review-private-note')).toHaveValue('Keep this private review note');
  expect(screen.getByTestId('review-approve')).toBeDisabled();
  const requests = mock.history.get.filter((request) => request.url === PATH).length;
  await tick(IDENTITY_SCAN_REFRESH_MS * 3);
  expect(mock.history.get.filter((request) => request.url === PATH)).toHaveLength(requests);
  fireEvent.click(screen.getByTestId('review-approve'));
  expect(mock.history.post).toHaveLength(0);
  mock.onGet(PATH).reply(200, review);
  fireEvent.click(screen.getByTestId('review-refresh'));
  await tick(10);
  expect(screen.getByTestId('review-approve')).toBeEnabled();
  expect(screen.getByTestId('review-private-note')).toHaveValue('Keep this private review note');
});

it('revalidates a cached dossier under the application cache defaults before allowing approval', async () => {
  qc.clear();
  qc = createAuthQueryClient();
  qc.setQueryData(reviewQueryKey('provider-1'), review);
  let finish!: (response: [number, unknown]) => void;
  mock.onGet(PATH).reply(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <AdminProviderReviewWorkspace providerProfileId="provider-1" />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(screen.getByTestId('review-approve')).toBeDisabled();
  fireEvent.click(screen.getByTestId('review-approve'));
  expect(screen.queryByTestId('review-confirm')).not.toBeInTheDocument();
  await tick(10);
  finish([200, { ...review, availableActions: [] }]);
  await tick(10);
  expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
  expect(mock.history.post).toHaveLength(0);
});
