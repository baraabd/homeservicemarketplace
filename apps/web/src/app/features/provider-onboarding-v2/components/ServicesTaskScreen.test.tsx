import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ServicesTaskScreen } from './ServicesTaskScreen';
import { SERVICES_COPY } from '../copy/services-copy';

// Sprint 9B.18 — V2 Task 2.
//
// The acceptance criteria this file pins:
//
//   - selection and review state are SEPARATE, semantically and visually
//   - a PENDING admin decision is never presented as a validation failure
//   - no title is published without the provider acting on it
//
// Plus the things that make the picker usable at catalogue scale: search,
// hierarchy, limits, and retired categories that do not silently vanish.

const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/(SPECIALTIES|EXPERIENCE)/;

const CATEGORIES = [
  {
    id: 'g-1',
    slug: 'plumbing-group',
    labelEn: 'Plumbing',
    labelAr: 'سباكة',
    icon: '',
    sortOrder: 1,
    parentId: null,
    isLeaf: false,
  },
  {
    id: 'plumbing',
    slug: 'plumbing',
    labelEn: 'Leak repair',
    labelAr: 'إصلاح تسريب',
    icon: '',
    sortOrder: 1,
    parentId: 'g-1',
    isLeaf: true,
  },
  {
    id: 'drains',
    slug: 'drains',
    labelEn: 'Drain unblocking',
    labelAr: 'تسليك مجاري',
    icon: '',
    sortOrder: 2,
    parentId: 'g-1',
    isLeaf: true,
  },
  {
    id: 'g-2',
    slug: 'electrical-group',
    labelEn: 'Electrical',
    labelAr: 'كهرباء',
    icon: '',
    sortOrder: 2,
    parentId: null,
    isLeaf: false,
  },
  {
    id: 'wiring',
    slug: 'electrical',
    labelEn: 'Wiring',
    labelAr: 'تمديدات',
    icon: '',
    sortOrder: 1,
    parentId: 'g-2',
    isLeaf: true,
  },
  {
    id: 'flat',
    slug: 'flat',
    labelEn: 'Flat legacy category',
    labelAr: 'فئة قديمة',
    icon: '',
    sortOrder: 9,
    parentId: null,
    isLeaf: true,
  },
];

const EQUIPMENT = [
  { id: 'e-1', code: 'LADDER', labelEn: 'Ladder', labelAr: 'سلّم', categoryId: null, sortOrder: 1 },
  { id: 'e-2', code: 'DRILL', labelEn: 'Drill', labelAr: 'مثقاب', categoryId: null, sortOrder: 2 },
];

const specialty = (id: string, state: string, over: Record<string, unknown> = {}) => ({
  categoryId: id,
  state,
  labelEn: `Label ${id}`,
  labelAr: `تسمية ${id}`,
  parentId: 'g-1',
  decidedAt: null,
  ...over,
});

const DRAFT = (over: Record<string, unknown> = {}) => ({
  state: 'DRAFT',
  currentStep: 'SPECIALTIES',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP', step: 'SPECIALTIES' },
  complete: false,
  missing: [],
  version: 4,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
  data: {
    primaryGroupIds: [],
    specialtyLeafIds: [],
    pendingSpecialtyIds: [],
    specialties: [],
    primarySpecialtyId: null,
    maxSpecialties: 3,
    suggestedTitle: null,
    yearsOfExperience: null,
    professionSince: null,
    equipmentCodes: [],
    transportMode: null,
    transportModes: [],
    headline: null,
    ...((over.data as Record<string, unknown>) ?? {}),
  },
  ...over,
});

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet('/v1/services').reply(200, { items: CATEGORIES });
  mock.onGet('/v1/services/equipment').reply(200, { items: EQUIPMENT });
  mock.onPatch(PATCH).reply(200, DRAFT());
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
  vi.useRealTimers();
});

function renderScreen(view = DRAFT(), lang: 'en' | 'ar' = 'en', editable = true) {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), view);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ServicesTaskScreen view={view as never} lang={lang} editable={editable} />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the picker — finding a service at catalogue scale', () => {
  it('browses by GROUP rather than dumping every leaf on screen', async () => {
    renderScreen();
    await screen.findByTestId('specialty-groups');

    // Groups are collapsed, so the screen shows two rows rather than every
    // selectable competency in the catalogue.
    expect(screen.getByTestId('specialty-group-g-1')).toBeInTheDocument();
    expect(screen.queryByTestId('specialty-option-plumbing')).toBeNull();
  });

  it('expands a group to reveal its leaves', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('specialty-group-g-1'));

    expect(screen.getByTestId('specialty-option-plumbing')).toBeInTheDocument();
    expect(screen.getByTestId('specialty-option-drains')).toBeInTheDocument();
    // Not the other group's leaves.
    expect(screen.queryByTestId('specialty-option-wiring')).toBeNull();
  });

  it('reports the group as expanded to assistive technology', async () => {
    renderScreen();
    const group = await screen.findByTestId('specialty-group-g-1');
    expect(group).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'true');
  });

  it('searches across the catalogue, ignoring the hierarchy', async () => {
    renderScreen();
    fireEvent.change(await screen.findByTestId('specialty-search'), {
      target: { value: 'wiring' },
    });

    expect(screen.getByTestId('specialty-option-wiring')).toBeInTheDocument();
    expect(screen.queryByTestId('specialty-option-plumbing')).toBeNull();
  });

  it('matches the OTHER language too', async () => {
    // A provider reading Arabic may well know the English trade word.
    renderScreen(DRAFT(), 'ar');
    fireEvent.change(await screen.findByTestId('specialty-search'), {
      target: { value: 'wiring' },
    });
    expect(screen.getByTestId('specialty-option-wiring')).toBeInTheDocument();
  });

  it('says so when nothing matches, and suggests what to do', async () => {
    renderScreen();
    fireEvent.change(await screen.findByTestId('specialty-search'), {
      target: { value: 'zzzz' },
    });

    const empty = screen.getByTestId('specialty-no-results');
    expect(empty).toHaveTextContent(SERVICES_COPY.en.noResults);
    expect(empty).toHaveTextContent(SERVICES_COPY.en.noResultsHint);
  });

  it('offers a selectable ROOT, so a flat catalogue still works', async () => {
    renderScreen();
    await screen.findByTestId('specialty-roots');
    expect(screen.getByTestId('specialty-option-flat')).toBeInTheDocument();
  });

  it('never offers a GROUP as selectable', async () => {
    // isLeaf is read from the catalogue, not inferred. A heading is not a
    // competency, and the server refuses one anyway.
    renderScreen();
    await screen.findByTestId('specialty-groups');
    expect(screen.queryByTestId('specialty-option-g-1')).toBeNull();
  });

  it('uses a real checkbox, so it is announced and keyboard-operable', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('specialty-group-g-1'));
    const option = within(screen.getByTestId('specialty-option-plumbing')).getByRole('checkbox');
    expect(option).toBeInTheDocument();
  });

  it('saves the chosen ids to the SPECIALTIES step', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('specialty-group-g-1'));
    fireEvent.click(within(screen.getByTestId('specialty-option-plumbing')).getByRole('checkbox'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(mock.history.patch[0].url).toContain('/steps/SPECIALTIES');
    expect(body.specialtyLeafIds).toEqual(['plumbing']);
    expect(body.version).toBe(4);
  });
});

describe('the picker — configured limits', () => {
  const atLimit = () =>
    DRAFT({
      data: {
        maxSpecialties: 2,
        specialties: [specialty('plumbing', 'APPROVED'), specialty('drains', 'PENDING')],
      },
    });

  it('shows the count against the OPERATOR-configured ceiling', async () => {
    renderScreen(atLimit());
    expect(await screen.findByTestId('specialty-count')).toHaveTextContent('2 of 2 chosen');
  });

  it('blocks adding another once the limit is reached', async () => {
    renderScreen(atLimit());
    fireEvent.click(await screen.findByTestId('specialty-group-g-2'));
    expect(
      within(screen.getByTestId('specialty-option-wiring')).getByRole('checkbox'),
    ).toBeDisabled();
  });

  it('still lets an already-chosen one be REMOVED at the limit', async () => {
    // Otherwise the limit is a trap: nothing can be added and nothing swapped.
    renderScreen(atLimit());
    fireEvent.click(await screen.findByTestId('specialty-group-g-1'));
    expect(
      within(screen.getByTestId('specialty-option-plumbing')).getByRole('checkbox'),
    ).toBeEnabled();
  });
});

describe('selection and review state are separate', () => {
  const mixed = () =>
    DRAFT({
      data: {
        specialties: [
          specialty('a', 'APPROVED'),
          specialty('p', 'PENDING'),
          specialty('r', 'REJECTED', { decidedAt: '2026-08-20T00:00:00.000Z' }),
          specialty('x', 'INACTIVE'),
        ],
      },
    });

  it('groups each state under its own heading', async () => {
    renderScreen(mixed());
    for (const state of ['APPROVED', 'PENDING', 'REJECTED', 'INACTIVE']) {
      expect(await screen.findByTestId(`specialty-state-${state}`)).toBeInTheDocument();
    }
  });

  it('explains each state ONCE, on the group — not as a badge per chip', async () => {
    // The old screen put a "pending" badge inside every selected chip, which
    // is what made review state unreadable and unignorable at the same time.
    renderScreen(mixed());
    const explain = await screen.findByTestId('specialty-state-explain-PENDING');
    expect(explain).toHaveTextContent(SERVICES_COPY.en.stateExplain.PENDING);

    // The row itself carries no state badge text.
    expect(screen.getByTestId('specialty-row-p')).not.toHaveTextContent(
      SERVICES_COPY.en.stateHeading.PENDING,
    );
  });

  it('does NOT paint PENDING as a problem', async () => {
    // The acceptance criterion. A pending admin decision is not a user
    // validation failure and must not be toned like one.
    renderScreen(mixed());
    expect(await screen.findByTestId('specialty-row-p')).toHaveAttribute('data-tone', 'neutral');
    expect(screen.getByTestId('specialty-row-r')).toHaveAttribute('data-tone', 'negative');
  });

  it('tells a PENDING provider they can carry on with the rest', async () => {
    renderScreen(mixed());
    expect(await screen.findByTestId('specialty-state-explain-PENDING')).toHaveTextContent(
      /carry on/i,
    );
  });

  it('distinguishes a RETIRED category from a rejection, and does not blame the provider', async () => {
    renderScreen(mixed());
    const inactive = await screen.findByTestId('specialty-state-explain-INACTIVE');
    expect(inactive).toHaveTextContent(/no longer offer/i);
    expect(inactive).toHaveTextContent(/nothing you did/i);
  });

  it('renders a retired category by NAME rather than dropping it', async () => {
    // It is not in the active catalogue, so a client that joined against the
    // catalogue would render a bare id or nothing at all.
    renderScreen(mixed());
    expect(await screen.findByTestId('specialty-row-x')).toHaveTextContent('Label x');
  });
});

describe('the primary service', () => {
  const withTwo = () =>
    DRAFT({
      data: {
        specialties: [specialty('a', 'APPROVED'), specialty('p', 'PENDING')],
        primarySpecialtyId: 'a',
      },
    });

  it('marks the primary and offers no button on it', async () => {
    renderScreen(withTwo());
    expect(await screen.findByTestId('primary-badge-a')).toBeInTheDocument();
    expect(screen.queryByTestId('make-primary-a')).toBeNull();
  });

  it('lets a PENDING specialty be made primary', async () => {
    // Nominating is an intention, not an authorization — and refusing would
    // leave the screen unusable for providers mid-application.
    renderScreen(withTwo());
    fireEvent.click(await screen.findByTestId('make-primary-p'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).primarySpecialtyId).toBe('p');
  });

  it('offers no primary button on a REJECTED or RETIRED specialty', async () => {
    renderScreen(
      DRAFT({
        data: { specialties: [specialty('r', 'REJECTED'), specialty('x', 'INACTIVE')] },
      }),
    );
    await screen.findByTestId('specialty-row-r');
    expect(screen.queryByTestId('make-primary-r')).toBeNull();
    expect(screen.queryByTestId('make-primary-x')).toBeNull();
  });
});

describe('experience', () => {
  it('asks for the START YEAR and derives the count from it', async () => {
    renderScreen();
    const field = await screen.findByTestId('profession-start-year');
    fireEvent.change(field, { target: { value: String(new Date().getUTCFullYear() - 7) } });

    expect(screen.getByTestId('derived-years')).toHaveTextContent('7 years of experience');
  });

  it('stores a DATE, not a bucket', async () => {
    // A bucket cannot be compared, filtered or aged. The stored fact stays a
    // fact and the server derives the years.
    renderScreen();
    const field = await screen.findByTestId('profession-start-year');
    fireEvent.change(field, { target: { value: '2015' } });
    fireEvent.blur(field);

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(body.professionSince).toBe('2015-01-01T00:00:00.000Z');
    expect(mock.history.patch[0].url).toContain('/steps/EXPERIENCE');
  });

  it.each(['1900', '1949', String(new Date().getUTCFullYear() + 1)])(
    'refuses the out-of-range year %s without sending it',
    async (year) => {
      renderScreen();
      const field = await screen.findByTestId('profession-start-year');
      fireEvent.change(field, { target: { value: year } });
      fireEvent.blur(field);

      expect(screen.getByText(SERVICES_COPY.en.startYearInvalid)).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 50));
      expect(mock.history.patch).toHaveLength(0);
    },
  );

  it('accepts the boundary years', async () => {
    renderScreen();
    const field = await screen.findByTestId('profession-start-year');
    fireEvent.change(field, { target: { value: '1950' } });
    fireEvent.blur(field);

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).professionSince).toBe('1950-01-01T00:00:00.000Z');
  });
});

describe('transport', () => {
  it('supports MULTIPLE modes', async () => {
    renderScreen(DRAFT({ data: { transportModes: ['CAR'], transportMode: 'CAR' } }));
    fireEvent.click(within(await screen.findByTestId('transport-VAN')).getByRole('checkbox'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).transportModes).toEqual(['CAR', 'VAN']);
  });

  it('shows which one is the primary', async () => {
    renderScreen(DRAFT({ data: { transportModes: ['CAR', 'VAN'], transportMode: 'VAN' } }));
    expect(await screen.findByTestId('transport-VAN')).toHaveAttribute('data-primary', 'true');
    expect(screen.getByTestId('transport-CAR')).toHaveAttribute('data-primary', 'false');
  });

  it('does NOT send the primary — the server keeps it consistent', async () => {
    // Two clients resolving "the primary is no longer in the set" differently
    // is how they drift. The server decides and tells both.
    renderScreen(DRAFT({ data: { transportModes: ['CAR'], transportMode: 'CAR' } }));
    fireEvent.click(within(await screen.findByTestId('transport-CAR')).getByRole('checkbox'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(body.transportModes).toEqual([]);
    expect(body).not.toHaveProperty('transportMode');
  });
});

describe('equipment', () => {
  it('lists the catalogue and saves by CODE', async () => {
    renderScreen();
    fireEvent.click(within(await screen.findByTestId('equipment-LADDER')).getByRole('checkbox'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).equipmentCodes).toEqual(['LADDER']);
  });

  it('says so when the catalogue is empty rather than showing nothing', async () => {
    mock.onGet('/v1/services/equipment').reply(200, { items: [] });
    renderScreen();
    expect(await screen.findByTestId('equipment-empty')).toBeInTheDocument();
  });
});

describe('the professional title', () => {
  const withSuggestion = () =>
    DRAFT({
      data: {
        specialties: [specialty('plumbing', 'APPROVED')],
        primarySpecialtyId: 'plumbing',
        suggestedTitle: { en: 'Plumber', ar: 'سبّاك' },
      },
    });

  it('offers the suggestion without applying it', async () => {
    renderScreen(withSuggestion());
    expect(await screen.findByTestId('title-suggestion-text')).toHaveTextContent('Plumber');
    // Nothing typed, nothing saved.
    expect(screen.queryByTestId('title-input')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.history.patch).toHaveLength(0);
  });

  it('says plainly that nothing is published yet', async () => {
    // The acceptance criterion, made visible to the person it protects.
    renderScreen(withSuggestion());
    expect(await screen.findByTestId('title-not-published')).toHaveTextContent(
      SERVICES_COPY.en.titleNotPublished,
    );
  });

  it('accepting the suggestion fills the box and still does not publish', async () => {
    renderScreen(withSuggestion());
    fireEvent.click(await screen.findByTestId('title-accept'));

    expect((screen.getByTestId('title-input') as HTMLInputElement).value).toBe('Plumber');
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.history.patch).toHaveLength(0);
  });

  it('suggests in ARABIC for an Arabic reader', async () => {
    renderScreen(withSuggestion(), 'ar');
    expect(await screen.findByTestId('title-suggestion-text')).toHaveTextContent('سبّاك');
  });

  it('shows no suggestion when there is no primary', async () => {
    renderScreen();
    await screen.findByTestId('services-task');
    expect(screen.queryByTestId('title-suggestion')).toBeNull();
  });

  it.each([
    ['Plumber www.example.com', 'CONTAINS_URL'],
    ['Plumber 0912345678', 'CONTAINS_CONTACT'],
    ['Certified Plumber', 'UNSUPPORTED_CREDENTIAL'],
    ['Best Plumber', 'PROHIBITED_CLAIM'],
  ])('refuses %j inline', async (value, code) => {
    renderScreen(withSuggestion());
    fireEvent.click(await screen.findByTestId('title-edit'));
    fireEvent.change(screen.getByTestId('title-input'), { target: { value } });

    expect(screen.getByTestId('title-help')).toHaveTextContent(SERVICES_COPY.en.titleRefusal[code]);
  });
});

describe('Arabic', () => {
  it('renders Arabic copy throughout', async () => {
    renderScreen(DRAFT({ data: { specialties: [specialty('p', 'PENDING')] } }), 'ar');
    expect(await screen.findByTestId('specialty-state-explain-PENDING')).toHaveTextContent(
      SERVICES_COPY.ar.stateExplain.PENDING,
    );
    expect(screen.queryByText(SERVICES_COPY.en.stateExplain.PENDING)).toBeNull();
  });
});

describe('a locked application', () => {
  it('disables every control', async () => {
    renderScreen(DRAFT(), 'en', false);
    expect(await screen.findByTestId('profession-start-year')).toBeDisabled();
    expect(within(screen.getByTestId('transport-CAR')).getByRole('checkbox')).toBeDisabled();
  });
});
