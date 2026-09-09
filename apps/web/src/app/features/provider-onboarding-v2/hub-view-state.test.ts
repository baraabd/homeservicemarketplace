import { describe, it, expect } from 'vitest';
import type {
  ProviderOnboardingHubTask,
  ProviderOnboardingHubView,
} from '@homeservicemarketplace/contracts';

import { deriveHubView, groupTasks, isTaskActionable, nextActionTaskId } from './hub-view-state';

// Sprint 9B.16 — the hub's state machine, without React.
//
// Every screen the provider can be shown is decided here, so every one of them
// is asserted here. The component test then only has to prove it renders what
// this returns.

const task = (over: Partial<ProviderOnboardingHubTask> = {}): ProviderOnboardingHubTask => ({
  id: 'BASICS_IDENTITY',
  group: 'BASICS',
  status: 'AVAILABLE',
  title: 'البيانات الأساسية',
  description: 'الاسم، رقم الهاتف، والصورة الشخصية',
  ...over,
});

const view = (over: Partial<ProviderOnboardingHubView> = {}): ProviderOnboardingHubView => ({
  tasks: [task()],
  progress: { complete: 0, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'BASICS_IDENTITY' },
  status: 'DRAFT',
  ...over,
});

const q = (over: Partial<Parameters<typeof deriveHubView>[0]> = {}) => ({
  isFetched: true,
  data: view(),
  errorStatus: null,
  ...over,
});

describe('deriveHubView', () => {
  it('is LOADING until the query has settled once', () => {
    expect(deriveHubView(q({ isFetched: false, data: undefined }))).toEqual({
      state: 'LOADING',
      showsTasks: false,
    });
  });

  it('stays settled across a background refetch that has data', () => {
    // The gate is "have we ever had an answer?", so a later refetch must not
    // tear the screen back down to a spinner.
    expect(deriveHubView(q()).state).toBe('HUB');
  });

  // Sprint 9B.29 — 401 and 403 are DIFFERENT ANSWERS and get different screens.
  //
  // This block used to be `it.each([401, 403])('is UNAUTHORIZED on %i')`, which
  // encoded the defect rather than catching it: a freshly-upgraded provider
  // whose access token predates the role grant gets 403, and the hub told them
  // "Your session has ended. Please sign in again." Signing in again is not the
  // fix — the session is valid, the ROLE CLAIM is stale — and the advice sends
  // them back through an upgrade they have already completed.
  //
  // The prototype states the boundary explicitly on screen 16: "This message
  // appears only for a 401 response."
  it('is UNAUTHORIZED on 401 — the session really is missing or expired', () => {
    expect(deriveHubView(q({ data: undefined, errorStatus: 401 }))).toEqual({
      state: 'UNAUTHORIZED',
      showsTasks: false,
    });
  });

  it('is FORBIDDEN on 403 — authenticated, but the role claim is not usable yet', () => {
    expect(deriveHubView(q({ data: undefined, errorStatus: 403 }))).toEqual({
      state: 'FORBIDDEN',
      showsTasks: false,
    });
  });

  it('never labels a 403 as a session problem', () => {
    // Guards the specific regression: whatever else changes, these two must not
    // collapse back into one state.
    const unauth = deriveHubView(q({ data: undefined, errorStatus: 401 })).state;
    const forbidden = deriveHubView(q({ data: undefined, errorStatus: 403 })).state;
    expect(forbidden).not.toBe(unauth);
  });

  it('treats 404 as EMPTY, not an error — there is simply no application', () => {
    expect(deriveHubView(q({ data: undefined, errorStatus: 404 })).state).toBe('EMPTY');
  });

  it('is ERROR for a failure retrying might fix', () => {
    expect(deriveHubView(q({ data: undefined, errorStatus: 500 })).state).toBe('ERROR');
  });

  it('is ERROR when the query settled with neither data nor a status', () => {
    expect(deriveHubView(q({ data: undefined })).state).toBe('ERROR');
  });

  it('is EMPTY when the server sends no tasks', () => {
    expect(deriveHubView(q({ data: view({ tasks: [] }) })).state).toBe('EMPTY');
  });

  it('is SUBMITTED, with no task list, once the application is handed in', () => {
    expect(deriveHubView(q({ data: view({ status: 'SUBMITTED' }) }))).toEqual({
      state: 'SUBMITTED',
      showsTasks: false,
    });
  });

  it('is ALREADY_ACTIVE for an approved provider', () => {
    expect(deriveHubView(q({ data: view({ status: 'ACTIVE' }) }))).toEqual({
      state: 'ALREADY_ACTIVE',
      showsTasks: false,
    });
  });

  it('ranks application status above task status', () => {
    // An approved provider whose tasks still read AVAILABLE is not being
    // invited to reapply.
    const data = view({ status: 'ACTIVE', tasks: [task({ status: 'AVAILABLE' })] });
    expect(deriveHubView(q({ data })).state).toBe('ALREADY_ACTIVE');
  });

  it('KEEPS the task list for ACTION_REQUIRED — the banner has to be actionable', () => {
    expect(deriveHubView(q({ data: view({ status: 'ACTION_REQUIRED' }) }))).toEqual({
      state: 'ACTION_REQUIRED',
      showsTasks: true,
    });
  });
});

describe('groupTasks', () => {
  it('groups in first-appearance order and keeps task order inside a group', () => {
    const tasks = [
      task({ id: 'BASICS_IDENTITY', group: 'BASICS' }),
      task({ id: 'SERVICES_EXPERIENCE', group: 'SERVICES' }),
      task({ id: 'WORK_AREA', group: 'COVERAGE' }),
      task({ id: 'WORKING_HOURS', group: 'COVERAGE' }),
      task({ id: 'PORTFOLIO', group: 'PROFILE' }),
      task({ id: 'REVIEW_SUBMISSION', group: 'REVIEW' }),
    ];
    const grouped = groupTasks(tasks);

    expect(grouped.map((g) => g.group)).toEqual([
      'BASICS',
      'SERVICES',
      'COVERAGE',
      'PROFILE',
      'REVIEW',
    ]);
    // The two COVERAGE tasks collapse into ONE section, in order.
    expect(grouped[2].tasks.map((t) => t.id)).toEqual(['WORK_AREA', 'WORKING_HOURS']);
  });

  it('does not invent groups the server did not send', () => {
    const grouped = groupTasks([task({ group: 'REVIEW' })]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].group).toBe('REVIEW');
  });

  it('re-opens a group only once even if its tasks are not adjacent', () => {
    const grouped = groupTasks([
      task({ id: 'a', group: 'BASICS' }),
      task({ id: 'b', group: 'REVIEW' }),
      task({ id: 'c', group: 'BASICS' }),
    ]);
    expect(grouped.map((g) => g.group)).toEqual(['BASICS', 'REVIEW']);
    expect(grouped[0].tasks.map((t) => t.id)).toEqual(['a', 'c']);
  });
});

describe('isTaskActionable', () => {
  it('is true only for AVAILABLE', () => {
    expect(isTaskActionable('AVAILABLE')).toBe(true);
    for (const s of ['COMPLETE', 'WAITING', 'BLOCKED']) {
      expect(isTaskActionable(s)).toBe(false);
    }
  });

  it('treats an unknown status from a newer server as NOT actionable', () => {
    // Guessing "openable" is the guess that breaks: it offers a row that
    // navigates to a screen the server will refuse.
    expect(isTaskActionable('SOMETHING_NEW')).toBe(false);
  });
});

describe('nextActionTaskId', () => {
  const tasks = [task({ id: 'BASICS_IDENTITY' }), task({ id: 'WORK_AREA' })];

  it('returns the named task', () => {
    expect(nextActionTaskId({ kind: 'COMPLETE_TASK', taskId: 'WORK_AREA' }, tasks)).toBe(
      'WORK_AREA',
    );
  });

  it('returns null for a task the hub is not showing', () => {
    // A CTA pointing at a task not in the list would navigate to an empty
    // screen, so it is dropped rather than trusted.
    expect(nextActionTaskId({ kind: 'COMPLETE_TASK', taskId: 'GHOST' }, tasks)).toBeNull();
  });

  it.each([{ kind: 'SUBMIT' }, { kind: 'AWAIT_REVIEW' }, { kind: 'NONE' }] as const)(
    'returns null for %o',
    (action) => {
      expect(nextActionTaskId(action, tasks)).toBeNull();
    },
  );

  it('returns null when there is no next action at all', () => {
    expect(nextActionTaskId(undefined, tasks)).toBeNull();
  });
});
