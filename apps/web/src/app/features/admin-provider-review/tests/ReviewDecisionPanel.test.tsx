import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ReviewDecisionPanel } from '../components/ReviewDecisionPanel';
import { reviewFixture } from './fixtures';
import { REVIEW_COPY } from '../copy';
import { actionableReview } from './review-safety-fixtures';

let mock: MockAdapter;
beforeEach(() => {
  localStorage.clear();
  mock = new MockAdapter(api);
});
afterEach(() => mock.restore());

describe('field-specific correction commands', () => {
  it.each(['en', 'ar'] as const)(
    'identifies the provider resubmission step after identity approval in %s',
    (lang) => {
      const review = actionableReview();
      review.provider.providerStatus = 'REJECTED';
      review.provider.onboardingState = 'RETURNED';
      review.provider.verificationState = 'VERIFIED';
      review.verification!.state = 'VERIFIED';
      review.verification!.workAccess = {
        active: true,
        status: 'ACTIVE',
        source: 'VERIFICATION',
        grantedAt: '2026-11-09T20:27:00.000Z',
        expiresAt: null,
        revokedAt: null,
      };
      review.submission!.decision = 'RETURNED';
      review.availableActions = [];
      review.blockers = [
        { code: 'SUBMISSION_ALREADY_DECIDED', taskId: 'REVIEW_SUBMISSION' },
        { code: 'SUBMITTED_CONTENT_CHANGED', taskId: 'REVIEW_SUBMISSION' },
      ];
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
            ? 'على المهني مراجعة التعديلات وإعادة إرسال طلب الانضمام من حسابه. بعد الإرسال يصبح الطلب الجديد متاحًا للمراجعة هنا؛ توثيق الهوية لا يعيد إرسال الطلب تلقائيًا.'
            : 'The provider must review the corrections and resubmit the joining application from their account. The new submission can then be reviewed here; identity approval does not resubmit it automatically.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          lang === 'ar'
            ? 'توجد منحة عمل سارية، لكن المهني لا يستوفي متطلبات العمل الحالية. راجع سبب المنع قبل تغيير المنحة.'
            : 'A live work grant exists, but the provider does not meet the current work requirements. Review the blocker before changing the grant.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(REVIEW_COPY[lang].noActions)).not.toBeInTheDocument();
      expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
      expect(screen.queryByTestId('review-request-changes')).not.toBeInTheDocument();
      expect(mock.history.post).toHaveLength(0);
    },
  );

  it.each(['en', 'ar'] as const)(
    'distinguishes actual review permission denial from a returned application in %s',
    (lang) => {
      const review = reviewFixture();
      review.provider.onboardingState = 'RETURNED';
      review.submission!.decision = 'RETURNED';
      review.permissions.canDecide = false;
      review.availableActions = [];
      review.blockers = [{ code: 'PERMISSION_REQUIRED' }, { code: 'SUBMISSION_ALREADY_DECIDED' }];
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
            ? 'يمكنك الاطلاع على الملف، لكن حسابك لا يملك صلاحية اتخاذ قرار بشأن طلب الانضمام.'
            : 'You can view this file, but your account does not have permission to decide the joining application.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
    },
  );

  it.each(['en', 'ar'] as const)(
    'identifies missing evidence access without denying recorded decision permission in %s',
    (lang) => {
      const review = reviewFixture();
      review.provider.onboardingState = 'RETURNED';
      review.submission!.decision = 'RETURNED';
      review.permissions.canDecide = true;
      review.permissions.canViewEvidence = false;
      review.availableActions = [];
      review.blockers = [
        { code: 'PERMISSION_REQUIRED', taskId: 'BASICS_IDENTITY' },
        { code: 'SUBMISSION_ALREADY_DECIDED' },
      ];
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
      expect(screen.getByTestId('review-next-step')).toHaveTextContent(
        lang === 'ar'
          ? 'حسابك لا يملك صلاحية الاطلاع على وثائق الهوية. يجب أن يراجع الوثائق أدمن يملك هذه الصلاحية.'
          : 'Your account does not have permission to view identity evidence. An administrator with that permission must review the documents.',
      );
      expect(screen.queryByText(REVIEW_COPY[lang].noDecisionPermission)).not.toBeInTheDocument();
      expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
      expect(screen.queryByTestId('review-request-changes')).not.toBeInTheDocument();
      expect(mock.history.post).toHaveLength(0);
    },
  );

  it.each(['en', 'ar'] as const)(
    'explains resubmission for a withdrawn draft that retains its previous submission in %s',
    (lang) => {
      const review = reviewFixture();
      review.provider.providerStatus = 'DRAFT';
      review.provider.onboardingState = 'DRAFT';
      review.availableActions = [];
      review.blockers = [
        { code: 'REVIEW_NOT_PENDING', taskId: 'REVIEW_SUBMISSION' },
        { code: 'SUBMITTED_CONTENT_CHANGED', taskId: 'REVIEW_SUBMISSION' },
      ];
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
      expect(screen.getByTestId('review-next-step')).toHaveTextContent(
        lang === 'ar'
          ? 'طلب الانضمام لا ينتظر المراجعة حاليًا. على المهني متابعة استكماله وإرساله مجددًا قبل أن يتمكن الأدمن من اتخاذ قرار.'
          : 'The application is no longer awaiting review. The provider must resume it and submit it again before an administrator can decide.',
      );
      expect(screen.queryByText(REVIEW_COPY[lang].nextFirstSubmission)).not.toBeInTheDocument();
      expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
      expect(screen.queryByTestId('review-request-changes')).not.toBeInTheDocument();
      expect(mock.history.post).toHaveLength(0);
    },
  );

  it.each([
    [
      'NOT_SUBMITTED',
      'The provider must complete and submit the joining application before an administrator can review it.',
    ],
    [
      'SUBMITTED_CONTENT_CHANGED',
      'The provider must update and resubmit the application. Review the new submission before recording a decision.',
    ],
    [
      'ACCOUNT_INELIGIBLE',
      'Resolve the account restriction before continuing the application review.',
    ],
    ['SELF_REVIEW', 'Another authorized administrator must review this application.'],
  ] as const)(
    'explains the next actor for %s without inventing a review action',
    (code, message) => {
      const review = reviewFixture();
      review.availableActions = [];
      review.blockers = [{ code }];
      if (code === 'NOT_SUBMITTED') review.submission = null;
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
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
      expect(screen.queryByTestId('review-request-changes')).not.toBeInTheDocument();
    },
  );

  it('does not infer a missing work grant when identity metadata is absent', () => {
    const review = reviewFixture();
    review.verification = null;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LanguageProvider>
          <ReviewDecisionPanel review={review} lang="en" onChanged={vi.fn()} onDecided={vi.fn()} />
        </LanguageProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/live work grant/i)).not.toBeInTheDocument();
  });

  it.each(['en', 'ar'] as const)(
    'keeps recorded application approval separate from current work access in %s',
    (lang) => {
      const review = reviewFixture();
      review.provider.onboardingState = 'ACCEPTED';
      review.submission!.decision = 'ACCEPTED';
      review.availableActions = [];
      review.blockers = [{ code: 'SUBMISSION_ALREADY_DECIDED' }];
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
      expect(screen.getByTestId('review-next-step')).toHaveTextContent(
        lang === 'ar'
          ? 'سُجلت الموافقة على طلب الانضمام. تظهر صلاحيات العمل الحالية أدناه.'
          : 'Application approval is recorded. Current work access is shown below.',
      );
      expect(screen.getByText(REVIEW_COPY[lang].deniedCapability)).toBeInTheDocument();
      expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
    },
  );

  it.each(['en', 'ar'] as const)(
    'recognizes an accepted submission when the older response has no onboarding state in %s',
    (lang) => {
      const review = reviewFixture();
      review.provider.onboardingState = null;
      review.submission!.decision = 'ACCEPTED';
      review.availableActions = [];
      review.blockers = [{ code: 'SUBMISSION_ALREADY_DECIDED' }];
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
      expect(screen.getByTestId('review-next-step')).toHaveTextContent(
        lang === 'ar'
          ? 'سُجلت الموافقة على طلب الانضمام. تظهر صلاحيات العمل الحالية أدناه.'
          : 'Application approval is recorded. Current work access is shown below.',
      );
      expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
      expect(mock.history.post).toHaveLength(0);
    },
  );

  it.each([
    [false, false],
    [true, true],
  ])(
    'uses current grant activity %s and effective work access %s independently',
    (active, canWork) => {
      const review = actionableReview();
      review.canWork = canWork;
      review.verification!.workAccess = {
        active,
        status: 'ACTIVE',
        source: 'VERIFICATION',
        grantedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: active ? null : '2026-10-01T00:00:00.000Z',
        revokedAt: null,
      };
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
      expect(screen.queryByTestId('review-live-grant-blocked')).not.toBeInTheDocument();
    },
  );

  it.each([
    ['en', 'EVIDENCE_OBJECT_UNAVAILABLE', 'request replacement identity evidence'],
    ['ar', 'EVIDENCE_OBJECT_UNAVAILABLE', 'وثيقة هوية بديلة'],
    ['en', 'EVIDENCE_PREFLIGHT_STALE', 'The identity evidence changed during the evidence check'],
    ['ar', 'EVIDENCE_PREFLIGHT_STALE', 'تغيّرت وثائق الهوية أثناء التحقق من الأدلة'],
    ['en', 'EVIDENCE_NOT_READY', 'Check the current documents and their safety checks'],
    ['ar', 'EVIDENCE_NOT_READY', 'راجع الوثائق الحالية ونتائج فحص الأمان'],
  ] as const)(
    'explains %s approval conflict %s without losing the private note',
    async (lang, reason, hint) => {
      mock.onPost('/v1/admin/providers/provider-1/review/approve').reply(409, {
        error: {
          code: 'CONFLICT',
          message: 'private-storage-key-must-not-render',
          details: { reason },
        },
      });
      render(
        <QueryClientProvider client={new QueryClient()}>
          <LanguageProvider>
            <ReviewDecisionPanel
              review={reviewFixture()}
              lang={lang}
              onChanged={vi.fn()}
              onDecided={vi.fn()}
            />
          </LanguageProvider>
        </QueryClientProvider>,
      );
      fireEvent.change(screen.getByTestId('review-private-note'), {
        target: { value: 'Preserved investigation note' },
      });
      fireEvent.click(screen.getByTestId('review-approve'));
      fireEvent.click(screen.getByTestId('review-approval-ack'));
      fireEvent.click(screen.getByTestId('review-confirm'));
      expect(await screen.findByRole('alert')).toHaveTextContent(hint);
      expect(screen.getByTestId('review-private-note')).toHaveValue('Preserved investigation note');
      expect(screen.queryByTestId('review-confirm')).not.toBeInTheDocument();
      expect(screen.getByTestId('review-conflict-refresh')).toBeEnabled();
      expect(screen.queryByText('private-storage-key-must-not-render')).not.toBeInTheDocument();
      expect(mock.history.post).toHaveLength(1);
    },
  );
  it('keeps unknown conflicts on the safe existing message instead of showing arbitrary server content', async () => {
    mock.onPost('/v1/admin/providers/provider-1/review/approve').reply(409, {
      error: { message: 'private-storage-key-must-not-render', details: { reason: '__proto__' } },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LanguageProvider>
          <ReviewDecisionPanel
            review={reviewFixture()}
            lang="en"
            onChanged={vi.fn()}
            onDecided={vi.fn()}
          />
        </LanguageProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('review-approve'));
    fireEvent.click(screen.getByTestId('review-approval-ack'));
    fireEvent.click(screen.getByTestId('review-confirm'));
    expect(await screen.findByRole('alert')).toHaveTextContent(REVIEW_COPY.en.conflict);
    expect(screen.queryByText('private-storage-key-must-not-render')).not.toBeInTheDocument();
  });
  it.each(['ACCEPTED', 'RETURNED'] as const)(
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
          decision === 'ACCEPTED' ? 'Accepted' : 'Returned for changes',
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
