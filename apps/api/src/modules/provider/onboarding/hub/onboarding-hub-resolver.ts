import type {
  ProviderOnboardingHubGroup,
  ProviderOnboardingHubTask,
  ProviderOnboardingHubTaskStatus,
  ProviderOnboardingHubView,
  ProviderOnboardingIssue,
} from '@homeservicemarketplace/contracts';
import { STEP_TO_V2_TASK } from '@homeservicemarketplace/contracts';

import { stepForField } from '../onboarding-steps';

// Sprint 9B.15 (delivered late, in 9B.27) — the onboarding HUB read-model.
//
// docs/sprint-09b16/ONBOARDING_V2_HUB.md
//
// WHAT THIS CLOSES
//
// The V2 client has called `GET /v1/me/provider/onboarding/hub` since 9B.16 and
// nothing served it. Six sprints of task screens were built on a read-model
// that existed only as a TypeScript type and a Playwright stub, so every V2
// browser test proved the UI against a fixture and none of it had ever spoken
// to this API. That is the single reason V2 could not be called
// runtime-verified.
//
// IT RESTATES NO RULE.
//
// Task completeness is `evaluateOnboarding()`'s answer, routed through
// `stepForField()` and the SAME `STEP_TO_V2_TASK` map the review screen uses.
// The hub cannot disagree with the review screen about whether an application
// is ready, because both read one policy. A second definition of "complete"
// here is precisely the defect ADR 0008 introduced the completeness policy to
// prevent, one screen further out.

/** The six tasks, in hub order. The hub itself is NOT one of them. */
export const HUB_TASKS: ReadonlyArray<{ id: string; group: ProviderOnboardingHubGroup }> =
  Object.freeze([
    { id: 'BASICS_IDENTITY', group: 'BASICS' },
    { id: 'SERVICES_EXPERIENCE', group: 'SERVICES' },
    { id: 'WORK_AREA', group: 'COVERAGE' },
    { id: 'WORKING_HOURS', group: 'COVERAGE' },
    { id: 'PORTFOLIO', group: 'PROFILE' },
    { id: 'REVIEW_SUBMISSION', group: 'REVIEW' },
  ]);

/** The five tasks that collect something. REVIEW_SUBMISSION reads them back and
 *  owns no requirement of its own, exactly as the wizard's REVIEW step does. */
const COLLECTING_TASKS = HUB_TASKS.filter((t) => t.id !== 'REVIEW_SUBMISSION');

/**
 * Fallback display text.
 *
 * The client prefers its own bundle keyed by task id — a single-language
 * response cannot serve a bilingual UI. These exist so a task the client has no
 * copy for still renders something a human can read rather than a bare code.
 */
const FALLBACK_TEXT: Readonly<Record<string, { title: string; description: string }>> =
  Object.freeze({
    BASICS_IDENTITY: { title: 'Your details', description: 'Name, photo and contact' },
    SERVICES_EXPERIENCE: { title: 'Your services', description: 'What you do and for how long' },
    WORK_AREA: { title: 'Where you work', description: 'Your base and how far you travel' },
    WORKING_HOURS: { title: 'Working hours', description: 'When you are available' },
    PORTFOLIO: { title: 'Public profile', description: 'How customers see you' },
    REVIEW_SUBMISSION: { title: 'Review and submit', description: 'Check everything, then send' },
  });

export interface HubSource {
  /** Straight from `evaluateOnboarding(candidate)` — the one policy. */
  issues: readonly ProviderOnboardingIssue[];
  /** The Sprint 7 lifecycle axis. */
  lifecycleState: string;
}

/**
 * Map the lifecycle axis onto the four states the hub can be in.
 *
 * Deliberately NOT the same vocabulary: the lifecycle has six values and the
 * hub has four, because DOCUMENTS_REQUIRED and SUBMITTED mean the same thing to
 * someone looking at a task list — it is with us — while RETURNED is the one
 * that puts work back in their hands.
 */
export function hubStatusOf(lifecycleState: string): ProviderOnboardingHubView['status'] {
  switch (lifecycleState) {
    case 'ACCEPTED':
      return 'ACTIVE';
    case 'RETURNED':
      return 'ACTION_REQUIRED';
    case 'SUBMITTED':
    case 'DOCUMENTS_REQUIRED':
      return 'SUBMITTED';
    default:
      return 'DRAFT';
  }
}

/**
 * Build the hub.
 *
 * Ordering of the status decision is the policy:
 *
 *   1. an application that is with US makes every task WAITING — offering an
 *      edit button on a queued application invites a provider to change
 *      something a reviewer is already reading;
 *   2. a task with no unmet requirement is COMPLETE;
 *   3. REVIEW_SUBMISSION is BLOCKED until the other five are complete, because
 *      reading back an unfinished application is not a task anyone can do;
 *   4. everything else is AVAILABLE.
 */
export function buildHub(source: HubSource): ProviderOnboardingHubView {
  const status = hubStatusOf(source.lifecycleState);
  const editable = status === 'DRAFT' || status === 'ACTION_REQUIRED';

  // Which tasks own an unmet requirement. Routed through the same two
  // functions the review screen uses, so the two surfaces cannot disagree.
  const blockedTasks = new Set<string>();
  for (const issue of source.issues) {
    const step = stepForField(issue.field);
    blockedTasks.add(STEP_TO_V2_TASK[step ?? 'REVIEW']);
  }

  const collectingComplete = COLLECTING_TASKS.every((t) => !blockedTasks.has(t.id));

  const tasks: ProviderOnboardingHubTask[] = HUB_TASKS.map((t) => {
    const text = FALLBACK_TEXT[t.id] ?? { title: t.id, description: '' };
    return {
      id: t.id,
      group: t.group,
      status: taskStatusOf(t.id, blockedTasks, collectingComplete, editable),
      title: text.title,
      description: text.description,
    };
  });

  // COUNT, not percentage, and `total` is authoritative — the client renders
  // this rather than measuring `tasks.length`.
  const complete = tasks.filter((t) => t.status === 'COMPLETE').length;

  return {
    tasks,
    progress: { complete, total: HUB_TASKS.length },
    nextAction: nextActionOf(tasks, status, blockedTasks.has('REVIEW_SUBMISSION')),
    status,
  };
}

function taskStatusOf(
  id: string,
  blockedTasks: Set<string>,
  collectingComplete: boolean,
  editable: boolean,
): ProviderOnboardingHubTaskStatus {
  // With the platform, not the provider. Applies to every task at once,
  // including ones that are individually complete — the application as a whole
  // is not theirs to edit right now.
  if (!editable) return 'WAITING';

  if (id === 'REVIEW_SUBMISSION') {
    // Reading back an unfinished application is not something a provider can
    // usefully do, so it is BLOCKED rather than AVAILABLE — and BLOCKED rather
    // than WAITING, because the thing standing in the way is their own work.
    //
    // ONLY the other five decide this. An earlier version also blocked on
    // REVIEW's own outstanding requirements, reasoning that offering Submit on
    // an application the server would refuse is a button that lies. It is —
    // but this is the wrong lever, and using it produced a deadlock the browser
    // journey caught: `CONSENT` maps to REVIEW_SUBMISSION, terms are accepted
    // ON the review screen, so an unaccepted term locked the only screen where
    // it could be accepted. The provider saw five green tasks and "Finish the
    // tasks above first", with nothing above left to finish.
    //
    // The lying button is prevented where it actually lives: the review screen
    // disables Submit and renders the server's own `blockedReason`. A blocker
    // owned by REVIEW is a thing to SHOW on that screen, not a reason to bar
    // the door to it.
    return collectingComplete ? 'AVAILABLE' : 'BLOCKED';
  }

  return blockedTasks.has(id) ? 'AVAILABLE' : 'COMPLETE';
}

function nextActionOf(
  tasks: readonly ProviderOnboardingHubTask[],
  status: ProviderOnboardingHubView['status'],
  reviewHasOutstandingWork: boolean,
): ProviderOnboardingHubView['nextAction'] {
  // Once it is handed in, "what next" stops being a task and becomes waiting —
  // whatever the task list says.
  if (status === 'SUBMITTED') return { kind: 'AWAIT_REVIEW' };
  if (status === 'ACTIVE') return { kind: 'NONE' };

  const first = tasks.find((t) => t.status === 'AVAILABLE' && t.id !== 'REVIEW_SUBMISSION');
  if (first) return { kind: 'COMPLETE_TASK', taskId: first.id };

  const review = tasks.find((t) => t.id === 'REVIEW_SUBMISSION');
  if (review?.status === 'AVAILABLE') {
    // The review task is enterable but still owns something unmet — unaccepted
    // terms, in every case that exists today. Saying SUBMIT here would put the
    // lying button on the hub instead of the review screen: the provider
    // presses it, lands on a disabled Submit, and has to work out for
    // themselves what changed. COMPLETE_TASK routes to the same screen and
    // describes it accurately.
    return reviewHasOutstandingWork
      ? { kind: 'COMPLETE_TASK', taskId: 'REVIEW_SUBMISSION' }
      : { kind: 'SUBMIT' };
  }

  return { kind: 'NONE' };
}
