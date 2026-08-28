// Sprint 9B.18 — what has actually happened to a specialty a provider chose.
//
// THE CONFUSION THIS EXISTS TO REMOVE
//
// Until now the wizard exposed two flat id lists — `specialtyLeafIds` (things
// approved) and `pendingSpecialtyIds` (things waiting) — and the UI rendered a
// chip per id with a "pending" badge on some of them. Three separate facts got
// collapsed into one visual:
//
//   1. did the provider CHOOSE this?           a selection
//   2. has an admin DECIDED on it?             a review outcome
//   3. can this category still be worked at?   a catalogue fact
//
// A provider whose application was rejected, and one whose category was retired
// by an admin last month, both saw the same greyed chip. Neither was told which
// had happened, and the second had done nothing wrong at all.
//
// Worse, a PENDING application rendered next to validation errors reads as a
// validation error — as though the provider had entered something wrong, when
// what is actually happening is that somebody else has not looked yet. That
// misreading is the one this read-model is here to make impossible.

export const PROVIDER_SPECIALTY_STATES = [
  /**
   * An admin approved it. This is the only state that grants anything: it
   * mirrors a real row in the grant table, and it is what submission counts.
   */
  'APPROVED',
  /**
   * Applied for, nobody has decided yet.
   *
   * NOT a failure and never rendered as one. There is nothing for the provider
   * to fix and nothing for them to do, and the only honest thing to say is that
   * it is with us.
   */
  'PENDING',
  /**
   * An admin said no.
   *
   * Distinct from PENDING because the provider CAN act on it — pick something
   * else, or ask why — and distinct from INACTIVE because a person made this
   * decision about them, which is worth saying plainly rather than dressing up
   * as a catalogue accident.
   */
  'REJECTED',
  /**
   * The category itself is gone: deactivated or soft-deleted in the catalogue.
   *
   * The provider did nothing wrong, and a UI that shows this as a rejection
   * blames them for an admin's housekeeping. It is separate so the copy can
   * say so.
   */
  'INACTIVE',
] as const;

export type ProviderSpecialtyState = (typeof PROVIDER_SPECIALTY_STATES)[number];

/** Whether a state means the provider may be matched for work in it. Only one
 *  does, and it is not the one that looks busiest. */
export function grantsWork(state: ProviderSpecialtyState): boolean {
  return state === 'APPROVED';
}

/** Whether the provider can do anything about this state right now. PENDING is
 *  deliberately false: offering an action for "we have not looked yet" invites
 *  someone to re-apply for something they already applied for. */
export function isActionable(state: ProviderSpecialtyState): boolean {
  return state === 'REJECTED' || state === 'INACTIVE';
}

export interface ProviderSpecialtyView {
  categoryId: string;
  state: ProviderSpecialtyState;
  /**
   * The catalogue labels, served with the state so the client never has to
   * join against a catalogue that — for INACTIVE rows — no longer lists this
   * category at all. Without them a retired specialty renders as a bare cuid.
   */
  labelEn: string;
  labelAr: string;
  /** The parent group, for grouping in the picker. Null for a root. */
  parentId: string | null;
  /** Set only for REJECTED, and only when a reason was recorded. */
  decidedAt: string | null;
}
