import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { PublicProfileTaskScreen } from './PublicProfileTaskScreen';
import { PUBLIC_PROFILE_COPY } from '../copy/public-profile-copy';
import { ProviderOnboardingAutosaveProvider } from '../autosave/ProviderOnboardingAutosaveProvider';

// Sprint 9B.22 — V2 Task 5.
//
// What this file pins:
//
//   - the preview renders the SERVER's public projection, never the draft
//   - a title carrying contact details or a link is refused before it is saved
//   - the bio counter is truthful, localised, and matches what the server
//     measures
//   - the honest notices appear while the platform cannot publish or review
//   - the portfolio is the existing component, not a second one

const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/PROFILE/;
const PREVIEW = /\/v1\/me\/provider\/public-profile\/preview/;
const PORTFOLIO = /\/v1\/me\/provider\/portfolio/;
const EN = PUBLIC_PROFILE_COPY.en;

const DRAFT = (over: Record<string, unknown> = {}) => {
  const { data: dataOver, ...rest } = over;
  return {
    state: 'DRAFT',
    currentStep: 'PROFILE',
    steps: [],
    completedSteps: [],
    version: 7,
    editable: true,
    lastSavedAt: null,
    policyVersion: 'sprint-08',
    missing: [],
    ...rest,
    data: {
      headline: null,
      bio: null,
      additionalInformation: null,
      suggestedTitle: { en: 'Electrician', ar: 'كهربائي' },
      ...((dataOver as Record<string, unknown>) ?? {}),
    },
  };
};

const PREVIEW_RESPONSE = (over: Record<string, unknown> = {}) => ({
  profile: {
    displayName: 'Ada Lovelace Services',
    initials: 'AL',
    avatarUrl: null,
    about: { headline: 'Electrician', bio: 'I do electrical work.' },
    area: { city: 'Damascus', country: 'Syria' },
    standing: { ratingAvg: 4.8, reviewCount: 12, completedJobs: 30, verified: true },
    portfolio: [],
    services: ['Fault finding'],
    ...((over.profile as Record<string, unknown>) ?? {}),
  },
  awaitingReviewCount: 0,
  publicProfileRouteAvailable: false,
  moderationReviewAvailable: false,
  ...over,
});

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet(PREVIEW).reply(200, PREVIEW_RESPONSE());
  mock.onGet(PORTFOLIO).reply(200, { items: [], remainingSlots: 10, maxItems: 10 });
  mock.onPatch(PATCH).reply(200, DRAFT());
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
});

type Part = 'profile' | 'portfolio';

function renderScreen(
  view = DRAFT(),
  lang: 'en' | 'ar' = 'en',
  editable = true,
  part: Part = 'profile',
) {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), view);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ProviderOnboardingAutosaveProvider>
            <PublicProfileTaskScreen
              view={view as never}
              lang={lang}
              editable={editable}
              part={part}
            />
          </ProviderOnboardingAutosaveProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// Sprint 09B.29 Phase 5A — Task 5 is TWO approved screens: `profile` (the bio
// and a preview of what a customer reads) and `portfolio` (the uploader, the
// tiles and the moderation notice).
//
// SUPERSEDED, and recorded rather than deleted:
//
//   the title input   and with it the client-side sanitisation that refused a
//                     phone number, an email or a link inside it. Ruling C1
//                     makes the generated title SERVER-owned and the approved
//                     screen shows it without an editor, so nothing
//                     unverifiable can be typed there at all — which is
//                     stricter than sanitising what was typed. The absence of
//                     an editor is asserted below and in the Task 2 suite.
//   the bio counter   and the minimum-length hint. The server still enforces
//                     the minimum; the ceiling is now an input cap rather than
//                     a number on screen. RECORDED FOR PHASE 5B: a provider
//                     learns about the minimum at submission rather than while
//                     writing.
//   the examples      the prompts panel is not on the approved screen.

describe('the bio', () => {
  it('is the one thing the approved profile screen asks for', async () => {
    renderScreen();

    expect(await screen.findByTestId('bio-input')).toBeInTheDocument();
    // No editor for a server-owned title, anywhere on this screen.
    expect(screen.queryByTestId('title-input')).toBeNull();
    expect(screen.queryByTestId('title-use-suggestion')).toBeNull();
    expect(screen.queryByTestId('bio-examples')).toBeNull();
  });

  it('saves to the PROFILE step as it is typed', async () => {
    renderScreen();

    fireEvent.change(await screen.findByTestId('bio-input'), {
      target: { value: 'Painting professional with 14 years of experience.' },
    });

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const sent = mock.history.patch.find((r) => r.url?.includes('PROFILE'));
    expect(sent, 'the write goes to the PROFILE step').toBeTruthy();
    expect(JSON.parse(sent!.data).bio).toBe('Painting professional with 14 years of experience.');
  });

  it('clears to null rather than saving an empty string', async () => {
    renderScreen(DRAFT({ data: { bio: 'Something already said.' } }));

    fireEvent.change(await screen.findByTestId('bio-input'), { target: { value: '   ' } });
    fireEvent.blur(screen.getByTestId('bio-input'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const sent = mock.history.patch[mock.history.patch.length - 1]!;
    expect(JSON.parse(sent.data).bio).toBeNull();
  });

  it('caps the length at the input, so the server never has to refuse it', async () => {
    renderScreen();
    // The counter is gone with the approved design; the ceiling is not.
    expect(await screen.findByTestId('bio-input')).toHaveAttribute('maxLength', '2000');
  });

  it('carries the privacy guidance as the field’s own hint', async () => {
    renderScreen();

    const hint = screen.getByText(EN.bioApprovedHint);
    const bio = await screen.findByTestId('bio-input');
    expect(bio.getAttribute('aria-describedby')).toContain(hint.id);
  });
});

describe('the customer preview', () => {
  const populated = DRAFT({
    data: {
      suggestedTitle: { en: 'Painting professional', ar: 'فني دهانات' },
      serviceAreaCity: 'Aleppo, Al-Furqan',
      serviceAreaRadiusKm: 15,
      yearsOfExperience: 14,
    },
  });

  it('reads back what the provider already told the server', async () => {
    renderScreen(populated);

    expect(await screen.findByTestId('preview-title')).toHaveTextContent('Painting professional');
    expect(screen.getByTestId('preview-line')).toHaveTextContent(
      'Aleppo • 15 km radius • 14 years experience',
    );
  });

  it('offers nothing to edit — the title is the server’s', async () => {
    renderScreen(populated);
    await screen.findByTestId('preview-title');

    expect(screen.queryByTestId('title-input')).toBeNull();
    expect(screen.queryByTestId('title-edit')).toBeNull();
    expect(screen.queryByTestId('title-accept')).toBeNull();
  });

  it('says nothing rather than half a sentence', async () => {
    // A line missing its radius or its years would read as a defect. The
    // provider has not finished telling us; the preview waits.
    renderScreen(DRAFT({ data: { serviceAreaCity: 'Aleppo', serviceAreaRadiusKm: null } }));
    await screen.findByTestId('customer-preview');
    expect(screen.queryByTestId('preview-line')).toBeNull();
  });
});

describe('the portfolio', () => {
  /**
   * Replace the gallery answer for one test.
   *
   * `beforeEach` already registered an empty gallery, and axios-mock-adapter
   * matches handlers in REGISTRATION order — so adding a second one inside a
   * test never runs. Resetting and re-registering is the only way to change
   * the answer, and doing it in one helper keeps the other handlers intact.
   */
  function withGallery(items: unknown[]) {
    mock.reset();
    mock.onGet(PREVIEW).reply(200, PREVIEW_RESPONSE());
    mock.onPatch(PATCH).reply(200, DRAFT());
    mock.onGet(PORTFOLIO).reply(200, { items, remainingSlots: 7, maxItems: 10 });
  }

  it('draws the approved upload surface and the moderation notice', async () => {
    renderScreen(DRAFT(), 'en', true, 'portfolio');

    expect(await screen.findByTestId('portfolio-add-photo')).toBeInTheDocument();
    expect(screen.getByTestId('portfolio-moderation-notice')).toHaveTextContent(
      EN.photosCheckingTitle,
    );
  });

  it('does NOT show a photo the platform has not cleared', async () => {
    // The notice beside it promises review "controls when photos become
    // visible". Rendering the image anyway would contradict it on the one
    // screen that states it.
    withGallery([
      {
        id: 'pf-1',
        media: { url: 'https://cdn.test/one.jpg' },
        title: null,
        description: null,
        serviceCategoryId: null,
        position: 0,
        moderationState: 'PENDING',
        moderationReason: null,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);

    renderScreen(DRAFT(), 'en', true, 'portfolio');

    const tile = await screen.findByTestId('portfolio-item-pf-1');
    expect(tile).toHaveAttribute('data-moderation', 'PENDING');
    expect(tile.querySelector('img')).toBeNull();
  });

  it('shows a cleared photo', async () => {
    withGallery([
      {
        id: 'pf-2',
        media: { url: 'https://cdn.test/two.jpg' },
        title: 'Finished wall',
        description: null,
        serviceCategoryId: null,
        position: 0,
        moderationState: 'APPROVED',
        moderationReason: null,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);

    renderScreen(DRAFT(), 'en', true, 'portfolio');

    const tile = await screen.findByTestId('portfolio-item-pf-2');
    expect(tile.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/two.jpg');
  });

  it('will not upload until the publication wording has been agreed to', async () => {
    renderScreen(DRAFT(), 'en', true, 'portfolio');

    const input = (await screen.findByLabelText(EN.choosePhotoFile)) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1])], 'w.jpg', { type: 'image/jpeg' })] },
    });

    // The server records WHICH wording was agreed to and refuses a stale
    // version, so a create sent without showing the sentence would be
    // recording agreement to text nobody saw.
    const gate = await screen.findByTestId('portfolio-consent');
    expect(gate).toBeInTheDocument();
    expect(screen.getByTestId('portfolio-consent-agree')).toBeDisabled();

    fireEvent.click(within(gate).getByRole('checkbox'));
    expect(screen.getByTestId('portfolio-consent-agree')).toBeEnabled();
  });
});

describe('Arabic', () => {
  it('renders the approved Arabic copy on both halves', async () => {
    renderScreen(DRAFT(), 'ar');
    expect(await screen.findByText(PUBLIC_PROFILE_COPY.ar.bioApprovedLabel)).toBeInTheDocument();
    expect(screen.queryByText(EN.bioApprovedLabel)).toBeNull();
  });

  it('renders the portfolio half in Arabic', async () => {
    renderScreen(DRAFT(), 'ar', true, 'portfolio');
    expect(await screen.findByText(PUBLIC_PROFILE_COPY.ar.uploadPrompt)).toBeInTheDocument();
  });
});

describe('a locked application', () => {
  it('disables the bio', async () => {
    renderScreen(DRAFT(), 'en', false);
    expect(await screen.findByTestId('bio-input')).toBeDisabled();
  });

  it('disables the uploader', async () => {
    renderScreen(DRAFT(), 'en', false, 'portfolio');
    expect(await screen.findByTestId('portfolio-add-photo')).toBeDisabled();
  });
});
