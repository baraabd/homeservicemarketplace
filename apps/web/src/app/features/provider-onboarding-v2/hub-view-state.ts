import type {
  ProviderOnboardingHubGroup,
  ProviderOnboardingHubNextAction,
  ProviderOnboardingHubTask,
  ProviderOnboardingHubView,
} from '@homeservicemarketplace/contracts';

// Sprint 9B.16 — which hub screen the provider sees, decided once, in one
// place. Pure, so every state can be asserted without React, a network or a
// browser.
//
// The precedence below IS the policy. Deriving it in the component would mean
// each branch re-deciding it, and two branches eventually disagree — which is
// how an approved provider gets shown a "finish your application" button.

export type HubViewState =
  /** No answer from the server yet. */
  | 'LOADING'
  /** 401 — the session is missing or expired. Signing in again is the fix. */
  | 'UNAUTHORIZED'
  /**
   * 403 — authenticated, but not allowed *yet*.
   *
   * Sprint 9B.29. Split out of `UNAUTHORIZED`, which used to absorb both.
   *
   * The dominant cause on this surface is a stale role claim: `/upgrade` writes
   * the provider role to the database, but `JwtStrategy.validate` reads roles
   * from the ACCESS TOKEN, so a token minted before the upgrade still says
   * "seeker" and `RolesGuard` answers 403. The session is perfectly valid.
   *
   * Telling that provider "your session has ended, please sign in again" is
   * wrong twice over: it misdescribes the fault, and the remedy it offers does
   * not address it. The recovery is to rotate the session — once — and retry.
   */
  | 'FORBIDDEN'
  /** Something failed that retrying might fix. */
  | 'ERROR'
  /** The server answered, and there is no application to show. */
  | 'EMPTY'
  /** Handed in and queued. Nothing for the provider to do. */
  | 'SUBMITTED'
  /** Sent back. The provider must act — so the task list stays on screen. */
  | 'ACTION_REQUIRED'
  /** Already approved. The hub is no longer the right screen. */
  | 'ALREADY_ACTIVE'
  /** The ordinary case: work to do. */
  | 'HUB';

export interface HubView {
  state: HubViewState;
  /** Whether the task list is part of this screen. Separate from `state`
   *  because ACTION_REQUIRED shows BOTH a banner and the tasks: the provider
   *  is being asked to fix something, and hiding what there is to fix would
   *  make the banner unactionable. */
  showsTasks: boolean;
}

export interface HubQueryLike {
  /** True once the query has settled at least once, success or error. Gating
   *  on "have we ever had an answer?" cannot re-open, so a later background
   *  refetch never tears the screen down — the same reasoning as the provider
   *  shell's `isFetched` gate. */
  isFetched: boolean;
  data: ProviderOnboardingHubView | undefined;
  errorStatus: number | null;
}

export function deriveHubView(query: HubQueryLike): HubView {
  if (!query.isFetched) return { state: 'LOADING', showsTasks: false };

  const status = query.errorStatus;
  // Two statuses, two answers. See the note on `FORBIDDEN`: collapsing these is
  // how a valid session gets reported as an expired one.
  if (status === 401) return { state: 'UNAUTHORIZED', showsTasks: false };
  if (status === 403) return { state: 'FORBIDDEN', showsTasks: false };
  // 404 is "provider role, but no application to show" — an answer, not a
  // fault, and telling the provider something went wrong would be untrue.
  if (status === 404) return { state: 'EMPTY', showsTasks: false };
  if (status !== null) return { state: 'ERROR', showsTasks: false };

  const data = query.data;
  if (!data) return { state: 'ERROR', showsTasks: false };

  // Application state outranks task state. An approved provider whose tasks
  // happen to read AVAILABLE is not being invited to reapply.
  if (data.status === 'ACTIVE') return { state: 'ALREADY_ACTIVE', showsTasks: false };
  if (data.status === 'SUBMITTED') return { state: 'SUBMITTED', showsTasks: false };

  if (data.tasks.length === 0) return { state: 'EMPTY', showsTasks: false };

  if (data.status === 'ACTION_REQUIRED') return { state: 'ACTION_REQUIRED', showsTasks: true };
  return { state: 'HUB', showsTasks: true };
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export interface HubTaskGroup {
  group: ProviderOnboardingHubGroup;
  tasks: ProviderOnboardingHubTask[];
}

/**
 * Group the tasks for rendering, in FIRST-APPEARANCE order.
 *
 * The group set is not hardcoded. The server decides which groups exist and
 * what order they come in; adding, renaming or splitting one is a server
 * change alone, and a group the client has never heard of still renders in the
 * right place rather than vanishing.
 */
export function groupTasks(tasks: readonly ProviderOnboardingHubTask[]): HubTaskGroup[] {
  const order: ProviderOnboardingHubGroup[] = [];
  const byGroup = new Map<ProviderOnboardingHubGroup, ProviderOnboardingHubTask[]>();

  for (const task of tasks) {
    let bucket = byGroup.get(task.group);
    if (!bucket) {
      bucket = [];
      byGroup.set(task.group, bucket);
      order.push(task.group);
    }
    bucket.push(task);
  }

  return order.map((group) => ({ group, tasks: byGroup.get(group) ?? [] }));
}

/**
 * Whether a row is a button.
 *
 * ONLY `AVAILABLE`. A task that is complete, waiting or blocked is not
 * something the provider can open, and rendering it as a button that does
 * nothing — or worse, one that navigates to a screen refusing to save — is the
 * failure this whole read-model exists to prevent.
 *
 * Unknown values are NOT actionable. A status this client has never heard of
 * is one a newer server added; treating it as openable would guess in the
 * direction that breaks, so it degrades to a plain, explained row.
 */
export function isTaskActionable(status: string): boolean {
  return status === 'AVAILABLE';
}

/** The task the primary CTA opens, or null when the CTA is not "open a task".
 *
 *  Returns null for a `taskId` that is not in the list, rather than trusting
 *  it: a CTA pointing at a task the hub is not showing would navigate to a
 *  screen with nothing on it. */
export function nextActionTaskId(
  nextAction: ProviderOnboardingHubNextAction | undefined,
  tasks: readonly ProviderOnboardingHubTask[],
): string | null {
  if (!nextAction || nextAction.kind !== 'COMPLETE_TASK') return null;
  const target = nextAction.taskId;
  return tasks.some((t) => t.id === target) ? target : null;
}
