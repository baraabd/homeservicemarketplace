import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type {
  AdminProviderReview,
  AdminVerificationDocument,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ReviewIdentity } from '../components/ReviewIdentity';
import { IDENTITY_PREVIEW_LIFETIME_MS } from '../evidence/useIdentityPreview';
import { reviewFixture, STAMP } from './fixtures';

vi.mock('../evidence/IdentityPdfCanvas', () => ({
  IdentityPdfCanvas: () => <canvas data-testid="identity-evidence-pdf" />,
}));
const PATH = '/v1/verification/documents/document-1/content';
const evidence: AdminVerificationDocument = {
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
};
function fixture() {
  const review = reviewFixture();
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
    documents: [evidence],
    decisions: [],
    availableActions: [],
    blockedReason: null,
    workAccess: null,
  };
  return review;
}
let mock: MockAdapter;
let qc: QueryClient;
function setup(review: AdminProviderReview = fixture(), lang: 'en' | 'ar' = 'en') {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (next: AdminProviderReview) => (
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <ReviewIdentity review={next} lang={lang} onChanged={async () => undefined} />
      </LanguageProvider>
    </QueryClientProvider>
  );
  const result = render(tree(review));
  return { ...result, update: (next: AdminProviderReview) => result.rerender(tree(next)) };
}
async function open() {
  const button = screen.getByTestId('review-evidence-document-1');
  button.focus();
  fireEvent.click(button);
  await screen.findByTestId('identity-evidence-image');
  return button;
}
function close() {
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Close', exact: true }),
  );
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mock = new MockAdapter(api);
  mock.onGet(PATH).reply(200, new Blob(['PNG fixture'], { type: 'image/png' }));
  const NativeURL = URL;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:restricted-identity');
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  mock.restore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('restricted identity preview', () => {
  it('reads only after an explicit click, preserves the audited endpoint and releases bytes on close', async () => {
    setup();
    expect(mock.history.get).toHaveLength(0);
    const opener = await open();
    expect(mock.history.get).toHaveLength(1);
    expect(mock.history.get[0]).toMatchObject({
      url: PATH,
      responseType: 'blob',
      withCredentials: true,
    });
    expect(mock.history.get[0].signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByTestId('identity-evidence-image')).toHaveAttribute(
      'src',
      'blob:restricted-identity',
    );
    expect(qc.getQueryCache().getAll()).toEqual([]);
    expect(JSON.stringify(localStorage)).not.toContain('blob:restricted-identity');
    expect(JSON.stringify(sessionStorage)).not.toContain('blob:restricted-identity');
    close();
    await waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:restricted-identity'),
    );
    expect(mock.history.get[0].signal?.aborted).toBe(true);
    await waitFor(() => expect(opener).toHaveFocus());
  });
  it('fetches again on reopening and cannot redisplay old bytes when fresh authorization is denied', async () => {
    setup();
    await open();
    close();
    mock.onGet(PATH).reply(404);
    fireEvent.click(screen.getByTestId('review-evidence-document-1'));
    expect(screen.queryByTestId('identity-evidence-image')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Access or availability may have changed',
    );
    expect(mock.history.get).toHaveLength(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])(
    'never renders active or unknown content (%s)',
    async (type) => {
      mock.onGet(PATH).reply(200, new Blob(['<script>unsafe</script>'], { type }));
      setup();
      fireEvent.click(screen.getByTestId('review-evidence-document-1'));
      expect(await screen.findByRole('alert')).toHaveTextContent('cannot be previewed');
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(document.querySelector('iframe, object, embed')).toBeNull();
      expect(screen.queryByTestId('identity-evidence-image')).not.toBeInTheDocument();
    },
  );
  it('clears the preview immediately when refreshed permissions revoke evidence access', async () => {
    const result = setup();
    await open();
    const revoked = fixture();
    revoked.permissions.canViewEvidence = false;
    result.update(revoked);
    expect(screen.queryByTestId('identity-evidence-image')).not.toBeInTheDocument();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
    expect(mock.history.get).toHaveLength(1);
    expect(
      within(screen.getByRole('dialog')).queryByRole('button', { name: 'Reopen document' }),
    ).not.toBeInTheDocument();
    mock.onGet(PATH).reply(404);
    result.update(fixture());
    expect(screen.queryByTestId('identity-evidence-image')).not.toBeInTheDocument();
    await waitFor(() => expect(mock.history.get).toHaveLength(2));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  it('releases bytes on route unmount', async () => {
    const result = setup();
    await open();
    result.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:restricted-identity');
    expect(mock.history.get[0].signal?.aborted).toBe(true);
  });
  it('provides Arabic controls in a focus-contained RTL dialog', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    setup(fixture(), 'ar');
    await open();
    expect(screen.getByRole('dialog')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'تكبير', exact: true })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'ملاءمة النافذة' })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it('ignores a late response after close instead of creating a leaked object URL', async () => {
    let resolve!: (response: [number, Blob]) => void;
    mock.onGet(PATH).reply(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    setup();
    fireEvent.click(screen.getByTestId('review-evidence-document-1'));
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    close();
    await act(async () => {
      resolve([200, new Blob(['image'], { type: 'image/png' })]);
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('releases loaded bytes on unmount and session expiry', async () => {
    const result = setup();
    await open();
    act(() => window.dispatchEvent(new Event('auth:session-expired')));
    expect(screen.queryByTestId('identity-evidence-image')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    result.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it('expires resident bytes and requires a fresh explicit read to reopen', async () => {
    setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByTestId('review-evidence-document-1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('identity-evidence-image')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDENTITY_PREVIEW_LIFETIME_MS);
    });
    expect(screen.queryByTestId('identity-evidence-image')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('preview has expired');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(mock.history.get).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen document' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mock.history.get).toHaveLength(2);
  });
  it('uses a canvas renderer for PDFs without creating a navigable document URL', async () => {
    mock.onGet(PATH).reply(200, new Blob(['%PDF'], { type: 'application/pdf' }));
    setup();
    fireEvent.click(screen.getByTestId('review-evidence-document-1'));
    await screen.findByTestId('identity-evidence-pdf');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector('iframe, object, embed')).toBeNull();
  });
});
