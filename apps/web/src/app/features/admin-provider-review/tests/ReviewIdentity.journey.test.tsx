import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type {
  AdminVerificationCase,
  AdminVerificationDocument,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ReviewIdentity } from '../components/ReviewIdentity';
import { reviewFixture, STAMP } from './fixtures';

const doc: AdminVerificationDocument = {
  id: 'document-1',
  kind: 'INDIVIDUAL_IDENTITY',
  serviceCategoryId: null,
  serviceCategoryLabelEn: null,
  serviceCategoryLabelAr: null,
  detectedMimeType: 'image/png',
  sizeBytes: 100,
  displayFilename: 'identity.png',
  scanState: 'CLEAN',
  viewable: true,
  uploadedAt: STAMP,
  evidenceDeletedAt: null,
  supersededAt: null,
};
const kase: AdminVerificationCase = {
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
  documents: [doc],
  decisions: [],
  availableActions: [],
  blockedReason: 'NOT_SUBMITTED',
  workAccess: null,
};
let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  localStorage.clear();
  mock = new MockAdapter(api);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  qc.clear();
  mock.restore();
});

function setup(lang: 'en' | 'ar', patch: Partial<AdminVerificationCase> = {}, canView = true) {
  const review = reviewFixture();
  review.verification = { ...kase, ...patch };
  review.permissions.canViewEvidence = canView;
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <ReviewIdentity review={review} lang={lang} onChanged={async () => undefined} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

it.each(['en', 'ar'] as const)(
  'explains automatic scanning separately from human preview in %s',
  (lang) => {
    setup(lang, {
      // The admin checklist means received; a PENDING upload is already satisfied there.
      requirements: kase.requirements,
      documents: [{ ...doc, scanState: 'PENDING', viewable: false }],
    });
    const guidance = screen.getByTestId('review-identity-next-step');
    expect(guidance).toHaveAttribute('data-step', 'scanning');
    expect(guidance).toHaveTextContent(lang === 'ar' ? 'الفحص الآلي' : 'automatic safety check');
    expect(screen.getByTestId('review-evidence-document-1')).toBeDisabled();
    expect(screen.getByTestId('review-evidence-document-1')).toHaveTextContent(
      lang === 'ar' ? 'عرض الوثيقة للمراجعة' : 'View document for review',
    );
    expect(screen.getByTestId('review-evidence-download-document-1')).toBeDisabled();
    expect(screen.queryByTestId('review-case-approve')).not.toBeInTheDocument();
    expect(mock.history.get).toHaveLength(0);
  },
);

it.each(['en', 'ar'] as const)(
  'explains the provider submission still required after a clean upload in %s',
  (lang) => {
    setup(lang);
    const guidance = screen.getByTestId('review-identity-next-step');
    expect(guidance).toHaveAttribute('data-step', 'submit');
    expect(guidance).toHaveTextContent(lang === 'ar' ? 'إرسال للمراجعة' : 'Send for review');
    expect(screen.getByTestId('review-evidence-document-1')).toBeEnabled();
    expect(screen.queryByTestId('review-case-approve')).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  },
);

it.each(['SCAN_FAILED', 'QUARANTINED', 'REJECTED'] as const)(
  'keeps %s blocked with a next actor instead of granting access',
  (scanState) => {
    setup('en', {
      requirements: kase.requirements,
      documents: [{ ...doc, scanState, viewable: false }],
    });
    const guidance = screen.getByTestId('review-identity-next-step');
    expect(guidance).toHaveAttribute(
      'data-step',
      scanState === 'SCAN_FAILED' ? 'scanFailed' : 'replace',
    );
    expect(screen.getByTestId('review-evidence-document-1')).toBeDisabled();
    expect(screen.queryByTestId('review-case-approve')).not.toBeInTheDocument();
  },
);

it('routes a clean submitted case toward the existing application decision rather than inventing an activation command', () => {
  setup('en', {
    state: 'SUBMITTED',
    submittedAt: STAMP,
    blockedReason: null,
    availableActions: ['assign', 'approve'],
  });
  const guidance = screen.getByTestId('review-identity-next-step');
  expect(guidance).toHaveAttribute('data-step', 'review');
  expect(within(guidance).getByRole('link')).toHaveAttribute('href', '#review-decision-panel');
  expect(mock.history.post).toHaveLength(0);
});

it('keeps permission guidance distinct from the scan result', () => {
  setup('en', {}, false);
  expect(screen.getByTestId('review-identity-next-step')).toHaveAttribute(
    'data-step',
    'permission',
  );
  expect(screen.getByTestId('review-evidence-document-1')).toBeDisabled();
});

it('keeps a completed identity decision distinct from retention and the remaining work requirements', () => {
  setup('en', {
    state: 'VERIFIED',
    blockedReason: 'TERMINAL_STATE',
    documents: [{ ...doc, evidenceDeletedAt: STAMP, retentionState: 'ERASED', viewable: false }],
  });
  const guidance = screen.getByTestId('review-identity-next-step');
  expect(guidance).toHaveAttribute('data-step', 'verified');
  expect(guidance).toHaveTextContent('Work access still has separate requirements');
  expect(within(guidance).getByRole('link')).toHaveAttribute('href', '#review-decision-panel');
  expect(screen.queryByTestId('review-case-approve')).not.toBeInTheDocument();
  expect(mock.history.post).toHaveLength(0);
});

it.each([
  ['ACTION_REQUIRED', 'changes', 'address the requested changes'],
  ['REJECTED', 'restart', 'start fresh verification'],
  ['EXPIRED', 'renew', 'a fresh submission and an administrative review'],
] as const)(
  'explains the provider action for %s even with no admin command',
  (state, step, message) => {
    setup('en', { state });
    const guidance = screen.getByTestId('review-identity-next-step');
    expect(guidance).toHaveAttribute('data-step', step);
    expect(guidance).toHaveTextContent(message);
    expect(screen.queryByTestId('review-case-approve')).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  },
);

it('asks another reviewer to act when the server forbids self-review', () => {
  setup('ar', { blockedReason: 'SELF_REVIEW' });
  expect(screen.getByTestId('review-identity-next-step')).toHaveAttribute(
    'data-step',
    'selfReview',
  );
  expect(screen.getByTestId('review-identity-next-step')).toHaveTextContent('مراجع مخوّل آخر');
  expect(screen.queryByTestId('review-case-approve')).not.toBeInTheDocument();
});

it.each(['PENDING', 'SCAN_FAILED', 'QUARANTINED', 'REJECTED'] as const)(
  'keeps the reviewer as next actor after submission when an optional file is %s',
  (scanState) => {
    setup('en', {
      state: 'SUBMITTED',
      submittedAt: STAMP,
      blockedReason: null,
      availableActions: ['assign', 'requestAction'],
      documents: [
        doc,
        { ...doc, id: 'optional-license', kind: 'CATEGORY_LICENSE', scanState, viewable: false },
      ],
    });
    const guidance = screen.getByTestId('review-identity-next-step');
    expect(guidance).toHaveAttribute('data-step', 'review');
    expect(screen.getByTestId('review-evidence-optional-license')).toBeDisabled();
    expect(screen.getByTestId('review-case-requestAction')).toBeEnabled();
    expect(mock.history.post).toHaveLength(0);
  },
);

it.each(['DRAFT', 'ACTION_REQUIRED'] as const)(
  'does not let optional blocked files hide the provider submission step in %s',
  (state) => {
    const optional = ['PENDING', 'SCAN_FAILED', 'QUARANTINED', 'REJECTED'].map(
      (scanState, index) => ({
        ...doc,
        id: `optional-${index}`,
        kind: 'CATEGORY_LICENSE' as const,
        serviceCategoryId: `optional-category-${index}`,
        scanState: scanState as AdminVerificationDocument['scanState'],
        viewable: false,
      }),
    );
    setup('en', { state, documents: [doc, ...optional] });
    const guidance = screen.getByTestId('review-identity-next-step');
    expect(guidance).toHaveAttribute('data-step', state === 'DRAFT' ? 'submit' : 'changes');
    expect(guidance).toHaveTextContent('Send for review');
    for (const document of optional) {
      expect(screen.getByTestId(`review-evidence-${document.id}`)).toBeDisabled();
      expect(screen.getByTestId(`review-evidence-download-${document.id}`)).toBeDisabled();
    }
    expect(screen.queryByTestId('review-case-approve')).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  },
);

it('matches a missing required licence by category rather than treating an optional scan as its blocker', () => {
  setup('en', {
    requirements: [
      ...kase.requirements,
      {
        kind: 'CATEGORY_LICENSE',
        serviceCategoryId: 'required-trade',
        serviceCategoryLabelEn: null,
        serviceCategoryLabelAr: null,
        satisfied: false,
      },
    ],
    documents: [
      doc,
      {
        ...doc,
        id: 'optional-license',
        kind: 'CATEGORY_LICENSE',
        serviceCategoryId: 'other-trade',
        scanState: 'PENDING',
        viewable: false,
      },
    ],
  });
  expect(screen.getByTestId('review-identity-next-step')).toHaveAttribute('data-step', 'upload');
  expect(screen.getByTestId('review-evidence-optional-license')).toBeDisabled();
});
