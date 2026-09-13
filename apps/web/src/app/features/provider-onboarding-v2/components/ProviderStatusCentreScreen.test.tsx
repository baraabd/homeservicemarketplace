import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ProviderStatusCentreScreen } from './ProviderStatusCentreScreen';
import { STATUS_CENTRE_COPY } from '../copy/status-centre-copy';

// Sprint 09B.29 Phase 5A — approved screens 14 and 17.
//
// WHAT THIS FILE PINS
//
// ADR 0005's four axes, answered SEPARATELY and from four different server
// facts. The surface this replaces rendered one sentence per `profile.status`,
// and the single thing a test of it could not catch is the failure that
// matters: a provider being told "pending review" when what is actually true is
// that their specialties are cleared, their documents were never asked for, and
// they still cannot take work.
//
// So every test below changes ONE server fact and asserts that ONE row moved.

const PROFILE_URL = /\/v1\/me\/provider\/profile$/;
const HUB_URL = /\/v1\/me\/provider\/onboarding\/hub$/;
const CAPS_URL = /\/v1\/me\/provider\/capabilities$/;
const REVIEW_URL = /\/v1\/me\/provider\/onboarding\/review/;
const WITHDRAW_URL = /\/v1\/me\/provider\/onboarding\/withdraw$/;

const EN = STATUS_CENTRE_COPY.en;
const AR = STATUS_CENTRE_COPY.ar;

const PROFILE = (over: Record<string, unknown> = {}) => ({
  profile: {
    id: 'pp-1',
    displayName: 'Ahmad Fatal',
    initials: 'AF',
    avatarUrl: null,
    status: 'PENDING_REVIEW',
    verified: false,
    topPro: false,
    serviceCategories: [],
    pendingCategories: [],
    submittedForReviewAt: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-01T12:43:00.000Z',
    ...over,
  },
});

const HUB = (over: Record<string, unknown> = {}) => ({
  tasks: [],
  progress: { complete: 6, total: 6 },
  nextAction: { kind: 'WAIT' },
  status: 'SUBMITTED',
  ...over,
});

/** The capability service's own shape. `allowed` is what the screen reads. */
const CAPS = (allowed: string[]) => ({
  capabilities: allowed.map((capability) => ({ capability, allowed: true, reason: null })),
  allowed,
  nextActions: [],
  primaryReason: null,
});

const WAITING_CAPS = ['VIEW_OWN_PROFILE', 'EDIT_OWN_PROFILE'];
const ACTIVE_CAPS = [...WAITING_CAPS, 'VIEW_MARKETPLACE', 'SUBMIT_BID'];

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
});

function renderScreen(
  options: {
    profile?: ReturnType<typeof PROFILE>;
    hub?: ReturnType<typeof HUB>;
    caps?: string[];
    /** The server's verdict on whether the withdraw command would succeed. */
    canWithdraw?: boolean;
    lang?: 'en' | 'ar';
  } = {},
) {
  mock.reset();
  mock.onGet(PROFILE_URL).reply(200, options.profile ?? PROFILE());
  mock.onGet(HUB_URL).reply(200, options.hub ?? HUB());
  mock.onGet(CAPS_URL).reply(200, CAPS(options.caps ?? WAITING_CAPS));
  mock.onGet(REVIEW_URL).reply(200, {
    groups: [],
    canSubmit: false,
    blockedReason: null,
    terms: {
      version: 'v2',
      locale: 'en',
      accepted: true,
      acceptedVersion: 'v2',
      acceptedAt: null,
    },
    draftVersion: 7,
    lifecycleState: 'SUBMITTED',
    canWithdraw: options.canWithdraw ?? true,
  });
  mock.onPost(WITHDRAW_URL).reply(200, { state: 'DRAFT', version: 8 });

  window.localStorage.setItem('hsm.lang', options.lang ?? 'en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ProviderStatusCentreScreen />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The badge on one axis row. */
const axisValue = async (id: string) => (await screen.findByTestId(`axis-${id}`)).textContent ?? '';

describe('the four axes are answered separately', () => {
  it('says an application is complete and work access is not, in the same breath', async () => {
    renderScreen();

    await screen.findByTestId('provider-status-axes');
    expect(await axisValue('completion')).toContain(EN.valueComplete);
    // The row this whole surface exists for. "Your application is complete" and
    // "you may not work" are both true here, and the old screen could say only
    // one of them.
    expect(await axisValue('work-access')).toContain(EN.valueNotActive);
  });

  it('reads work access from the CAPABILITY, not from the profile status', async () => {
    // An ACTIVE profile with no bidding capability — a suspended grant, an
    // expired verification, a policy change. The screen reports what the
    // provider can actually do.
    renderScreen({ profile: PROFILE({ status: 'ACTIVE', verified: true }), caps: WAITING_CAPS });

    expect(await axisValue('work-access')).toContain(EN.valueNotActive);
    expect(screen.queryByTestId('provider-workspace-unlocked')).toBeNull();
  });

  it('shows a specialty decision that is still with a moderator', async () => {
    renderScreen({ profile: PROFILE({ pendingCategories: ['sp-interior'] }) });

    expect(await axisValue('specialty')).toContain(EN.valueInReview);
  });

  it('shows a specialty decision that has been made', async () => {
    renderScreen({ profile: PROFILE({ pendingCategories: [] }) });

    expect(await axisValue('specialty')).toContain(EN.valueComplete);
  });

  it('does not call verification "in review" before there is an application to review', async () => {
    renderScreen({
      hub: HUB({ status: 'DRAFT', progress: { complete: 2, total: 6 } }),
    });

    expect(await axisValue('verification')).toContain(EN.valueNotStarted);
  });

  it('says an unverified provider with a submitted application is with us', async () => {
    renderScreen();
    expect(await axisValue('verification')).toContain(EN.valueInReview);
  });

  it('carries the word as well as the colour on every row', async () => {
    renderScreen();

    const panel = await screen.findByTestId('provider-status-axes');
    // Colour alone is not a status. Every row has to read correctly to someone
    // who cannot distinguish the greens from the ambers.
    for (const id of ['completion', 'specialty', 'verification', 'work-access']) {
      expect(within(panel).getByTestId(`axis-${id}`).textContent?.trim()).not.toBe('');
    }
  });
});

describe('the waiting screen', () => {
  it('says no action is needed, and offers the application rather than a dead end', async () => {
    renderScreen();

    expect(await screen.findByTestId('status-waiting-alert')).toHaveTextContent(
      EN.waitingAlertTitle,
    );
    expect(screen.getByTestId('status-view-application')).toBeInTheDocument();
    expect(screen.getByTestId('status-withdraw')).toHaveTextContent(EN.withdraw);
  });

  it('withdraws through the SERVER command, not by navigating somewhere', async () => {
    renderScreen();

    const button = await screen.findByTestId('status-withdraw');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    // A button labelled "withdraw" that only changed route would leave the
    // application submitted and the provider unable to edit it — which is the
    // shape of every control that describes an outcome it does not produce.
    await waitFor(() =>
      expect(mock.history.post.filter((r) => /withdraw$/.test(r.url ?? ''))).toHaveLength(1),
    );
  });

  it('does not offer a withdraw the server would refuse', async () => {
    renderScreen({ canWithdraw: false });

    // `canWithdraw` is scoped to the same states the write is. Offering the
    // control anyway is how a client earns a 409 it caused itself.
    await waitFor(() => expect(screen.getByTestId('status-withdraw')).toBeDisabled());
  });

  it('timestamps itself from the SERVER, not from a client clock', async () => {
    renderScreen({ profile: PROFILE({ updatedAt: '2026-09-01T09:05:00.000Z' }) });

    await screen.findByTestId('provider-status-centre');

    // The expected string is computed from the SAME instant rather than
    // hard-coded, so the assertion is about which instant was formatted and not
    // about the timezone the test runner happens to be in. A client clock would
    // print the moment the test ran, which this catches.
    const expected = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date('2026-09-01T09:05:00.000Z'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-v2-progress')).toHaveTextContent(
        EN.waitingSubtitle(expected),
      ),
    );
  });
});

describe('the activation handoff', () => {
  it('appears when the provider may actually work, and opens the workspace', async () => {
    renderScreen({
      profile: PROFILE({ status: 'ACTIVE', verified: true }),
      hub: HUB({ status: 'ACTIVE' }),
      caps: ACTIVE_CAPS,
    });

    const handoff = await screen.findByTestId('provider-workspace-unlocked');
    expect(handoff).toHaveTextContent(EN.activeHeading);
    expect(screen.getByTestId('workspace-enter')).toHaveTextContent(EN.openWorkspace);
  });

  it('swaps the specialty row for standing, because the decision is history', async () => {
    renderScreen({
      profile: PROFILE({ status: 'ACTIVE', verified: true }),
      hub: HUB({ status: 'ACTIVE' }),
      caps: ACTIVE_CAPS,
    });

    await screen.findByTestId('provider-workspace-unlocked');
    expect(await axisValue('standing')).toContain(EN.valueGood);
    expect(screen.queryByTestId('axis-specialty')).toBeNull();
  });

  it('still shows all four rows, so the day one changes there is somewhere to look', async () => {
    renderScreen({
      profile: PROFILE({ status: 'ACTIVE', verified: true }),
      hub: HUB({ status: 'ACTIVE' }),
      caps: ACTIVE_CAPS,
    });

    await screen.findByTestId('provider-workspace-unlocked');
    expect(await axisValue('verification')).toContain(EN.valueVerified);
    expect(await axisValue('work-access')).toContain(EN.valueActive);
  });

  it('announces itself politely', async () => {
    renderScreen({
      profile: PROFILE({ status: 'ACTIVE', verified: true }),
      hub: HUB({ status: 'ACTIVE' }),
      caps: ACTIVE_CAPS,
    });

    const handoff = await screen.findByTestId('provider-workspace-unlocked');
    expect(handoff).toHaveAttribute('role', 'status');
    expect(handoff).toHaveAttribute('aria-live', 'polite');
  });
});

describe('Arabic', () => {
  it('names every axis and every value in Arabic', async () => {
    renderScreen({ lang: 'ar' });

    const panel = await screen.findByTestId('provider-status-axes');
    expect(panel).toHaveTextContent(AR.axisWorkAccess);
    expect(panel).toHaveTextContent(AR.valueNotActive);
    expect(panel).not.toHaveTextContent(EN.axisWorkAccess);
  });

  it('renders the Arabic handoff', async () => {
    renderScreen({
      lang: 'ar',
      profile: PROFILE({ status: 'ACTIVE', verified: true }),
      hub: HUB({ status: 'ACTIVE' }),
      caps: ACTIVE_CAPS,
    });

    expect(await screen.findByTestId('provider-workspace-unlocked')).toHaveTextContent(
      AR.activeHeading,
    );
  });
});

describe('before the server has answered', () => {
  it('shows a skeleton rather than guessing at an axis', async () => {
    mock.reset();
    mock.onGet(PROFILE_URL).reply(() => new Promise(() => {}));
    mock.onGet(HUB_URL).reply(200, HUB());
    mock.onGet(CAPS_URL).reply(200, CAPS(WAITING_CAPS));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <LanguageProvider>
            <ProviderStatusCentreScreen />
          </LanguageProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // An axis rendered from a half-arrived answer is worse than no axis: it
    // would say "Not active" about a provider who can work.
    expect(await screen.findByTestId('provider-status-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-status-axes')).toBeNull();
  });
});
