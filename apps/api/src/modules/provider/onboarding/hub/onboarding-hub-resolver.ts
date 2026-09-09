import type {
  ProviderOnboardingHubGroup,
  ProviderOnboardingHubTask,
  ProviderOnboardingHubTaskStatus,
  ProviderOnboardingHubView,
  ProviderOnboardingIssue,
} from '@homeservicemarketplace/contracts';
import { STEP_TO_V2_TASK } from '@homeservicemarketplace/contracts';

import { stepForField } from '../onboarding-steps';
import { isProviderActionIssue } from '../provider-onboarding.policy';

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
  // Sprint 9B.28 — and which of those are waiting on US rather than on THEM.
  //
  // `evaluateOnboarding` already distinguishes these: a specialty that has been
  // chosen and is sitting in the admin approval queue is raised as
  // `AWAITING_REVIEW`, not `REQUIRED`. The hub threw that distinction away and
  // labelled both "Required", so a provider who had done everything asked of
  // them was told they had not — and had no action available that could
  // possibly clear it, because the outstanding move was an administrator's.
  const awaitingReviewTasks = new Set<string>();
  const providerActionTasks = new Set<string>();
  for (const issue of source.issues) {
    const step = stepForField(issue.field);
    const task = STEP_TO_V2_TASK[step ?? 'REVIEW'];
    blockedTasks.add(task);
    // Sprint 09B.29 — ownership comes from the canonical map, not from an
    // inline code comparison. This file used to test `code === 'AWAITING_REVIEW'`
    // itself, which meant a second place to update when the classification
    // changes, and a second place to forget.
    if (isProviderActionIssue(issue)) providerActionTasks.add(task);
    else awaitingReviewTasks.add(task);
  }

  // Sprint 09B.29 — PROVIDER-action tasks, not every blocked task.
  //
  // This single word is the deadlock. `blockedTasks` includes tasks whose only
  // outstanding item is an administrator's approval, so a provider who had
  // completed every field they control still saw REVIEW_SUBMISSION BLOCKED and
  // could never hand the application in — which is what would have prompted the
  // approval. The task itself stays WAITING below, so the moderation axis is
  // still visible; what changes is that it no longer bars the door.
  //
  // This opens the REVIEW SCREEN. It is not a submission verdict: the review
  // read-model's `canSubmit` folds in the accepted terms version as well, and
  // the submit command enforces lifecycle, draft version and authorization on
  // top of that. "You may go and look" is all this decides.
  const collectingComplete = COLLECTING_TASKS.every((t) => !providerActionTasks.has(t.id));

  const tasks: ProviderOnboardingHubTask[] = HUB_TASKS.map((t) => {
    const text = FALLBACK_TEXT[t.id] ?? { title: t.id, description: '' };
    return {
      id: t.id,
      group: t.group,
      status: taskStatusOf(t.id, {
        blockedTasks,
        awaitingReviewTasks,
        providerActionTasks,
        collectingComplete,
        editable,
      }),
      title: text.title,
      description: text.description,
    };
  });

  // COUNT, not percentage, and `total` is authoritative — the client renders
  // this rather than measuring `tasks.length`.
  //
  // Sprint 09B.29 — WAITING counts. The count answers "how much of YOUR part is
  // done", and a task whose only outstanding item is our approval is done as
  // far as the provider is concerned. The approved prototype's completed hub
  // (screen 10) says "6 of 6 tasks complete" while two of those six are drawn
  // in the waiting state, which is exactly this rule. The moderation axis stays
  // visible in the task's own status; it is not folded into the number.
  const complete = tasks.filter((t) => t.status === 'COMPLETE' || t.status === 'WAITING').length;

  return {
    tasks,
    progress: { complete, total: HUB_TASKS.length },
    // Also provider-action only: an `AWAITING_REVIEW` issue that maps to REVIEW
    // is not work the provider can do on the review screen, so it must not turn
    // `SUBMIT` into `COMPLETE_TASK` and send them somewhere with nothing to do.
    nextAction: nextActionOf(tasks, status, providerActionTasks.has('REVIEW_SUBMISSION')),
    status,
  };
}

interface TaskStatusInput {
  blockedTasks: Set<string>;
  /** Tasks whose ONLY outstanding issues are with an administrator. */
  awaitingReviewTasks: Set<string>;
  /** Tasks with at least one issue the provider can actually act on. */
  providerActionTasks: Set<string>;
  collectingComplete: boolean;
  editable: boolean;
}

function taskStatusOf(id: string, input: TaskStatusInput): ProviderOnboardingHubTaskStatus {
  const { blockedTasks, awaitingReviewTasks, providerActionTasks, collectingComplete, editable } =
    input;
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

  if (!blockedTasks.has(id)) return 'COMPLETE';

  // Sprint 9B.28 — WAITING when the only thing left is ours to do.
  //
  // `AVAILABLE` renders as "Required" and invites the provider into a screen
  // where every field they are allowed to touch is already filled in. The
  // honest status for "you have chosen a specialty and we have not approved it
  // yet" is the same one a submitted application gets: it is with us.
  //
  // Sprint 09B.29 — the note that used to sit here said this task staying in
  // `blockedTasks` kept REVIEW_SUBMISSION shut, and called that correct because
  // "the application genuinely is not submittable yet". That was the deadlock.
  // A provider who has done everything they control must be able to submit; the
  // approval is our move and it is tracked on its own axis. `collectingComplete`
  // now reads `providerActionTasks`, so this task reports WAITING — visible,
  // honest — without barring the review screen.
  if (awaitingReviewTasks.has(id) && !providerActionTasks.has(id)) return 'WAITING';

  return 'AVAILABLE';
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
