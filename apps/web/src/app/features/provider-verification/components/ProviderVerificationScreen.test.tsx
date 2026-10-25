import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import * as verificationApi from '../../../../lib/provider/provider-verification-api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ProviderVerificationScreen } from './ProviderVerificationScreen';
import { AXIS_COPY, STATE_COPY, UI_COPY } from '../copy/provider-verification-copy';

// Sprint 9B.11 — the provider verification screen.
//
// The state machine has its own test; this asserts what a person actually sees
// and can do: the right screen for the right state, the five axes kept apart,
// the loading/empty/offline/error paths, and Arabic.

const CAPS_URL = '/v1/me/provider/capabilities';
const CASE_URL = '/v1/me/provider/verification/case';
const PROFILE_URL = '/v1/me/provider/profile';

let mock: MockAdapter;

const caps = (
  allowed: string[] = ['MANAGE_VERIFICATION'],
  primaryReason: string | null = null,
) => ({
  capabilities: [],
  allowed,
  nextActions: [],
  primaryReason,
});

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  kind: 'INDIVIDUAL_IDENTITY',
  serviceCategoryId: null,
  scanState: 'CLEAN',
  uploadedAt: '2026-08-01T00:00:00.000Z',
  superseded: false,
  ...over,
});

/**
 * The actions the SERVER would offer for a given case state.
 *
 * Mirrors `offerableCaseActions(state, 'provider')`: the transition table
 * gives a provider `submit` from DRAFT and from ACTION_REQUIRED — resubmission
 * is the same edge — and nothing from any other state.
 *
 * Defaulting every fixture to `['submit']` would manufacture responses the
 * API cannot produce (a SUBMITTED case offering submit), and hide exactly the
 * mismatch these fixtures exist to catch. Tests that need a specific list —
 * the fail-closed cases — override it explicitly.
 */
function actionsFor(state: string): 'submit'[] {
  return state === 'DRAFT' || state === 'ACTION_REQUIRED' ? ['submit'] : [];
}
const kase = (over: Record<string, unknown> = {}) => {
  const state = (over.state as string) ?? 'DRAFT';
  return {
    case: {
      id: 'c1',
      state,
      policyVersion: 'v1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      submittedAt: null,
      verificationRequired: true,
      requirements: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null }],
      documents: [],
      latestDecision: null,
      availableActions: actionsFor(state),
      ...over,
    },
  };
};

const PROFILE = (over: Record<string, unknown> = {}) => ({
  profile: { id: 'pp-1', verified: false, topPro: false, ...over },
});

function renderScreen(lang: 'en' | 'ar' = 'en') {
  window.localStorage.setItem('hsm.lang', lang);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <ProviderVerificationScreen />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** Wires the three queries the screen reads. */
function stub(options: {
  caps?: ReturnType<typeof caps>;
  kase?: ReturnType<typeof kase> | { case: null };
  profile?: ReturnType<typeof PROFILE>;
}) {
  mock.onGet(CAPS_URL).reply(200, options.caps ?? caps());
  mock.onGet(CASE_URL).reply(200, options.kase ?? { case: null });
  mock.onGet(PROFILE_URL).reply(200, options.profile ?? PROFILE());
}

beforeEach(() => {
  mock = new MockAdapter(api);
  window.localStorage.clear();
});

afterEach(() => {
  mock.restore();
  vi.restoreAllMocks();
});

describe('loading, failure and offline', () => {
  it('announces a busy state while loading', async () => {
    mock.onGet(CAPS_URL).reply(() => new Promise(() => {}));
    mock.onGet(CASE_URL).reply(() => new Promise(() => {}));
    mock.onGet(PROFILE_URL).reply(200, PROFILE());
    renderScreen();

    expect(await screen.findByText(UI_COPY.en.loading)).toBeInTheDocument();
  });

  it('offers a retry when the surface cannot be loaded', async () => {
    mock.onGet(CAPS_URL).reply(500);
    mock.onGet(CASE_URL).reply(500);
    mock.onGet(PROFILE_URL).reply(200, PROFILE());
    renderScreen();

    expect(await screen.findByRole('alert')).toHaveTextContent(UI_COPY.en.loadFailed);
    expect(screen.getByRole('button', { name: UI_COPY.en.retry })).toBeInTheDocument();
  });

  it('tells the provider when they are offline', async () => {
    // This screen is used on a phone, often in a customer's home with poor
    // signal. A failed upload that looks like a rejection is the worst
    // possible misreading.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    stub({});
    renderScreen();

    expect(await screen.findByTestId('verification-offline')).toHaveTextContent(UI_COPY.en.offline);
  });
});

describe('each state gets its own screen', () => {
  it.each([
    ['ACCOUNT_LOCKED', { caps: caps([], 'ACCOUNT_INELIGIBLE') }],
    ['SUSPENDED', { caps: caps([], 'PROVIDER_SUSPENDED') }],
    ['ONBOARDING_INCOMPLETE', { caps: caps([], 'ONBOARDING_INCOMPLETE') }],
    ['NOT_STARTED', { kase: { case: null } }],
    ['NOT_REQUIRED', { kase: kase({ verificationRequired: false, requirements: [] }) }],
    ['EVIDENCE_REQUIRED', { kase: kase({ documents: [] }) }],
    ['SCANNING', { kase: kase({ requirements: [], documents: [doc({ scanState: 'PENDING' })] }) }],
    ['EVIDENCE_UNUSABLE', { kase: kase({ documents: [doc({ scanState: 'QUARANTINED' })] }) }],
    ['READY_TO_SUBMIT', { kase: kase({ documents: [doc()] }) }],
    ['PENDING_REVIEW', { kase: kase({ state: 'SUBMITTED' }) }],
    ['CHANGES_REQUESTED', { kase: kase({ state: 'ACTION_REQUIRED' }) }],
    ['REJECTED', { kase: kase({ state: 'REJECTED' }) }],
    ['VERIFIED_NO_ACCESS', { kase: kase({ state: 'VERIFIED' }) }],
    // Sprint 9B.24 — the fifteenth state. An EXPIRED case is a different
    // instruction from a verified one with no grant, so it gets its own row.
    ['REVERIFICATION_REQUIRED', { kase: kase({ state: 'EXPIRED' }) }],
  ])('renders %s with its own title', async (state, options) => {
    stub(options as Parameters<typeof stub>[0]);
    renderScreen();

    const section = await screen.findByTestId(`verification-${state}`);
    expect(section).toHaveTextContent(STATE_COPY.en[state as keyof typeof STATE_COPY.en].title);
  });

  it('renders VERIFIED_ACTIVE when the grant is live', async () => {
    stub({ caps: caps(['SUBMIT_BID']), kase: kase({ state: 'VERIFIED' }) });
    renderScreen();
    expect(await screen.findByTestId('verification-VERIFIED_ACTIVE')).toBeInTheDocument();
  });

  it('offers no action where nothing can be done', async () => {
    // Offering a button that cannot help teaches people to tap and hope.
    stub({ kase: kase({ state: 'SUBMITTED' }) });
    renderScreen();
    await screen.findByTestId('verification-PENDING_REVIEW');

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never offers an upload to a suspended provider', async () => {
    // The precedence, observed at the surface rather than only in the pure
    // function: an upload button here invites work the API will refuse.
    stub({
      caps: caps([], 'PROVIDER_SUSPENDED'),
      kase: kase({ documents: [doc({ scanState: 'QUARANTINED' })] }),
    });
    renderScreen();
    await screen.findByTestId('verification-SUSPENDED');

    expect(
      screen.queryByRole('button', { name: STATE_COPY.en.EVIDENCE_UNUSABLE.cta as string }),
    ).not.toBeInTheDocument();
  });
});

describe('the five axes stay visibly apart', () => {
  it('shows the three access axes with their value in TEXT', async () => {
    // A badge whose only signal is colour says nothing to a screen reader.
    stub({ caps: caps(['SUBMIT_BID']), profile: PROFILE({ verified: true }) });
    renderScreen();

    const axes = await screen.findByTestId('verification-axes');
    expect(within(axes).getByTestId('axis-onboardingComplete')).toHaveTextContent(AXIS_COPY.en.yes);
    expect(within(axes).getByTestId('axis-identityVerified')).toHaveTextContent(AXIS_COPY.en.yes);
    expect(within(axes).getByTestId('axis-workAccessActive')).toHaveTextContent(AXIS_COPY.en.yes);
  });

  it('distinguishes verified-but-cannot-work', async () => {
    // The distinction the whole sprint turns on. Telling a verified provider
    // they are unverified would send them to re-upload documents that are
    // perfectly good.
    stub({
      caps: caps([]),
      kase: kase({ state: 'VERIFIED' }),
      profile: PROFILE({ verified: true }),
    });
    renderScreen();

    const axes = await screen.findByTestId('verification-axes');
    expect(within(axes).getByTestId('axis-identityVerified')).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(within(axes).getByTestId('axis-workAccessActive')).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  it('shows Featured separately, and says it grants nothing', async () => {
    stub({ profile: PROFILE({ topPro: true }) });
    renderScreen();

    expect(await screen.findByTestId('axis-featured')).toBeInTheDocument();
    expect(screen.getByTestId('verification-badge-note')).toHaveTextContent(AXIS_COPY.en.badgeNote);
  });

  it('hides the recognition row entirely when neither is held', async () => {
    // "VIP — Not yet" would read as something withheld from them, which is a
    // sales message on a compliance screen.
    stub({ profile: PROFILE({ topPro: false }) });
    renderScreen();
    await screen.findByTestId('verification-axes');

    expect(screen.queryByTestId('verification-recognition')).not.toBeInTheDocument();
    expect(screen.queryByTestId('axis-vip')).not.toBeInTheDocument();
  });

  it('Featured does not turn on the work-access axis', async () => {
    // ADR 0005 axis 5: recognition must never grant a capability.
    stub({ caps: caps([]), profile: PROFILE({ topPro: true }) });
    renderScreen();

    const axes = await screen.findByTestId('verification-axes');
    expect(within(axes).getByTestId('axis-workAccessActive')).toHaveAttribute(
      'data-active',
      'false',
    );
  });
});

describe('documents and what the reviewer said', () => {
  it('shows each document with its scan verdict', async () => {
    stub({
      kase: kase({
        requirements: [],
        documents: [doc({ id: 'a' }), doc({ id: 'b', scanState: 'QUARANTINED' })],
      }),
    });
    renderScreen();

    const list = await screen.findByTestId('verification-documents');
    expect(within(list).getByTestId('document-a')).toHaveAttribute('data-scan', 'CLEAN');
    expect(within(list).getByTestId('document-b')).toHaveAttribute('data-scan', 'QUARANTINED');
  });

  it('says nothing has been sent when nothing has', async () => {
    stub({ kase: kase({ documents: [] }) });
    renderScreen();
    expect(await screen.findByTestId('verification-no-documents')).toBeInTheDocument();
  });

  it('renders the reviewer reason as an instruction, not a code', async () => {
    stub({
      kase: kase({
        state: 'ACTION_REQUIRED',
        latestDecision: {
          outcome: 'ACTION_REQUIRED',
          reasonCode: 'DOCUMENT_ILLEGIBLE',
          decidedAt: '2026-08-02T00:00:00.000Z',
        },
      }),
    });
    renderScreen();

    const reason = await screen.findByTestId('verification-reason');
    expect(reason).toHaveTextContent('clearer photo');
    expect(reason).not.toHaveTextContent('DOCUMENT_ILLEGIBLE');
  });

  it('falls back rather than showing a raw code the provider cannot fix', async () => {
    stub({
      kase: kase({
        state: 'REJECTED',
        latestDecision: {
          outcome: 'REJECTED',
          reasonCode: 'SOMETHING_NEW_2027',
          decidedAt: '2026-08-02T00:00:00.000Z',
        },
      }),
    });
    renderScreen();

    const reason = await screen.findByTestId('verification-reason');
    expect(reason).not.toHaveTextContent('SOMETHING_NEW_2027');
  });
});

describe('starting and submitting', () => {
  it('starts missing identity verification after an admin returns the application for correction', async () => {
    stub({
      caps: caps(['MANAGE_VERIFICATION', 'COMPLETE_ONBOARDING'], 'ONBOARDING_INCOMPLETE'),
    });
    mock.onPost(CASE_URL).reply(() => {
      mock.onGet(CASE_URL).reply(200, kase());
      return [201, { ...kase(), created: true }];
    });
    renderScreen();

    fireEvent.click(
      await screen.findByRole('button', { name: STATE_COPY.en.NOT_STARTED.cta as string }),
    );
    await screen.findByTestId('verification-EVIDENCE_REQUIRED');
    expect(screen.getByLabelText(UI_COPY.en.uploadLabel)).toBeInTheDocument();
    expect(screen.getByTestId('axis-onboardingComplete')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('axis-workAccessActive')).toHaveAttribute('data-active', 'false');
  });

  it.each([
    ['case creation', { case: null }],
    ['upload', kase()],
    ['submission', kase({ documents: [doc()] })],
    ['resubmission', kase({ state: 'ACTION_REQUIRED', documents: [doc()] })],
  ])(
    'offers no %s action when the server withholds MANAGE_VERIFICATION',
    async (_action, response) => {
      stub({ caps: caps([]), kase: response });
      renderScreen();
      await screen.findByTestId('verification-axes');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(UI_COPY.en.uploadLabel)).not.toBeInTheDocument();
    },
  );

  it('starts a case from the not-started screen', async () => {
    let started = false;
    stub({ kase: { case: null } });
    mock.onPost(CASE_URL).reply(() => {
      started = true;
      return [200, kase()];
    });
    renderScreen();

    fireEvent.click(
      await screen.findByRole('button', { name: STATE_COPY.en.NOT_STARTED.cta as string }),
    );
    await waitFor(() => expect(started).toBe(true));
  });

  it('submits when everything is supplied', async () => {
    let submitted = false;
    stub({ kase: kase({ documents: [doc()] }) });
    mock.onPost(`${CASE_URL}/submit`).reply(() => {
      submitted = true;
      return [200, {}];
    });
    renderScreen();

    fireEvent.click(
      await screen.findByRole('button', { name: STATE_COPY.en.READY_TO_SUBMIT.cta as string }),
    );
    await waitFor(() => expect(submitted).toBe(true));
  });

  it.each(['en', 'ar'] as const)(
    'resubmits corrected identity evidence with the reviewer reason still visible in %s',
    async (lang) => {
      let submitted = false;
      stub({
        caps: caps(['MANAGE_VERIFICATION', 'COMPLETE_ONBOARDING'], 'ONBOARDING_INCOMPLETE'),
        kase: kase({
          state: 'ACTION_REQUIRED',
          documents: [doc({ superseded: true }), doc({ id: 'replacement' })],
          latestDecision: {
            outcome: 'ACTION_REQUIRED',
            reasonCode: 'DOCUMENT_ILLEGIBLE',
            decidedAt: '2026-08-02T00:00:00.000Z',
          },
        }),
      });
      mock.onPost(`${CASE_URL}/submit`).reply(() => {
        submitted = true;
        mock
          .onGet(CASE_URL)
          .reply(200, kase({ state: 'SUBMITTED', documents: [doc({ id: 'replacement' })] }));
        return [200, {}];
      });
      renderScreen(lang);

      const submit = await screen.findByRole('button', { name: UI_COPY[lang].resubmit });
      expect(screen.getByTestId('verification-reason')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: STATE_COPY[lang].CHANGES_REQUESTED.cta as string }),
      ).toBeInTheDocument();
      fireEvent.click(submit);
      await waitFor(() => expect(submitted).toBe(true));
      await screen.findByTestId('verification-PENDING_REVIEW');
      expect(screen.queryByLabelText(UI_COPY[lang].uploadLabel)).not.toBeInTheDocument();
      expect(screen.getByTestId('axis-workAccessActive')).toHaveAttribute('data-active', 'false');
      expect(screen.getByRole('link', { name: UI_COPY[lang].returnToApplication })).toHaveAttribute(
        'href',
        '/provider/profile',
      );
    },
  );

  it('does not offer resubmission when the server action list is empty', async () => {
    stub({ kase: kase({ state: 'ACTION_REQUIRED', documents: [doc()], availableActions: [] }) });
    renderScreen();
    await screen.findByTestId('verification-CHANGES_REQUESTED');
    expect(screen.queryByRole('button', { name: UI_COPY.en.resubmit })).not.toBeInTheDocument();
    expect(screen.getByLabelText(UI_COPY.en.uploadLabel)).toBeInTheDocument();
  });

  it('shows a failed start and can retry without exposing the server error', async () => {
    stub({});
    mock.onPost(CASE_URL).replyOnce(500, { message: 'private storage path' });
    mock.onPost(CASE_URL).reply(() => {
      mock.onGet(CASE_URL).reply(200, kase());
      return [201, { ...kase(), created: true }];
    });
    renderScreen();

    fireEvent.click(
      await screen.findByRole('button', { name: STATE_COPY.en.NOT_STARTED.cta as string }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_COPY.en.startFailed);
    expect(screen.queryByText('private storage path')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: STATE_COPY.en.NOT_STARTED.cta as string }));
    await screen.findByTestId('verification-EVIDENCE_REQUIRED');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a failed submission and retains the uploaded documents', async () => {
    stub({ kase: kase({ documents: [doc()] }) });
    mock.onPost(`${CASE_URL}/submit`).reply(422, { message: 'internal policy details' });
    renderScreen();

    fireEvent.click(
      await screen.findByRole('button', { name: STATE_COPY.en.READY_TO_SUBMIT.cta as string }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_COPY.en.submitFailed);
    expect(screen.getByTestId('document-d1')).toBeInTheDocument();
    expect(screen.queryByText('internal policy details')).not.toBeInTheDocument();
  });

  it.each([
    ['en', false, ['ONBOARDING_INCOMPLETE'], 'profileRequired'],
    ['en', true, ['TERMS_NOT_ACCEPTED'], 'termsRequired'],
    ['ar', false, ['ONBOARDING_INCOMPLETE', 'TERMS_NOT_ACCEPTED'], 'profileAndTermsRequired'],
    ['ar', true, ['ONBOARDING_INCOMPLETE'], 'profileRequired'],
  ] as const)(
    'explains server application blockers in %s with V2=%s',
    async (lang, enabled, codes, copyKey) => {
      window.localStorage.setItem('hsm.ff.providerOnboardingV2', String(enabled));
      stub({ kase: kase({ documents: [doc()] }) });
      mock.onPost(`${CASE_URL}/submit`).reply(422, {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'private server explanation',
          details: { blockers: codes.map((code) => ({ code, field: 'private field detail' })) },
        },
      });
      renderScreen(lang);

      fireEvent.click(
        await screen.findByRole('button', { name: STATE_COPY[lang].READY_TO_SUBMIT.cta as string }),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(UI_COPY[lang][copyKey]);
      expect(screen.getByRole('link', { name: UI_COPY[lang].returnToApplication })).toHaveAttribute(
        'href',
        enabled ? '/provider/onboarding' : '/provider/profile',
      );
      expect(screen.getByTestId('document-d1')).toBeInTheDocument();
      expect(
        screen.queryByText(/private server explanation|private field detail/),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    [403, [{ code: 'ONBOARDING_INCOMPLETE' }]],
    [422, { code: 'ONBOARDING_INCOMPLETE' }],
    [422, [{ code: 'UNKNOWN_SERVER_RULE' }, null, 'ONBOARDING_INCOMPLETE']],
  ])(
    'keeps the safe generic failure for unrecognized application errors: %s %s',
    async (status, blockers) => {
      stub({ kase: kase({ documents: [doc()] }) });
      mock.onPost(`${CASE_URL}/submit`).reply(status as number, {
        success: false,
        error: { code: 'VALIDATION_ERROR', details: { blockers } },
      });
      renderScreen();

      fireEvent.click(
        await screen.findByRole('button', { name: STATE_COPY.en.READY_TO_SUBMIT.cta as string }),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(UI_COPY.en.submitFailed);
      expect(
        screen.queryByRole('link', { name: UI_COPY.en.returnToApplication }),
      ).not.toBeInTheDocument();
    },
  );

  it.each([false, true])(
    'returns pending identity review to the unfinished application with V2=%s',
    async (enabled) => {
      window.localStorage.setItem('hsm.ff.providerOnboardingV2', String(enabled));
      stub({
        caps: caps(['MANAGE_VERIFICATION', 'COMPLETE_ONBOARDING'], 'ONBOARDING_INCOMPLETE'),
        kase: kase({ state: 'SUBMITTED', documents: [doc()] }),
      });
      renderScreen();

      await screen.findByTestId('verification-PENDING_REVIEW');
      expect(screen.getByRole('status')).toHaveTextContent(UI_COPY.en.applicationNext);
      expect(screen.getByRole('link', { name: UI_COPY.en.returnToApplication })).toHaveAttribute(
        'href',
        enabled ? '/provider/onboarding' : '/provider/profile',
      );
      expect(screen.getByTestId('axis-workAccessActive')).toHaveAttribute('data-active', 'false');
    },
  );

  it('refreshes a pending required scan and exposes submission when it clears', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    stub({});
    let reads = 0;
    mock.onGet(CASE_URL).reply(() => [
      200,
      kase({
        documents: [doc({ scanState: reads++ === 0 ? 'PENDING' : 'CLEAN' })],
      }),
    ]);
    renderScreen();

    await screen.findByTestId('verification-SCANNING');
    expect(screen.queryByLabelText(UI_COPY.en.uploadLabel)).not.toBeInTheDocument();
    await screen.findByTestId('verification-READY_TO_SUBMIT', {}, { timeout: 3500 });
    expect(
      screen.getByRole('button', { name: STATE_COPY.en.READY_TO_SUBMIT.cta as string }),
    ).toBeInTheDocument();
  });

  it('replaces the selected business document using its real kind', async () => {
    const upload = vi.spyOn(verificationApi, 'uploadEvidence').mockResolvedValue({} as never);
    stub({
      kase: kase({
        state: 'ACTION_REQUIRED',
        requirements: [
          { kind: 'BUSINESS_REGISTRATION', serviceCategoryId: null },
          { kind: 'AUTHORIZED_REPRESENTATIVE_IDENTITY', serviceCategoryId: null },
        ],
        documents: [
          doc({ id: 'registration', kind: 'BUSINESS_REGISTRATION' }),
          doc({ id: 'representative', kind: 'AUTHORIZED_REPRESENTATIVE_IDENTITY' }),
        ],
      }),
    });
    renderScreen();
    const list = await screen.findByTestId('verification-documents');
    const replacementButtons = within(list).getAllByRole('button');
    fireEvent.click(replacementButtons[1]);
    const file = new File(['replacement'], 'representative.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(UI_COPY.en.uploadLabel), { target: { files: [file] } });
    await waitFor(() =>
      expect(upload).toHaveBeenCalledWith(
        expect.objectContaining({
          file,
          kind: 'AUTHORIZED_REPRESENTATIVE_IDENTITY',
          serviceCategoryId: null,
        }),
      ),
    );
  });

  it.each([
    ['DRAFT', 'EVIDENCE_REQUIRED'],
    ['ACTION_REQUIRED', 'CHANGES_REQUESTED'],
  ] as const)(
    'opens the hidden picker through the visible %s action',
    async (caseState, viewState) => {
      stub({ kase: kase({ state: caseState, documents: [] }) });
      renderScreen();
      await screen.findByTestId(`verification-${viewState}`);

      const input = screen.getByLabelText(UI_COPY.en.uploadLabel);
      expect(input).toHaveAttribute('type', 'file');
      expect(input).toHaveAttribute('hidden');
      expect(input).not.toBeVisible();
      const opener = screen.getByRole('button', { name: STATE_COPY.en[viewState].cta as string });
      expect(opener).toBeVisible();
      expect(opener).toBeEnabled();
      const openPicker = vi.spyOn(input, 'click');
      fireEvent.click(opener);
      expect(openPicker).toHaveBeenCalledOnce();
    },
  );
});

describe('Arabic', () => {
  it('renders the Arabic copy and marks the direction', async () => {
    stub({ kase: kase({ documents: [] }) });
    renderScreen('ar');

    const section = await screen.findByTestId('verification-EVIDENCE_REQUIRED');
    expect(section).toHaveTextContent(STATE_COPY.ar.EVIDENCE_REQUIRED.title);
    expect(section).toHaveAttribute('dir', 'rtl');
  });

  it('translates the axis labels too', async () => {
    stub({ profile: PROFILE({ topPro: true }) });
    renderScreen('ar');

    const axes = await screen.findByTestId('verification-axes');
    expect(within(axes).getByTestId('axis-identityVerified')).toHaveTextContent(
      AXIS_COPY.ar.identityVerified,
    );
    expect(screen.getByTestId('axis-featured')).toHaveTextContent(AXIS_COPY.ar.featured);
  });

  it('translates the reviewer reason', async () => {
    stub({
      kase: kase({
        state: 'ACTION_REQUIRED',
        latestDecision: {
          outcome: 'ACTION_REQUIRED',
          reasonCode: 'DOCUMENT_ILLEGIBLE',
          decidedAt: '2026-08-02T00:00:00.000Z',
        },
      }),
    });
    renderScreen('ar');

    const reason = await screen.findByTestId('verification-reason');
    expect(reason.textContent ?? '').toMatch(/[؀-ۿ]/);
  });
});

describe('the file picker exists only where it can be used', () => {
  it.each([
    ['PENDING_REVIEW', { kase: kase({ state: 'SUBMITTED' }) }],
    ['VERIFIED_ACTIVE', { caps: caps(['SUBMIT_BID']), kase: kase({ state: 'VERIFIED' }) }],
    ['SUSPENDED', { caps: caps([], 'PROVIDER_SUSPENDED') }],
    ['SCANNING', { kase: kase({ requirements: [], documents: [doc({ scanState: 'PENDING' })] }) }],
  ])('is absent in %s', async (state, options) => {
    // A file input is exposed as a BUTTON to assistive technology. Leaving it
    // mounted puts a "choose a file" control in the tab order of a screen
    // where uploading does nothing.
    stub(options as Parameters<typeof stub>[0]);
    renderScreen();
    await screen.findByTestId(`verification-${state}`);

    expect(screen.queryByLabelText(UI_COPY.en.uploadLabel)).not.toBeInTheDocument();
  });

  it.each([
    ['EVIDENCE_REQUIRED', { kase: kase({ documents: [] }) }],
    ['EVIDENCE_UNUSABLE', { kase: kase({ documents: [doc({ scanState: 'QUARANTINED' })] }) }],
    ['CHANGES_REQUESTED', { kase: kase({ state: 'ACTION_REQUIRED' }) }],
  ])('is present in %s', async (state, options) => {
    stub(options as Parameters<typeof stub>[0]);
    renderScreen();
    await screen.findByTestId(`verification-${state}`);

    expect(screen.getByLabelText(UI_COPY.en.uploadLabel)).toBeInTheDocument();
  });
});
