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

function renderScreen(view = DRAFT(), lang: 'en' | 'ar' = 'en', editable = true) {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), view);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <PublicProfileTaskScreen view={view as never} lang={lang} editable={editable} />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function lastPatch(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
  return JSON.parse(mock.history.patch[mock.history.patch.length - 1]!.data as string) as Record<
    string,
    unknown
  >;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the title, suggested and then owned by the provider', () => {
  it('offers the suggestion from Task 2 without writing it', () => {
    renderScreen();
    expect(screen.getByTestId('title-suggestion')).toHaveTextContent('Electrician');
    expect((screen.getByTestId('title-input') as HTMLInputElement).value).toBe('');
    expect(mock.history.patch).toHaveLength(0);
  });

  it('fills the box when the provider accepts it, and still does not save', () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('title-use-suggestion'));
    expect((screen.getByTestId('title-input') as HTMLInputElement).value).toBe('Electrician');
    expect(mock.history.patch).toHaveLength(0);
  });

  it('saves the edited title on blur', async () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('title-input'), {
      target: { value: 'Electrician' },
    });
    fireEvent.blur(screen.getByTestId('title-input'));
    expect(await lastPatch()).toMatchObject({ headline: 'Electrician' });
  });

  it('trims before saving', async () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('title-input'), {
      target: { value: '   Electrician   ' },
    });
    fireEvent.blur(screen.getByTestId('title-input'));
    expect(await lastPatch()).toMatchObject({ headline: 'Electrician' });
  });

  it('clears the title to null rather than saving an empty string', async () => {
    renderScreen(DRAFT({ data: { headline: 'Old title here' } }));
    fireEvent.change(screen.getByTestId('title-input'), { target: { value: '   ' } });
    fireEvent.blur(screen.getByTestId('title-input'));
    expect(await lastPatch()).toMatchObject({ headline: null });
  });
});

describe('a title is sanitised before it can be published', () => {
  it.each([
    ['a phone number', 'Electrician call 0991234567', 'CONTAINS_CONTACT'],
    ['an email address', 'Electrician me@example.test', 'CONTAINS_CONTACT'],
    // A .com address matches the URL rule first. Still refused, which is the
    // property that matters; the code differs and the test says so rather than
    // pretending the order is something else.
    ['an email at a known TLD', 'Electrician me@example.com', 'CONTAINS_URL'],
    ['a link', 'Electrician www.example.com', 'CONTAINS_URL'],
  ])('refuses %s and does not save it', async (_name, value, code) => {
    renderScreen();
    fireEvent.change(screen.getByTestId('title-input'), { target: { value } });
    fireEvent.blur(screen.getByTestId('title-input'));

    expect(screen.getByTestId('title-help')).toHaveTextContent(EN.titleRefusal[code]!);
    // Sending it anyway would trade a clear inline message for a 422 the
    // provider has to decode.
    expect(mock.history.patch).toHaveLength(0);
  });

  it('marks the field invalid for assistive technology', () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('title-input'), {
      target: { value: 'Call me on 0991234567' },
    });
    expect(screen.getByTestId('title-input')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('title-help')).toHaveAttribute('role', 'alert');
  });

  it('caps the length at the input itself, so the refusal is rare', () => {
    renderScreen();
    expect(screen.getByTestId('title-input')).toHaveAttribute('maxLength', '60');
  });
});

describe('the bio', () => {
  it('offers prompts rather than a template to send unedited', () => {
    renderScreen();
    const examples = screen.getByTestId('bio-examples');
    expect(within(examples).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
    expect((screen.getByTestId('bio-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('counts what the SERVER measures — the trimmed length', () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: '  hello  ' } });
    // Five, not nine: the DTO trims before its length check, so a counter that
    // included the spaces would promise a save the server refuses.
    expect(screen.getByTestId('bio-counter')).toHaveTextContent('5 of 2,000 characters');
  });

  it('warns below the minimum the completeness policy enforces', () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: 'Too short.' } });
    expect(screen.getByTestId('bio-help')).toHaveTextContent(EN.bioTooShort(40));
  });

  it('saves a bio that is long enough', async () => {
    const text = 'I handle residential and light commercial electrical work across the city.';
    renderScreen();
    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: text } });
    fireEvent.blur(screen.getByTestId('bio-input'));
    expect(await lastPatch()).toMatchObject({ bio: text });
  });

  it('refuses to save an over-long bio, and says so', () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: 'x'.repeat(2001) } });

    expect(screen.getByTestId('bio-help')).toHaveTextContent(EN.bioCounterOver);
    expect(screen.getByTestId('bio-input')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(screen.getByTestId('bio-input'));
    expect(mock.history.patch).toHaveLength(0);
  });

  it('announces the count politely rather than re-reading the field', () => {
    renderScreen();
    const counter = screen.getByTestId('bio-counter');
    expect(counter).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('bio-input')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('bio-counter') as unknown as string,
    );
  });
});

describe('Arabic', () => {
  it('counts Arabic content correctly', () => {
    // Arabic is not surrogate-paired, so UTF-16 length and character count
    // agree — which is what makes counting the way the server does safe here.
    renderScreen(DRAFT(), 'ar');
    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: 'أعمل في الكهرباء' } });
    expect(screen.getByTestId('bio-counter')).toHaveTextContent('١٦');
  });

  it('renders the counter in Arabic-Indic digits', () => {
    renderScreen(DRAFT(), 'ar');
    // ٢٬٠٠٠ — the localised maximum. A Latin "2,000" inside Arabic copy is the
    // thing "a correct localised counter" is asking about.
    expect(screen.getByTestId('bio-counter').textContent).toMatch(/[٠-٩]/);
  });

  it('offers the Arabic suggestion, not the English one', () => {
    renderScreen(DRAFT(), 'ar');
    expect(screen.getByTestId('title-suggestion')).toHaveTextContent('كهربائي');
  });

  it('keeps Arabic bio text through a save', async () => {
    const text = 'أعمل في تمديدات الكهرباء المنزلية والتجارية الخفيفة منذ عشر سنوات في المدينة.';
    renderScreen(DRAFT(), 'ar');
    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: text } });
    fireEvent.blur(screen.getByTestId('bio-input'));
    expect(await lastPatch()).toMatchObject({ bio: text });
  });
});

describe('the preview comes from the server, not from this page', () => {
  it('renders the public projection the server returned', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('public-preview')).toBeInTheDocument());
    expect(screen.getByTestId('preview-display-name')).toHaveTextContent('Ada Lovelace Services');
    expect(screen.getByTestId('preview-headline')).toHaveTextContent('Electrician');
    expect(screen.getByTestId('preview-area')).toHaveTextContent('Damascus');
  });

  it('does NOT reflect unsaved local edits', async () => {
    // The preview is what a CUSTOMER would get. Echoing the textarea would
    // make it a mirror of this page instead.
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('public-preview')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('bio-input'), { target: { value: 'Unsaved words.' } });
    expect(screen.getByTestId('preview-bio')).toHaveTextContent('I do electrical work.');
    expect(screen.getByTestId('preview-bio')).not.toHaveTextContent('Unsaved words.');
  });

  it('renders only the fields the public contract carries', async () => {
    // If the server ever started returning a phone number, this screen would
    // have nowhere to put it — but the assertion is worth making explicitly.
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('public-preview')).toBeInTheDocument());
    const markup = screen.getByTestId('public-preview').textContent ?? '';
    expect(markup).not.toMatch(/\+?\d{9,}/);
    expect(markup).not.toMatch(/33\.5|36\.2/);
  });

  it('says so when the preview cannot be loaded', async () => {
    mock.onGet(PREVIEW).reply(500);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('preview-load-failed')).toBeInTheDocument());
  });
});

describe('the notices tell the truth about what is not built', () => {
  it('says customer profiles are not live yet', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('notice-route-unavailable')).toBeInTheDocument());
  });

  it('counts photos awaiting review and says they are not visible', async () => {
    mock.onGet(PREVIEW).reply(200, PREVIEW_RESPONSE({ awaitingReviewCount: 3 }));
    renderScreen();
    await waitFor(() =>
      expect(screen.getByTestId('notice-awaiting-review')).toHaveTextContent('3 photo(s)'),
    );
  });

  it('admits no reviewer exists rather than implying a queue is moving', async () => {
    mock.onGet(PREVIEW).reply(200, PREVIEW_RESPONSE({ awaitingReviewCount: 1 }));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('notice-no-reviewer')).toBeInTheDocument());
  });

  it('drops the waiting notices once the server says review exists', async () => {
    // Driven by the SERVER flag, so the day the capability ships the sentence
    // disappears without a web deploy guessing.
    mock
      .onGet(PREVIEW)
      .reply(200, PREVIEW_RESPONSE({ awaitingReviewCount: 0, moderationReviewAvailable: true }));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('public-preview')).toBeInTheDocument());
    expect(screen.queryByTestId('notice-no-reviewer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notice-awaiting-review')).not.toBeInTheDocument();
  });

  it('always states that private details are not part of the profile', async () => {
    renderScreen();
    await waitFor(() =>
      expect(screen.getByTestId('notice-private-not-shown')).toHaveTextContent(
        'phone number, exact location',
      ),
    );
  });

  it('shows no photos, and says why, while none is approved', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('preview-no-photos')).toBeInTheDocument());
  });
});

describe('the portfolio is the existing component', () => {
  it('renders inside the task rather than a second gallery', async () => {
    renderScreen();
    // The Sprint 9B.10 section, mounted as-is. It fetches its own data through
    // the same hooks the standalone screen uses.
    await waitFor(() =>
      expect(mock.history.get.some((r) => PORTFOLIO.test(r.url ?? ''))).toBe(true),
    );
    expect(screen.getByTestId('public-profile-portfolio')).toBeInTheDocument();
  });
});

describe('a locked application', () => {
  it('disables the inputs but still shows the preview', async () => {
    renderScreen(DRAFT({ data: { headline: 'Electrician' } }), 'en', false);
    expect(screen.getByTestId('title-input')).toBeDisabled();
    expect(screen.getByTestId('bio-input')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('public-preview')).toBeInTheDocument());
  });

  it('saves nothing on blur while locked', () => {
    renderScreen(DRAFT(), 'en', false);
    fireEvent.blur(screen.getByTestId('title-input'));
    fireEvent.blur(screen.getByTestId('bio-input'));
    expect(mock.history.patch).toHaveLength(0);
  });
});
