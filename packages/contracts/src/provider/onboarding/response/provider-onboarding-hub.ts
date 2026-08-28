// Sprint 9B.15/9B.16 — the onboarding HUB read-model.
//
// The wizard (Sprint 8) asked the provider to walk nine steps in a fixed
// order. The hub replaces that with six TASKS the provider may pick from,
// grouped, each carrying its own status. The difference that matters is not
// cosmetic: a wizard step is a position in a sequence, a hub task is a piece
// of work with a state of its own, and only the second can express "you can
// do this now", "this is waiting on something else" and "this is blocked"
// as distinct answers.
//
// Everything the client renders about READINESS is decided here, server-side:
// which tasks exist, which group each belongs to, what state each is in, how
// many are done, and what to do next. The client contributes layout and
// translation and nothing else. A client that computed its own progress would
// be free to disagree with the server about whether an application can be
// submitted — which is the same class of defect ADR 0008 introduced the
// completeness policy to prevent, one screen further out.

/** Which section of the hub a task is filed under.
 *
 *  The client renders one heading per group IN THE ORDER THE TASKS ARRIVE and
 *  does not hardcode the set, so adding or splitting a group is a server
 *  change alone. */
export const PROVIDER_ONBOARDING_HUB_GROUPS = [
  /** Who the provider is. */
  'BASICS',
  /** What they do and how long they have done it. */
  'SERVICES',
  /** Where and when they work. */
  'COVERAGE',
  /** How they present themselves. */
  'PROFILE',
  /** Read back, consent, hand in. */
  'REVIEW',
] as const;

export type ProviderOnboardingHubGroup = (typeof PROVIDER_ONBOARDING_HUB_GROUPS)[number];

/**
 * What the provider may do with a task RIGHT NOW.
 *
 * `WAITING` and `BLOCKED` are deliberately separate. Waiting means the task is
 * with someone else (a review, a scan) and the provider has nothing to do;
 * blocked means the task needs work the provider has not done yet, elsewhere.
 * Collapsing them produces a row that says "you cannot do this" without
 * saying which of the two very different things the provider should do about
 * it.
 */
export const PROVIDER_ONBOARDING_HUB_TASK_STATUSES = [
  /** Done. Counts toward `progress.complete`. */
  'COMPLETE',
  /** Open for editing now. The ONLY status that renders as a button. */
  'AVAILABLE',
  /** With the platform, not the provider. Not actionable. */
  'WAITING',
  /** Needs something else finished first. Not actionable. */
  'BLOCKED',
] as const;

export type ProviderOnboardingHubTaskStatus =
  (typeof PROVIDER_ONBOARDING_HUB_TASK_STATUSES)[number];

export interface ProviderOnboardingHubTask {
  /** Stable code. The client keys its own translations off this, so the wire
   *  format survives translation and an Arabic and an English client are
   *  talking about the same task. */
  id: string;
  group: ProviderOnboardingHubGroup;
  status: ProviderOnboardingHubTaskStatus;
  /**
   * Server-rendered display text.
   *
   * The client prefers its OWN bundle keyed by `id` and falls back to these,
   * because a single-language response cannot serve a bilingual UI: an English
   * reader given the Arabic `title` sees Arabic. Keeping them means a task the
   * client has no copy for still renders something a human can read rather
   * than a bare code.
   */
  title: string;
  description: string;
}

/** Count, not percentage.
 *
 *  The hub says "3 of 6 complete" because six discrete tasks are countable and
 *  a provider can act on "three left". A percentage of nine weighted steps was
 *  a number nobody could do anything with. `total` is authoritative: the
 *  client renders it rather than measuring `tasks.length`, so a server that
 *  excludes an optional task from the count stays consistent with itself. */
export interface ProviderOnboardingHubProgress {
  complete: number;
  total: number;
}

/**
 * What the hub's primary button does.
 *
 * Decided server-side for the same reason the wizard's was: the answer is not
 * always "open a task". Once an application is handed in it becomes "wait",
 * and a client that guessed would invite a provider to reopen a queued
 * application to change nothing.
 */
export type ProviderOnboardingHubNextAction =
  /** Open `taskId`. */
  | { kind: 'COMPLETE_TASK'; taskId: string }
  /** Every task is done; handing in is the next move. */
  | { kind: 'SUBMIT' }
  /** Handed in and queued. Nothing for the provider to do. */
  | { kind: 'AWAIT_REVIEW' }
  /** Nothing to do, and nothing to wait for. */
  | { kind: 'NONE' };

/** Where the APPLICATION is. Distinct from any task's status, and from the
 *  provider's capability to work — see ADR 0005. */
export const PROVIDER_ONBOARDING_HUB_STATUSES = [
  /** Being filled in. */
  'DRAFT',
  /** Handed in and queued. */
  'SUBMITTED',
  /** Sent back: the provider must do something before it moves again. */
  'ACTION_REQUIRED',
  /** Already approved. The hub is no longer the right screen. */
  'ACTIVE',
] as const;

export type ProviderOnboardingHubStatus = (typeof PROVIDER_ONBOARDING_HUB_STATUSES)[number];

export interface ProviderOnboardingHubView {
  tasks: ProviderOnboardingHubTask[];
  progress: ProviderOnboardingHubProgress;
  nextAction: ProviderOnboardingHubNextAction;
  status: ProviderOnboardingHubStatus;
}
