// Sprint 12D — presentation grouping for the Admin dispute workspace.
//
// WHY THESE IDS LIVE IN THE WEB APP, NOT IN `contracts`
//
// A tab is a way of showing a case, not a fact about one. The server owns the
// state machine, the available actions, the deadlines and the permissions; it
// has no opinion about how many panels a reviewer sees. Publishing these ids as
// a shared contract would invite exactly the mistake this sprint is trying to
// avoid — a second client-side authority that drifts from the server's.
//
// They are therefore local, presentation-only, and deliberately unrelated to
// `DisputeWorkspaceView.state` or `availableActions`.
//
// LEGACY ANCHORS STILL WORK
//
// The previous layout linked to `#case-information`, `#case-evidence`,
// `#case-solutions` and `#case-history`. Those anchors are kept as the section
// element ids, so an old bookmark or a link in a notification selects and
// focuses the matching panel instead of landing on a page that no longer
// scrolls. `overview` and `appeals` are new panels split out of the old single
// column; nothing that used to be reachable stopped being reachable.

export const DISPUTE_WORKSPACE_TASK_IDS = [
  'overview',
  'information',
  'evidence',
  'solutions',
  'appeals',
  'history',
] as const;

export type DisputeWorkspaceTaskId = (typeof DISPUTE_WORKSPACE_TASK_IDS)[number];

export const DISPUTE_TAB_QUERY = 'caseTab';
export const DISPUTE_SECTION_PREFIX = 'case-';
const HASH_PREFIX = `#${DISPUTE_SECTION_PREFIX}`;

/** URL values select presentation only; they never determine case eligibility. */
export function parseDisputeTask(value: string | null | undefined): DisputeWorkspaceTaskId | null {
  return DISPUTE_WORKSPACE_TASK_IDS.find((task) => task === value) ?? null;
}

export function disputeTaskFromHash(hash: string): DisputeWorkspaceTaskId | null {
  return hash.startsWith(HASH_PREFIX) ? parseDisputeTask(hash.slice(HASH_PREFIX.length)) : null;
}

/**
 * A legacy hash wins over the query parameter: it is the more specific, more
 * recent intent (somebody just followed a link to a named section).
 */
export function selectedDisputeTask(search: string, hash: string): DisputeWorkspaceTaskId {
  return (
    disputeTaskFromHash(hash) ??
    parseDisputeTask(new URLSearchParams(search).get(DISPUTE_TAB_QUERY)) ??
    DISPUTE_WORKSPACE_TASK_IDS[0]
  );
}

/**
 * Preserve every unrelated parameter. The Admin inbox puts its filters and
 * cursor in the query string, and a reviewer who walks through six tabs must
 * still return to the page of the queue they came from.
 */
export function disputeTaskSearch(search: string, task: DisputeWorkspaceTaskId): string {
  const params = new URLSearchParams(search);
  params.set(DISPUTE_TAB_QUERY, task);
  return `?${params.toString()}`;
}

export function disputeSectionId(task: DisputeWorkspaceTaskId): string {
  return `${DISPUTE_SECTION_PREFIX}${task}`;
}
