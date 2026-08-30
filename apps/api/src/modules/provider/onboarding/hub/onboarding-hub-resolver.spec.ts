import type { ProviderOnboardingIssue } from '@homeservicemarketplace/contracts';
import {
  PROVIDER_ONBOARDING_HUB_GROUPS,
  PROVIDER_ONBOARDING_HUB_TASK_STATUSES,
} from '@homeservicemarketplace/contracts';

import { HUB_TASKS, buildHub, hubStatusOf, type HubSource } from './onboarding-hub-resolver';

// Sprint 9B.15 (delivered in 9B.27) — the hub read-model, without a database.

function source(over: Partial<HubSource> = {}): HubSource {
  return { issues: [], lifecycleState: 'DRAFT', ...over };
}

const task = (v: ReturnType<typeof buildHub>, id: string) => v.tasks.find((t) => t.id === id)!;

describe('the hub shape the contract promises', () => {
  it('serves exactly six tasks', () => {
    expect(buildHub(source()).tasks).toHaveLength(6);
  });

  it('does NOT include the hub itself as a task', () => {
    const ids = buildHub(source()).tasks.map((t) => t.id);
    expect(ids).not.toContain('HUB');
    expect(ids).toEqual([
      'BASICS_IDENTITY',
      'SERVICES_EXPERIENCE',
      'WORK_AREA',
      'WORKING_HOURS',
      'PORTFOLIO',
      'REVIEW_SUBMISSION',
    ]);
  });

  it('uses only groups and statuses the contract declares', () => {
    const v = buildHub(source({ issues: [{ field: 'bio', code: 'REQUIRED' }] }));
    for (const t of v.tasks) {
      expect(PROVIDER_ONBOARDING_HUB_GROUPS).toContain(t.group);
      expect(PROVIDER_ONBOARDING_HUB_TASK_STATUSES).toContain(t.status);
    }
  });

  it('reports total from the task list, authoritatively', () => {
    expect(buildHub(source()).progress.total).toBe(HUB_TASKS.length);
  });

  it('gives every task readable fallback text', () => {
    for (const t of buildHub(source()).tasks) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.id).not.toBe(t.title);
    }
  });
});

describe('completeness comes from the policy, not from a second rule', () => {
  it('marks a task AVAILABLE when it owns an unmet requirement', () => {
    // `bio` belongs to the PROFILE step, which maps to the PORTFOLIO task.
    const v = buildHub(source({ issues: [{ field: 'bio', code: 'REQUIRED' }] }));
    expect(task(v, 'PORTFOLIO').status).toBe('AVAILABLE');
  });

  it('marks every OTHER task COMPLETE when only one has an issue', () => {
    const v = buildHub(source({ issues: [{ field: 'bio', code: 'REQUIRED' }] }));
    expect(task(v, 'BASICS_IDENTITY').status).toBe('COMPLETE');
    expect(task(v, 'WORK_AREA').status).toBe('COMPLETE');
    expect(v.progress.complete).toBe(4);
  });

  it('routes each field to the task that owns it', () => {
    const cases: Array<[ProviderOnboardingIssue['field'], string]> = [
      ['providerType', 'BASICS_IDENTITY'],
      ['displayName', 'BASICS_IDENTITY'],
      ['serviceAreaCity', 'WORK_AREA'],
      ['availability', 'WORKING_HOURS'],
      ['yearsOfExperience', 'SERVICES_EXPERIENCE'],
      ['bio', 'PORTFOLIO'],
    ];
    for (const [field, id] of cases) {
      const v = buildHub(source({ issues: [{ field, code: 'REQUIRED' }] }));
      expect([field, task(v, id).status]).toEqual([field, 'AVAILABLE']);
    }
  });

  it('an OPTIONAL extra does not reduce completion, because it is not an issue', () => {
    // Nothing requires a portfolio image, so a provider with none still has a
    // complete PORTFOLIO task. Completion follows the policy; it does not count
    // things the policy never asked for.
    const v = buildHub(source({ issues: [] }));
    expect(task(v, 'PORTFOLIO').status).toBe('COMPLETE');
    // FIVE of six, and that is right: the five collecting tasks are done and
    // REVIEW_SUBMISSION is the one still to do. "5 of 6 — submit it" is a
    // more useful sentence than a 6/6 the provider has not earned yet.
    expect(v.progress.complete).toBe(5);
  });

  it('attaches a field no step owns to the review task without barring the door', () => {
    // Cast on purpose: the union says this field cannot exist, and the point
    // of the test is that the resolver still behaves if a future policy rule
    // adds one before a screen owns it.
    const orphan = {
      field: 'somethingNobodyOwns',
      code: 'REQUIRED',
    } as unknown as ProviderOnboardingIssue;
    const v = buildHub(source({ issues: [orphan] }));
    // AVAILABLE, not BLOCKED. A requirement owned by REVIEW is shown ON the
    // review screen — which disables Submit and prints the server's own
    // blockedReason — rather than locking the task. Blocking it deadlocked
    // consent, whose whole point is that it is accepted on that screen: see
    // taskStatusOf, and the browser journey that caught it.
    expect(task(v, 'REVIEW_SUBMISSION').status).toBe('AVAILABLE');
    // The other five are untouched by a blocker none of them owns.
    expect(v.progress.complete).toBe(5);
  });
});

describe('review is blocked until the collecting tasks are done', () => {
  it('BLOCKED while anything is outstanding', () => {
    const v = buildHub(source({ issues: [{ field: 'bio', code: 'REQUIRED' }] }));
    expect(task(v, 'REVIEW_SUBMISSION').status).toBe('BLOCKED');
  });

  it('AVAILABLE once nothing is outstanding', () => {
    const v = buildHub(source());
    expect(task(v, 'REVIEW_SUBMISSION').status).toBe('AVAILABLE');
  });

  it('BLOCKED is not WAITING — the difference is who must act', () => {
    // BLOCKED says "finish your own work"; WAITING says "it is with us".
    const blocked = buildHub(source({ issues: [{ field: 'bio', code: 'REQUIRED' }] }));
    expect(task(blocked, 'REVIEW_SUBMISSION').status).toBe('BLOCKED');
    const waiting = buildHub(source({ lifecycleState: 'SUBMITTED' }));
    expect(task(waiting, 'REVIEW_SUBMISSION').status).toBe('WAITING');
  });
});

describe('a handed-in application is not editable', () => {
  it.each(['SUBMITTED', 'DOCUMENTS_REQUIRED'])('%s makes every task WAITING', (state) => {
    const v = buildHub(source({ lifecycleState: state }));
    for (const t of v.tasks) expect(t.status).toBe('WAITING');
  });

  it('offers no COMPLETE_TASK action once submitted', () => {
    expect(buildHub(source({ lifecycleState: 'SUBMITTED' })).nextAction).toEqual({
      kind: 'AWAIT_REVIEW',
    });
  });

  it('RETURNED puts the work back in the provider hands', () => {
    const v = buildHub(
      source({ lifecycleState: 'RETURNED', issues: [{ field: 'bio', code: 'REQUIRED' }] }),
    );
    expect(v.status).toBe('ACTION_REQUIRED');
    expect(task(v, 'PORTFOLIO').status).toBe('AVAILABLE');
  });
});

describe('nextAction', () => {
  it('points at the FIRST incomplete task, in hub order', () => {
    const v = buildHub(
      source({
        issues: [
          { field: 'bio', code: 'REQUIRED' },
          { field: 'displayName', code: 'REQUIRED' },
        ],
      }),
    );
    // BASICS_IDENTITY comes before PORTFOLIO in hub order.
    expect(v.nextAction).toEqual({ kind: 'COMPLETE_TASK', taskId: 'BASICS_IDENTITY' });
  });

  it('becomes SUBMIT when every collecting task is done', () => {
    expect(buildHub(source()).nextAction).toEqual({ kind: 'SUBMIT' });
  });

  it('is NONE for an already-approved provider', () => {
    const v = buildHub(source({ lifecycleState: 'ACCEPTED' }));
    expect(v.status).toBe('ACTIVE');
    expect(v.nextAction).toEqual({ kind: 'NONE' });
  });
});

describe('the application axis is not the task axis', () => {
  it.each([
    ['NOT_STARTED', 'DRAFT'],
    ['DRAFT', 'DRAFT'],
    ['SUBMITTED', 'SUBMITTED'],
    ['DOCUMENTS_REQUIRED', 'SUBMITTED'],
    ['RETURNED', 'ACTION_REQUIRED'],
    ['ACCEPTED', 'ACTIVE'],
  ])('lifecycle %s -> hub %s', (lifecycle, expected) => {
    expect(hubStatusOf(lifecycle)).toBe(expected);
  });

  it('never reports a capability — the hub says nothing about work access', () => {
    const raw = JSON.stringify(buildHub(source({ lifecycleState: 'ACCEPTED' })));
    expect(raw).not.toMatch(/capabilit/i);
    expect(raw).not.toMatch(/grant/i);
    expect(raw).not.toMatch(/verified/i);
  });
});
