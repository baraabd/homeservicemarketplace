import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ReviewEvidenceCorrection } from '../components/ReviewEvidenceCorrection';
import { reviewFixture } from './fixtures';

const PATH = '/v1/admin/providers/provider-1/review/request-changes';
let mock: MockAdapter;
let client: QueryClient;
const refresh = vi.fn<() => Promise<unknown>>(async () => undefined);
function tree(review: AdminProviderReview, kind: 'identity' | 'portfolio' = 'identity', readOnly = false) {
  return <QueryClientProvider client={client}><LanguageProvider>
    <ReviewEvidenceCorrection review={review} lang="en" onChanged={refresh}
      readOnly={readOnly} kind={kind} itemId={kind === 'portfolio' ? 'image-1' : undefined} />
  </LanguageProvider></QueryClientProvider>;
}
function open(kind: 'identity' | 'portfolio' = 'identity') {
  fireEvent.click(screen.getByTestId(kind === 'identity'
    ? 'review-identity-request-replacement' : 'review-portfolio-request-replacement-image-1'));
}
function write(message = 'Please upload a clearer replacement image.') {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: message } });
}
function send() { fireEvent.click(screen.getByTestId('review-evidence-correction-send')); }

beforeEach(() => {
  localStorage.clear();
  refresh.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mock = new MockAdapter(api);
  mock.onPost(PATH).reply(200, { changed: true, review: reviewFixture() });
});
afterEach(() => { mock.restore(); client.clear(); });

describe('provider-visible evidence correction requests', () => {
  it('can request missing identity evidence without pretending a case or verified file exists', async () => {
    const review = reviewFixture();
    review.verification = null;
    render(tree(review)); open(); write(); send();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const body = JSON.parse(mock.history.post[0].data);
    expect(body).toMatchObject({
      submissionId: 'submission-1', expectedRevision: 'a'.repeat(64),
      feedback: [{ taskId: 'BASICS_IDENTITY', field: 'identityDocument', providerMessage: 'Please upload a clearer replacement image.' }],
    });
    expect(body.idempotencyKey).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('note');
    expect(body.feedback[0]).not.toHaveProperty('itemId');
    expect(mock.history.get).toHaveLength(0);
    expect(mock.history.post.map((request) => request.url)).toEqual([PATH]);
  });
  it('requires a non-empty provider-visible message', () => {
    render(tree(reviewFixture())); open(); write('   '); send();
    expect(screen.getByText('Write a message for the provider.')).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });
  it('targets the exact portfolio image without requiring a successful private-image download', async () => {
    render(tree(reviewFixture(), 'portfolio')); open('portfolio'); write('Please replace this photo.'); send();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(JSON.parse(mock.history.post[0].data).feedback).toEqual([{
      taskId: 'PORTFOLIO', field: 'portfolio', itemId: 'image-1',
      reasonCode: 'INFORMATION_UNCLEAR', providerMessage: 'Please replace this photo.',
    }]);
    expect(mock.history.get).toHaveLength(0);
    expect(mock.history.patch).toHaveLength(0);
  });
  it('does not offer a command absent from server actions or without decision permission', () => {
    const review = reviewFixture(); review.availableActions = ['approve'];
    const view = render(tree(review));
    expect(screen.queryByTestId('review-identity-request-replacement')).not.toBeInTheDocument();
    review.availableActions = ['requestChanges']; review.permissions.canDecide = false;
    view.rerender(tree(review));
    expect(screen.queryByTestId('review-identity-request-replacement')).not.toBeInTheDocument();
  });
  it('pauses a pending dialog on stale revision and preserves the unsent message', () => {
    const review = reviewFixture();
    const view = render(tree(review)); open(); write('Keep this explanation.');
    view.rerender(tree({ ...review, revision: 'b'.repeat(64) }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep this explanation.');
    expect(screen.getByTestId('review-evidence-correction-send')).toBeDisabled();
    send(); expect(mock.history.post).toHaveLength(0);
  });
  it('does not retarget a pending request when the provider changes', () => {
    const review = reviewFixture(); const view = render(tree(review)); open(); write();
    view.rerender(tree({ ...review, provider: { ...review.provider, id: 'provider-2' } }));
    expect(screen.getByTestId('review-evidence-correction-send')).toBeDisabled();
    send(); expect(mock.history.post).toHaveLength(0);
  });
  it('does not send from a dialog while the dossier is read-only', () => {
    const review = reviewFixture(); const view = render(tree(review)); open(); write();
    view.rerender(tree(review, 'identity', true));
    expect(screen.getByTestId('review-evidence-correction-send')).toBeDisabled();
    expect(mock.history.post).toHaveLength(0);
  });
  it('keeps text and requires a new review after a server conflict', async () => {
    mock.onPost(PATH).reply(409, { code: 'CONFLICT' });
    render(tree(reviewFixture())); open(); write(); send();
    await waitFor(() => expect(screen.getByTestId('review-evidence-correction-send')).toBeDisabled());
    expect(screen.getByRole('textbox')).toHaveValue('Please upload a clearer replacement image.');
    expect(refresh).not.toHaveBeenCalled();
  });
  it('reuses the same idempotency key for an unchanged request after a lost response', async () => {
    mock.onPost(PATH).replyOnce(500, {}).onPost(PATH).reply(200, { changed: false, review: reviewFixture() });
    render(tree(reviewFixture())); open(); write(); send();
    await screen.findByText('The request could not be confirmed. Your message has been kept; retry when the connection is restored.');
    await waitFor(() => expect(screen.getByTestId('review-evidence-correction-send')).toBeEnabled());
    send(); await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mock.history.post).toHaveLength(2);
    expect(JSON.parse(mock.history.post[0].data)).toEqual(JSON.parse(mock.history.post[1].data));
  });
  it('does not resend an acknowledged command when only refresh fails', async () => {
    refresh.mockRejectedValueOnce(new Error('refresh unavailable'));
    render(tree(reviewFixture())); open(); write(); send();
    await screen.findByText('The request was recorded, but the application could not be refreshed. Refresh the page; do not send a second request.');
    expect(mock.history.post).toHaveLength(1);
    expect(screen.getByTestId('review-identity-request-replacement')).toBeDisabled();
  });
});
