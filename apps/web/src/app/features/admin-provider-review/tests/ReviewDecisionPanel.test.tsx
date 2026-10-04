import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ReviewDecisionPanel } from '../components/ReviewDecisionPanel';
import { reviewFixture } from './fixtures';
import { REVIEW_COPY } from '../copy';

let mock: MockAdapter;
beforeEach(() => {
  localStorage.clear();
  mock = new MockAdapter(api);
});
afterEach(() => mock.restore());

describe('field-specific correction commands', () => {
  it.each(['APPROVED', 'RETURNED'] as const)(
    'keeps the recorded %s decision visible in the decision panel',
    (decision) => {
      const review = reviewFixture();
      review.submission!.decision = decision;
      review.availableActions = [];
      review.blockers = [{ code: 'SUBMISSION_ALREADY_DECIDED', taskId: 'REVIEW_SUBMISSION' }];
      render(
        <QueryClientProvider client={new QueryClient()}>
          <LanguageProvider>
            <ReviewDecisionPanel
              review={review}
              lang="en"
              onChanged={vi.fn()}
              onDecided={vi.fn()}
            />
          </LanguageProvider>
        </QueryClientProvider>,
      );
      expect(
        within(screen.getByTestId('review-recorded-decision')).getByText(
          decision === 'APPROVED' ? 'Approved' : 'Returned for changes',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('Current review status')).toBeInTheDocument();
      expect(screen.queryByText(REVIEW_COPY.en.blockers)).not.toBeInTheDocument();
    },
  );
  it('does not label a correction-only workflow as ready for approval', () => {
    const review = reviewFixture();
    review.availableActions = ['requestChanges'];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LanguageProvider>
          <ReviewDecisionPanel review={review} lang="en" onChanged={vi.fn()} onDecided={vi.fn()} />
        </LanguageProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText(REVIEW_COPY.en.ready)).not.toBeInTheDocument();
    expect(screen.getByTestId('review-request-changes')).toBeEnabled();
    expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
  });
  it.each(['en', 'ar'] as const)(
    'explains an existing non-pending submission accurately in %s',
    (lang) => {
      const review = reviewFixture();
      review.availableActions = [];
      review.blockers = [{ code: 'REVIEW_NOT_PENDING', taskId: 'REVIEW_SUBMISSION' }];
      render(
        <QueryClientProvider client={new QueryClient()}>
          <LanguageProvider>
            <ReviewDecisionPanel
              review={review}
              lang={lang}
              onChanged={vi.fn()}
              onDecided={vi.fn()}
            />
          </LanguageProvider>
        </QueryClientProvider>,
      );
      expect(
        screen.getByText(
          lang === 'ar'
            ? 'هذا الطلب لا ينتظر قرارًا إداريًا حاليًا. راجع حالته الحالية قبل المتابعة.'
            : 'This application is not currently awaiting an administrative decision. Check its current state before continuing.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          lang === 'ar' ? 'لم يُرسل طلب للمراجعة.' : 'No application has been submitted.',
        ),
      ).not.toBeInTheDocument();
    },
  );
  it('submits the selected editable field with its instruction and keeps internal notes separate', async () => {
    const review = reviewFixture();
    const decided = vi.fn();
    mock
      .onPost('/v1/admin/providers/provider-1/review/request-changes')
      .reply(200, { changed: true, review });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LanguageProvider>
          <ReviewDecisionPanel review={review} lang="en" onChanged={vi.fn()} onDecided={decided} />
        </LanguageProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByTestId('review-private-note'), {
      target: { value: 'Internal context' },
    });
    fireEvent.click(screen.getByTestId('review-request-changes'));
    fireEvent.change(screen.getByTestId('review-correction-task-0'), {
      target: { value: 'WORK_AREA' },
    });
    expect(screen.queryByRole('option', { name: 'Travel radius' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('review-correction-field-0'), {
      target: { value: 'serviceAreaCity' },
    });
    fireEvent.change(screen.getByTestId('review-correction-message-0'), {
      target: { value: 'Please confirm your city.' },
    });
    fireEvent.click(screen.getByTestId('review-confirm'));
    await waitFor(() => expect(decided).toHaveBeenCalledOnce());
    const payload = JSON.parse(mock.history.post[0].data);
    expect(payload).toMatchObject({
      submissionId: 'submission-1',
      expectedRevision: 'a'.repeat(64),
      note: 'Internal context',
      feedback: [
        {
          taskId: 'WORK_AREA',
          field: 'serviceAreaCity',
          providerMessage: 'Please confirm your city.',
        },
      ],
    });
    expect(JSON.stringify(payload.feedback)).not.toContain('Internal context');
  });
});
