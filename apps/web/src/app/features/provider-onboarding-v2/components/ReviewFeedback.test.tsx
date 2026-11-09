import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderOnboardingFeedback } from '@homeservicemarketplace/contracts';

import { ReviewFeedback } from './ReviewFeedback';
import { feedbackTaskPath } from '../feedback-task-path';
import { REVIEW_FEEDBACK_COPY } from '../copy/review-feedback-copy';
import { VERIFICATION_CORRECTION_COPY } from '../copy/verification-correction-copy';

const feedback: ProviderOnboardingFeedback = {
  requestedAt: '2026-09-15T10:00:00.000Z',
  items: [
    {
      id: 'change-bio',
      taskId: 'PORTFOLIO',
      field: 'bio',
      reasonCode: 'MORE_DETAIL',
      providerMessage: 'Describe your service experience.',
    },
    {
      id: 'change-area',
      taskId: 'WORK_AREA',
      reasonCode: 'ADDRESS_UNCLEAR',
      providerMessage: 'يرجى توضيح منطقة العمل.',
    },
  ],
};

describe('requested changes in the Provider journey', () => {
  it('renders all public instructions and opens the existing task without clearing anything', () => {
    const onOpen = vi.fn();
    const onResubmit = vi.fn();
    render(
      <ReviewFeedback feedback={feedback} lang="en" onOpen={onOpen} onResubmit={onResubmit} />,
    );
    expect(screen.getByText(feedback.items[0].providerMessage)).toBeInTheDocument();
    expect(screen.getByText(feedback.items[1].providerMessage)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Review this task/ })[1]);
    expect(onOpen).toHaveBeenCalledWith('/provider/onboarding/WORK_AREA');
    fireEvent.click(screen.getByRole('button', { name: 'Review and resubmit' }));
    expect(onResubmit).toHaveBeenCalledOnce();
  });

  it('keeps a task screen focused on its own requested changes with Arabic copy', () => {
    render(<ReviewFeedback feedback={feedback} lang="ar" taskId="WORK_AREA" />);
    expect(screen.getByRole('heading', { name: 'التعديلات المطلوبة' })).toBeInTheDocument();
    expect(screen.getByText(feedback.items[1].providerMessage)).toBeInTheDocument();
    expect(screen.queryByText(feedback.items[0].providerMessage)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows no obsolete instruction when feedback is absent', () => {
    render(<ReviewFeedback feedback={null} lang="en" />);
    expect(screen.queryByTestId('review-feedback')).not.toBeInTheDocument();
  });

  for (const lang of ['en', 'ar'] as const) {
    const identityLabel = lang === 'ar' ? 'رفع وثائق الهوية' : 'Upload identity documents';
    const verificationLabel = lang === 'ar' ? 'رفع وثائق التوثيق' : 'Upload verification documents';
    const uploadHint =
      lang === 'ar'
        ? 'وثائق التوثيق خاصة ومنفصلة عن الصورة الشخصية التي يراها العملاء.'
        : 'Verification documents are private and separate from the profile photo customers see.';

    for (const taskId of [undefined, 'BASICS_IDENTITY']) {
      it(`names the identity upload action and opens it from ${taskId ?? 'the hub'} (${lang})`, () => {
        const onOpen = vi.fn();
        render(
          <ReviewFeedback
            feedback={{
              ...feedback,
              items: [
                {
                  ...feedback.items[0],
                  taskId: 'BASICS_IDENTITY',
                  field: 'identityDocument',
                  providerMessage: 'Send a clear identity document.',
                },
              ],
            }}
            lang={lang}
            taskId={taskId}
            onOpen={onOpen}
          />,
        );

        expect(screen.getByText(uploadHint)).toBeInTheDocument();
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(
          screen.queryByRole('button', {
            name: lang === 'ar' ? /^مراجعة هذه المهمة:/ : /^Review this task:/,
          }),
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: identityLabel }));
        expect(onOpen).toHaveBeenCalledExactlyOnceWith('/provider/verification');
      });
    }

    for (const field of ['verificationDocuments', 'categoryLicense']) {
      it(`opens the named verification upload for ${field} (${lang})`, () => {
        const onOpen = vi.fn();
        const taskId = field === 'categoryLicense' ? 'SERVICES_EXPERIENCE' : 'BASICS_IDENTITY';
        render(
          <ReviewFeedback
            feedback={{ ...feedback, items: [{ ...feedback.items[0], taskId, field }] }}
            lang={lang}
            taskId={taskId}
            onOpen={onOpen}
          />,
        );

        expect(screen.getByText(uploadHint)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: identityLabel })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: verificationLabel }));
        expect(onOpen).toHaveBeenCalledExactlyOnceWith('/provider/verification');
      });
    }

    it(`preserves the named basic field correction and its separate verification entry (${lang})`, () => {
      const onOpen = vi.fn();
      render(
        <ReviewFeedback
          feedback={{
            ...feedback,
            items: [{ ...feedback.items[0], taskId: 'BASICS_IDENTITY', field: 'phoneNumber' }],
          }}
          lang={lang}
          taskId="BASICS_IDENTITY"
          onOpen={onOpen}
        />,
      );

      expect(screen.queryByText(uploadHint)).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', {
          name: lang === 'ar' ? /^مراجعة هذه المهمة:/ : /^Review this task:/,
        }),
      );
      expect(onOpen).toHaveBeenLastCalledWith(
        '/provider/onboarding/BASICS_IDENTITY?reviewField=phoneNumber',
      );
      fireEvent.click(
        screen.getByRole('button', { name: REVIEW_FEEDBACK_COPY[lang].viewVerification }),
      );
      expect(onOpen).toHaveBeenLastCalledWith('/provider/verification');
    });
  }

  it('treats reviewer text as text, including markup', () => {
    const message = '<script>alert("unsafe")</script>';
    const { container } = render(
      <ReviewFeedback
        lang="en"
        feedback={{ ...feedback, items: [{ ...feedback.items[0], providerMessage: message }] }}
      />,
    );
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });

  it('routes document corrections to the reachable verification journey and gallery corrections to the gallery', () => {
    expect(
      feedbackTaskPath({
        ...feedback.items[0],
        taskId: 'BASICS_IDENTITY',
        field: 'identityDocument',
      }),
    ).toBe('/provider/verification');
    expect(feedbackTaskPath({ ...feedback.items[0], itemId: 'image-1' })).toBe(
      '/provider/onboarding/PORTFOLIO?reviewField=portfolio&reviewItem=image-1#portfolio',
    );
    expect(
      feedbackTaskPath({
        ...feedback.items[0],
        taskId: 'SERVICES_EXPERIENCE',
        field: 'yearsOfExperience',
      }),
    ).toBe('/provider/onboarding/SERVICES_EXPERIENCE?reviewField=yearsOfExperience#experience');
    expect(Object.keys(REVIEW_FEEDBACK_COPY.en)).toEqual(Object.keys(REVIEW_FEEDBACK_COPY.ar));
    expect(Object.keys(VERIFICATION_CORRECTION_COPY.en)).toEqual(
      Object.keys(VERIFICATION_CORRECTION_COPY.ar),
    );
  });

  it('shows a named field and opens consent or gallery corrections in the exact existing sub-screen', () => {
    render(<ReviewFeedback feedback={feedback} lang="ar" />);
    expect(screen.getByText('نبذة عن المهني')).toBeInTheDocument();
    expect(
      feedbackTaskPath({ ...feedback.items[0], taskId: 'REVIEW_SUBMISSION', field: 'consent' }),
    ).toBe('/provider/onboarding/REVIEW_SUBMISSION?reviewField=consent#terms');
    expect(feedbackTaskPath({ ...feedback.items[0], field: 'portfolio' })).toBe(
      '/provider/onboarding/PORTFOLIO?reviewField=portfolio#portfolio',
    );
  });
});
