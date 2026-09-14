import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ServicesTask, ServicesTaskScreen } from './ServicesTaskScreen';
import { SERVICES_COPY } from '../copy/services-copy';
import {
  AUTOSAVE_DEBOUNCE_MS,
  ProviderOnboardingAutosaveProvider,
} from '../autosave/ProviderOnboardingAutosaveProvider';

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

type Part = 'services' | 'experience';

function renderScreen(
  view = DRAFT(),
  lang: 'en' | 'ar' = 'en',
  editable = true,
  part: Part = 'services',
) {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), view);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ProviderOnboardingAutosaveProvider>
            <ServicesTaskScreen view={view as never} lang={lang} editable={editable} part={part} />
          </ProviderOnboardingAutosaveProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// Sprint 09B.29 Phase 5A — Task 2 is TWO approved screens.
//
// `services` is a searchable FLAT list of selectable leaves with one sentence
// about moderation. `experience` is the stepper, the transport group and the
// suggested-title panel. The group browser and the four per-state sections are
// gone with the approved design; every property they protected is asserted
// below on the design that replaced them.

describe('the picker — finding a service at catalogue scale', () => {
  it('offers every selectable leaf', async () => {
    renderScreen();
    await screen.findByTestId('specialty-choices');

    for (const id of ['plumbing', 'drains', 'wiring', 'flat']) {
      expect(screen.getByTestId(`specialty-choice-${id}`)).toBeInTheDocument();
    }
  });

  it('never offers a GROUP as selectable', async () => {
    renderScreen();
    await screen.findByTestId('specialty-choices');

    // `isLeaf` is READ, never derived from "has no children". A parent whose
    // last child was retired must not quietly become a competency a provider
    // can claim, and this is the assertion that stops it.
    expect(screen.queryByTestId('specialty-choice-g-1')).toBeNull();
    expect(screen.queryByTestId('specialty-choice-g-2')).toBeNull();
  });

  it('offers a selectable ROOT, so a flat catalogue still works', async () => {
    renderScreen();
    await screen.findByTestId('specialty-choices');
    // `flat` is a leaf at the root — every pre-hierarchy row looks like this.
    expect(screen.getByTestId('specialty-choice-flat')).toBeInTheDocument();
  });

  it('searches across the catalogue', async () => {
    renderScreen();
    await screen.findByTestId('specialty-choices');

    fireEvent.change(screen.getByTestId('specialty-search'), { target: { value: 'wir' } });
    expect(screen.getByTestId('specialty-choice-wiring')).toBeInTheDocument();
    expect(screen.queryByTestId('specialty-choice-plumbing')).toBeNull();
  });

  it('matches the OTHER language too', async () => {
    renderScreen();
    await screen.findByTestId('specialty-choices');

    // An Arabic speaker reading the English UI, or the reverse. Matching only
    // the displayed language makes half the catalogue unfindable.
    fireEvent.change(screen.getByTestId('specialty-search'), { target: { value: 'تمديدات' } });
    expect(screen.getByTestId('specialty-choice-wiring')).toBeInTheDocument();
  });

  it('says so when nothing matches, and suggests what to do', async () => {
    renderScreen();
    await screen.findByTestId('specialty-choices');

    fireEvent.change(screen.getByTestId('specialty-search'), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('specialty-no-results')).toBeInTheDocument();
  });

  it('uses a real checkbox, so it is announced and keyboard-operable', async () => {
    renderScreen();
    await screen.findByTestId('specialty-choices');

    const input = within(screen.getByTestId('specialty-choice-plumbing')).getByRole('checkbox');
    expect(input).toBeInTheDocument();
    expect(input).not.toBeChecked();
  });

  it('saves the chosen ids to the SPECIALTIES step', async () => {
    renderScreen();
    await screen.findByTestId('specialty-choices');

    fireEvent.click(within(screen.getByTestId('specialty-choice-plumbing')).getByRole('checkbox'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const sent = mock.history.patch.find((r) => r.url?.includes('SPECIALTIES'));
    expect(sent, 'the write goes to the SPECIALTIES step').toBeTruthy();
    expect(JSON.parse(sent!.data).specialtyLeafIds).toEqual(['plumbing']);
  });
});

describe('the picker — configured limits', () => {
  // Three chosen against a ceiling of three.
  const full = DRAFT({
    data: {
      maxSpecialties: 3,
      specialties: [
        specialty('plumbing', 'APPROVED'),
        specialty('drains', 'APPROVED'),
        specialty('wiring', 'APPROVED'),
      ],
    },
  });

  it('blocks adding another once the limit is reached', async () => {
    renderScreen(full);
    await screen.findByTestId('specialty-choices');

    // SUPERSEDED: the old screen printed "3 of 3 chosen" and the approved one
    // prints no counter at all. The LIMIT is a server setting and is still
    // enforced — offering a selection the save is about to refuse is the
    // defect, not the missing number.
    const another = within(screen.getByTestId('specialty-choice-flat')).getByRole('checkbox');
    expect(another).toBeDisabled();
  });

  it('still lets an already-chosen one be REMOVED at the limit', async () => {
    renderScreen(full);
    await screen.findByTestId('specialty-choices');

    // The way out of a full list must never be closed.
    const chosen = within(screen.getByTestId('specialty-choice-plumbing')).getByRole('checkbox');
    expect(chosen).toBeEnabled();

    fireEvent.click(chosen);
    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const sent = mock.history.patch.find((r) => r.url?.includes('SPECIALTIES'));
    expect(JSON.parse(sent!.data).specialtyLeafIds).not.toContain('plumbing');
  });
});

describe('selection and review state are separate', () => {
  const mixed = DRAFT({
    data: {
      specialties: [
        specialty('plumbing', 'APPROVED'),
        specialty('drains', 'PENDING'),
        specialty('wiring', 'REJECTED'),
        specialty('retired', 'INACTIVE'),
      ],
    },
  });

  it('says ONCE that moderation is separate, and does not blame the provider', async () => {
    renderScreen(mixed);
    await screen.findByTestId('specialty-choices');

    // SUPERSEDED: four labelled sections, one per state, each with its own
    // explanation. The approved screen carries one sentence — and it is the
    // load-bearing one, because it is what stops a PENDING decision reading as
    // a validation failure the provider has to clear before submitting.
    const notice = screen.getByTestId('specialty-moderation-notice');
    expect(notice).toHaveTextContent(SERVICES_COPY.en.moderationTitle);
    expect(notice).toHaveTextContent(/will not block submission/);
    expect(screen.queryAllByTestId(/^specialty-state-/)).toHaveLength(0);
  });

  it('does NOT paint PENDING as a problem', async () => {
    renderScreen(mixed);
    await screen.findByTestId('specialty-choices');

    // A decision nobody has made yet is not a failure, and the row says
    // nothing alarming about it. The notice above speaks for it instead.
    const row = screen.getByTestId('specialty-choice-drains');
    expect(row).not.toHaveTextContent(SERVICES_COPY.en.stateHeading.REJECTED);
    expect(row).not.toHaveTextContent(SERVICES_COPY.en.stateHeading.INACTIVE);
  });

  it('distinguishes a RETIRED category from a rejection', async () => {
    renderScreen(mixed);
    await screen.findByTestId('specialty-choices');

    // Two different facts with two different sentences: an admin said no, or
    // the platform stopped offering it. Collapsing them blames the provider
    // for a decision that was never about them.
    expect(screen.getByTestId('specialty-choice-wiring')).toHaveTextContent(
      SERVICES_COPY.en.stateHeading.REJECTED,
    );
    expect(screen.getByTestId('specialty-choice-retired')).toHaveTextContent(
      SERVICES_COPY.en.stateHeading.INACTIVE,
    );
  });

  it('renders a retired category by NAME rather than dropping it', async () => {
    renderScreen(mixed);
    await screen.findByTestId('specialty-choices');

    // `retired` is not in the catalogue at all. Its labels travel with the
    // state for exactly this reason — without them it renders as a bare id,
    // and without the row it vanishes from a screen the provider is being
    // asked to confirm.
    expect(screen.getByTestId('specialty-choice-retired')).toHaveTextContent('Label retired');
  });
});

// ── Pending intent: the defect behind the user's stuck Services task ────────
//
// Reported from manual testing: specialties were entered, the hub stayed at
// 4 of 6, and Services kept saying مطلوب. The developer's database showed
// `primaryServiceCategoryId` SET and `ProviderProfileServiceCategory` EMPTY —
// a primary with no membership, which is what an empty `specialtyLeafIds`
// payload produces.
//
// `chosenIds` derives from `view.data.specialties`, which is the last
// ACKNOWLEDGED server state, and every toggle computed its next set from it. So
// a second pick made before the first was acknowledged replaced the first
// instead of joining it, and a de-select could resurrect a selection. The queue
// merges by property, so the later array simply wins.
//
// These tests hold the acknowledgement open, which is the only way the race is
// deterministic — awaited clicks on a fast runner do not overlap.
describe('selections made before the server answers', () => {
  /** Hold every step PATCH until `release()`, capturing what was sent. */
  function heldPatch(): { sent: () => Record<string, unknown>[]; release: () => void } {
    const bodies: Record<string, unknown>[] = [];
    let unblock: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    mock.onPatch(PATCH).reply(async (config) => {
      bodies.push(JSON.parse(String(config.data)) as Record<string, unknown>);
      await gate;
      return [200, DRAFT()];
    });
    return { sent: () => bodies, release: () => unblock() };
  }

  it('keeps BOTH specialties when the second is chosen before the first is saved', async () => {
    const held = heldPatch();
    renderScreen();

    fireEvent.click(
      within(await screen.findByTestId('specialty-choice-plumbing')).getByRole('checkbox'),
    );
    fireEvent.click(
      within(await screen.findByTestId('specialty-choice-wiring')).getByRole('checkbox'),
    );

    // The payload the server is asked to store must contain both. Reading the
    // LAST body rather than the first: the coordinator may coalesce, and what
    // matters is that the set it finally sends is the set the provider chose.
    await waitFor(() => expect(held.sent().length).toBeGreaterThan(0));
    held.release();

    await waitFor(() => {
      const last = held.sent()[held.sent().length - 1];
      expect(last.specialtyLeafIds).toEqual(expect.arrayContaining(['plumbing', 'wiring']));
    });
  });

  it('shows the tick immediately, not only once the server agrees', async () => {
    // The checkbox rendered acknowledged state, so a provider who tapped a
    // specialty saw nothing happen until the round trip finished — which is
    // exactly what "I entered them and it did not take" looks like.
    const held = heldPatch();
    renderScreen();

    const box = within(await screen.findByTestId('specialty-choice-plumbing')).getByRole(
      'checkbox',
    );
    fireEvent.click(box);
    expect(box).toBeChecked();
    held.release();
  });

  it('removes a specialty that is de-selected before its own save lands', async () => {
    const held = heldPatch();
    renderScreen();

    const box = within(await screen.findByTestId('specialty-choice-plumbing')).getByRole(
      'checkbox',
    );
    fireEvent.click(box);
    fireEvent.click(box);
    expect(box).not.toBeChecked();

    await waitFor(() => expect(held.sent().length).toBeGreaterThan(0));
    held.release();

    await waitFor(() => {
      const last = held.sent()[held.sent().length - 1];
      expect(last.specialtyLeafIds).toEqual([]);
    });
  });

  it('keeps BOTH transport modes when the second is chosen before the first is saved', async () => {
    const held = heldPatch();
    renderScreen(DRAFT(), 'en', true, 'experience');

    fireEvent.click(within(await screen.findByTestId('transport-CAR')).getByRole('checkbox'));
    fireEvent.click(
      within(await screen.findByTestId('transport-MOTORCYCLE')).getByRole('checkbox'),
    );

    await waitFor(() => expect(held.sent().length).toBeGreaterThan(0));
    held.release();

    await waitFor(() => {
      const last = held.sent()[held.sent().length - 1];
      expect(last.transportModes).toEqual(expect.arrayContaining(['CAR', 'MOTORCYCLE']));
    });
  });
});

describe('selections made while a save is OPEN', () => {
  // Sprint 09B.29 Phase 5B — the half of the defect the block above could not
  // see.
  //
  // Those tests click both boxes inside the 900 ms debounce, so nothing has
  // been SENT when the second press happens. The provider's report was
  // different: they pressed, waited, and pressed again. By then the request had
  // left, and the coordinator reported the step acknowledged for the whole
  // length of the round trip — so the screen handed authority back to a draft
  // that did not contain the first choice yet, un-ticked it, and computed the
  // second payload from a set that had lost it.
  //
  // These render the CONTAINER rather than the screen, because the mechanism is
  // the draft cache moving underneath: a static `view` prop can never un-tick
  // anything, which is exactly why a screen-level test could not catch it.
  //
  // NO `waitFor` BELOW THE FAKE TIMERS. Testing Library's fake-timer detection
  // does not recognise vitest's, so a `waitFor` here polls on a clock nothing
  // will advance and hangs until the test times out — which it did, and the
  // failure looks like a product bug rather than a harness one. Every wait is
  // an explicit `settle()` instead, and the assertions after it are synchronous.

  /** A server that ACKNOWLEDGES what it is sent, held open until released. */
  function heldServer() {
    const bodies: Record<string, unknown>[] = [];
    let unblock: () => void = () => {};
    let gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let version = 4;
    mock.onPatch(PATCH).reply(async (config) => {
      const body = JSON.parse(String(config.data)) as Record<string, unknown>;
      bodies.push(body);
      await gate;
      version += 1;
      const ids = (body.specialtyLeafIds as string[] | undefined) ?? [];
      return [
        200,
        DRAFT({
          version,
          data: {
            specialtyLeafIds: ids,
            // What the server gives back after a choice: an application, not a
            // membership. The tick has to follow THIS, not an approval.
            specialties: ids.map((id) => specialty(id, 'PENDING')),
            transportModes: (body.transportModes as string[] | undefined) ?? [],
          },
        }),
      ];
    });
    return {
      sent: () => bodies,
      last: () => bodies[bodies.length - 1],
      release: () => {
        unblock();
        // Later writes are no longer held.
        gate = Promise.resolve();
      },
    };
  }

  function renderContainer(part: Part = 'services') {
    window.localStorage.setItem('hsm.lang', 'en');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT());
    mock.onGet(/onboarding\/draft$/).reply(200, DRAFT());
    mock.onGet(/onboarding\/hub$/).reply(200, {
      tasks: [],
      progress: { complete: 0, total: 6 },
      nextAction: { kind: 'NONE' },
      status: 'DRAFT',
    });
    mock.onGet(/onboarding\/review/).reply(200, {
      sections: [],
      blockers: [],
      canSubmit: false,
      version: 4,
    });
    return render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <LanguageProvider>
            <ProviderOnboardingAutosaveProvider>
              <ServicesTask lang="en" part={part} />
            </ProviderOnboardingAutosaveProvider>
          </LanguageProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  /** Expire the debounce and drain everything it set off. */
  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 50);
    });
    // A second pass: the response seeds the draft cache and fires the
    // projection invalidations, and those resolve a turn later.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }

  const box = (id: string) =>
    within(screen.getByTestId(`specialty-choice-${id}`)).getByRole('checkbox');
  const transport = (code: string) =>
    within(screen.getByTestId(`transport-${code}`)).getByRole('checkbox');

  it('keeps the first choice ticked while its own PATCH is still open', async () => {
    const held = heldServer();
    renderContainer();
    await screen.findByTestId('specialty-choices');
    vi.useFakeTimers();

    fireEvent.click(box('plumbing'));
    expect(box('plumbing')).toBeChecked();

    await settle();
    expect(held.sent()).toHaveLength(1);

    // BEFORE THE FIX: the tick disappeared here, mid-round-trip, with nothing
    // on screen to explain it.
    expect(box('plumbing')).toBeChecked();

    held.release();
    await settle();
    // ...and it is still ticked once the server has agreed — this time because
    // the acknowledged set says so, not because intent is being held.
    expect(box('plumbing')).toBeChecked();
  });

  it('keeps BOTH when the second is chosen while the first is open', async () => {
    const held = heldServer();
    renderContainer();
    await screen.findByTestId('specialty-choices');
    vi.useFakeTimers();

    fireEvent.click(box('plumbing'));
    await settle();
    expect(held.sent()).toHaveLength(1);

    // The press that used to lose the first choice: the payload was derived
    // from the acknowledged set, which was still empty.
    fireEvent.click(box('wiring'));
    expect(box('plumbing')).toBeChecked();
    expect(box('wiring')).toBeChecked();

    held.release();
    await settle();

    expect(held.last().specialtyLeafIds).toEqual(expect.arrayContaining(['plumbing', 'wiring']));
    expect(box('plumbing')).toBeChecked();
    expect(box('wiring')).toBeChecked();
  });

  it('keeps a de-selection made while an earlier save is open', async () => {
    const held = heldServer();
    renderContainer();
    await screen.findByTestId('specialty-choices');
    vi.useFakeTimers();

    fireEvent.click(box('plumbing'));
    fireEvent.click(box('wiring'));
    await settle();
    expect(held.sent()).toHaveLength(1);

    // Removing one while the write that added both is still open. A snap-back
    // here would silently re-add it.
    fireEvent.click(box('plumbing'));
    expect(box('plumbing')).not.toBeChecked();
    expect(box('wiring')).toBeChecked();

    held.release();
    await settle();

    expect(held.last().specialtyLeafIds).toEqual(['wiring']);
    expect(box('plumbing')).not.toBeChecked();
    expect(box('wiring')).toBeChecked();
  });

  it('keeps both transport modes when the second is chosen while the first is open', async () => {
    const held = heldServer();
    renderContainer('experience');
    await screen.findByTestId('transport-CAR');
    vi.useFakeTimers();

    fireEvent.click(transport('CAR'));
    await settle();
    expect(held.sent()).toHaveLength(1);

    fireEvent.click(transport('MOTORCYCLE'));
    expect(transport('CAR')).toBeChecked();
    expect(transport('MOTORCYCLE')).toBeChecked();

    held.release();
    await settle();

    expect(held.last().transportModes).toEqual(expect.arrayContaining(['CAR', 'MOTORCYCLE']));
  });

  it('keeps the choice on screen when the save FAILS, so the retry sends it', async () => {
    renderContainer();
    await screen.findByTestId('specialty-choices');
    mock.onPatch(PATCH).reply(500, { code: 'INTERNAL_ERROR' });
    vi.useFakeTimers();

    fireEvent.click(box('plumbing'));
    await settle();

    // Nothing was stored, and the screen must not pretend otherwise by
    // reverting to a server state that never received the choice.
    expect(box('plumbing')).toBeChecked();
  });
});

describe('the primary service', () => {
  const withPrimary = DRAFT({
    data: {
      specialties: [specialty('plumbing', 'PENDING'), specialty('drains', 'APPROVED')],
      primarySpecialtyId: 'plumbing',
    },
  });

  it('marks the primary on its own row', async () => {
    renderScreen(withPrimary);
    await screen.findByTestId('specialty-choices');

    expect(screen.getByTestId('specialty-choice-plumbing')).toHaveTextContent(
      SERVICES_COPY.en.primaryBadge,
    );
    expect(screen.getByTestId('specialty-choice-drains')).not.toHaveTextContent(
      SERVICES_COPY.en.primaryBadge,
    );
  });

  it('marks a PENDING specialty as primary — nominating is not being approved', async () => {
    renderScreen(withPrimary);
    await screen.findByTestId('specialty-choices');

    // The server nominated a specialty that is still in moderation, and the
    // screen shows it. Refusing to would conflate "I lead with this" with "an
    // admin agreed", which is the separation this whole screen is built on.
    expect(screen.getByTestId('specialty-choice-plumbing')).toHaveTextContent(
      SERVICES_COPY.en.primaryBadge,
    );
  });

  it('offers no control to change it — RECORDED PHASE 5B GAP', async () => {
    renderScreen(withPrimary);
    await screen.findByTestId('specialty-choices');

    // RECORDED, not silently accepted. The approved screen shows WHICH service
    // is primary and draws no control to change it, so this migration removes
    // the "make primary" buttons the previous screen had. Nominating a
    // different primary therefore has no surface in Phase 5A.
    //
    // Nothing is lost server-side: `primarySpecialtyId` is untouched and the
    // server keeps it consistent with the chosen set. The missing AFFORDANCE
    // is an integration gap for Phase 5B, and this assertion exists so that
    // re-adding a control is a deliberate change rather than a drift.
    expect(screen.queryAllByTestId(/^make-primary-/)).toHaveLength(0);
  });
});

describe('experience — the approved stepper', () => {
  // SUPERSEDED CONTRACT, recorded rather than deleted.
  //
  // These tests drove a numeric START YEAR field and asserted its range
  // refusals (1900, 1949, next year) and its derived count. They were correct
  // for the Sprint 9B.18 design.
  //
  // The approved experience screen replaces that field with a -/+ stepper, and
  // says why in its own help text: it avoids typing errors. A stepper cannot
  // express an out-of-range value at all, so the refusal tests have nothing
  // left to refuse — which is stricter than validating the mistake after the
  // fact.
  //
  // What has NOT changed is the stored fact. It is still professionSince, a
  // DATE, so a provider's experience does not silently stop ageing. That
  // assertion is kept verbatim below.
  it('shows the stored years, derived from the stored date', async () => {
    const started = new Date().getUTCFullYear() - 7;
    renderScreen(
      DRAFT({ data: { professionSince: `${started}-01-01T00:00:00.000Z` } }),
      'en',
      true,
      'experience',
    );

    expect(await screen.findByTestId('experience-years-value')).toHaveTextContent('7');
  });

  it('stores a DATE, not a bucket', async () => {
    // A bucket cannot be compared, filtered or aged. The stored fact stays a
    // fact and the server derives the years.
    const thisYear = new Date().getUTCFullYear();
    renderScreen(
      DRAFT({ data: { professionSince: `${thisYear - 10}-01-01T00:00:00.000Z` } }),
      'en',
      true,
      'experience',
    );

    fireEvent.click(await screen.findByTestId('experience-years-increase'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(body.professionSince).toBe(`${thisYear - 11}-01-01T00:00:00.000Z`);
    expect(mock.history.patch[0].url).toContain('/steps/EXPERIENCE');
  });

  it('cannot go below zero, and says so by disabling the control', async () => {
    // The old field needed an inline error for 1900. A stepper at its bound
    // simply cannot be pressed, which is announced and unfocusable.
    renderScreen(DRAFT({ data: { professionSince: null } }), 'en', true, 'experience');

    const decrease = await screen.findByTestId('experience-years-decrease');
    expect(decrease).toBeDisabled();

    fireEvent.click(decrease);
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.history.patch).toHaveLength(0);
  });

  it('names both buttons for assistive technology', async () => {
    renderScreen(DRAFT(), 'en', true, 'experience');

    expect(
      await screen.findByRole('button', { name: SERVICES_COPY.en.yearsDecrease }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: SERVICES_COPY.en.yearsIncrease }),
    ).toBeInTheDocument();
  });
});

describe('transport', () => {
  // The approved screen offers four modes: Car, Motorbike, On foot, Public
  // transport. VAN and TRUCK are supported by the product and are NOT drawn
  // here — see APPROVED_TRANSPORT. Multi-select is asserted on a mode the
  // screen actually shows.
  it('supports MULTIPLE modes', async () => {
    renderScreen(
      DRAFT({ data: { transportModes: ['CAR'], transportMode: 'CAR' } }),
      'en',
      true,
      'experience',
    );
    fireEvent.click(
      within(await screen.findByTestId('transport-MOTORCYCLE')).getByRole('checkbox'),
    );

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).transportModes).toEqual(['CAR', 'MOTORCYCLE']);
  });

  it('never drops a stored mode the approved screen does not show', async () => {
    // The regression this guards is silent DATA LOSS. A provider who recorded
    // a van elsewhere must still have it after touching this screen, because
    // the screen not drawing a control is a display decision and is never
    // licence to unset the value behind it.
    renderScreen(
      DRAFT({ data: { transportModes: ['CAR', 'VAN'], transportMode: 'CAR' } }),
      'en',
      true,
      'experience',
    );
    fireEvent.click(within(await screen.findByTestId('transport-ON_FOOT')).getByRole('checkbox'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const sent = JSON.parse(mock.history.patch[0].data).transportModes;
    expect(sent).toContain('VAN');
    expect(sent).toContain('ON_FOOT');
  });

  it('shows which one is the primary', async () => {
    // The approved row marks the primary with the RANGE it grants — "15 km
    // range" — rather than with a separate badge. That is the note the
    // reference draws, and it is the one that explains why the radius on the
    // work-area screen is what it is.
    renderScreen(
      DRAFT({
        data: {
          transportModes: ['CAR', 'MOTORCYCLE'],
          transportMode: 'CAR',
          serviceAreaExpansion: { allowedMaxKm: 15 },
        },
      }),
      'en',
      true,
      'experience',
    );
    expect(await screen.findByTestId('transport-CAR')).toHaveTextContent(/15 km range/);
    expect(screen.getByTestId('transport-MOTORCYCLE')).not.toHaveTextContent(/km range/);
  });

  it('does NOT send the primary — the server keeps it consistent', async () => {
    // Two clients resolving "the primary is no longer in the set" differently
    // is how they drift. The server decides and tells both.
    renderScreen(
      DRAFT({ data: { transportModes: ['CAR'], transportMode: 'CAR' } }),
      'en',
      true,
      'experience',
    );
    fireEvent.click(within(await screen.findByTestId('transport-CAR')).getByRole('checkbox'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(body.transportModes).toEqual([]);
    expect(body).not.toHaveProperty('transportMode');
  });
});

describe('equipment — absent from the approved screen', () => {
  it('renders no equipment section at all', async () => {
    renderScreen(DRAFT(), 'en', true, 'experience');
    await screen.findByTestId('experience-section');

    // Optional data the completeness policy never asks for. Removing the
    // control dead-ends nothing, and stored values are untouched.
    expect(screen.queryByTestId('equipment-options')).toBeNull();
    expect(screen.queryByText(/ladder/i)).toBeNull();
  });
});

describe('the suggested title — shown, not edited', () => {
  // SUPERSEDED CONTRACT. These tests drove an editable title: accepting a
  // suggestion into a box, and refusing "Best Plumber", "Certified Plumber", a
  // URL and a phone number inline.
  //
  // Ruling C1 makes the generated title server-owned and this screen's
  // presentation of it explanatory. The accept / edit / refuse controls are
  // gone, so there is no client-side title validation left to test here; the
  // server owns the value and the profile surface owns the editing.
  const suggested = DRAFT({
    data: { suggestedTitle: { en: 'Painting professional', ar: 'فني دهانات' } },
  });

  it("shows the server-generated suggestion for the reader's language", async () => {
    renderScreen(suggested, 'en', true, 'experience');

    const panel = await screen.findByTestId('title-suggestion-text');
    expect(panel).toHaveTextContent('Painting professional');
  });

  it('offers no control to accept, edit or refuse it', async () => {
    renderScreen(suggested, 'en', true, 'experience');
    await screen.findByTestId('experience-section');

    expect(screen.queryByTestId('title-input')).toBeNull();
    expect(screen.queryByTestId('title-accept')).toBeNull();
    expect(screen.queryByTestId('title-edit')).toBeNull();
  });

  it('says plainly that it is not published, only suggested', async () => {
    renderScreen(suggested, 'en', true, 'experience');

    // The approved panel makes the promise in one sentence rather than two:
    // the title was generated from the primary service and can be changed
    // later. What must not happen is a provider believing it is already live.
    expect(await screen.findByTestId('title-suggestion-text')).toHaveTextContent(/editable later/);
  });
});

describe('Arabic', () => {
  it('renders Arabic copy throughout', async () => {
    renderScreen(DRAFT({ data: { specialties: [specialty('p', 'PENDING')] } }), 'ar');

    // The per-state explanations are gone with the approved design; the one
    // sentence that replaced them is what an Arabic reader with a specialty in
    // moderation actually depends on.
    expect(await screen.findByTestId('specialty-moderation-notice')).toHaveTextContent(
      SERVICES_COPY.ar.moderationBody,
    );
    expect(screen.queryByText(SERVICES_COPY.en.moderationBody)).toBeNull();
  });

  it('renders the experience half in Arabic too', async () => {
    renderScreen(DRAFT(), 'ar', true, 'experience');
    expect(await screen.findByTestId('transport-CAR')).toHaveTextContent(
      SERVICES_COPY.ar.transportQuestion ? 'سيارة' : 'سيارة',
    );
  });
});

describe('a locked application', () => {
  it('disables every control', async () => {
    renderScreen(DRAFT(), 'en', false, 'experience');
    expect(await screen.findByTestId('experience-years-increase')).toBeDisabled();
    expect(within(screen.getByTestId('transport-CAR')).getByRole('checkbox')).toBeDisabled();
  });

  it('disables the picker too', async () => {
    renderScreen(DRAFT(), 'en', false);
    await screen.findByTestId('specialty-choices');
    expect(
      within(screen.getByTestId('specialty-choice-plumbing')).getByRole('checkbox'),
    ).toBeDisabled();
    expect(screen.getByTestId('specialty-search')).toBeDisabled();
  });
});
