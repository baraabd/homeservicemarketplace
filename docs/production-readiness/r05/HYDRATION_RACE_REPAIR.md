# R05 baseline recovery — profile editor hydration race

Status: **IMPLEMENTED, PENDING REVIEW (draft PR).** A prerequisite to R10; not
part of R10.

Baseline: `origin/develop` @ `909336e05f6010f042c8fa79c0aee82e53153eee`, whose
post-merge CI run `37017681456` failed in "Accept R05 seeker profile, address
and catalog durability".

## What failed

`r05-seeker-durability.real-api.spec.ts` types a name, phone, city and bio into
the seeker profile editor, saves, reloads, and expects the new name. Now and
then the reload showed the original name.

## Demonstrated root cause

`EditProfilePage` re-seeded its whole form from the server whenever the
profile's `updatedAt` changed. `updatedAt` also changes without a save from
this form (registration and email verification both touch the row), so a
background refetch could land after the fields were typed. The re-seed then
replaced the typed name, phone and city with the stored ones, and Save sent
the stored values back. The API answered 200, the screen said "Saved", and
nothing had changed.

Evidence:

- One local failure was inspected before its evidence was lost: the `PATCH`
  had returned 200 and the `User` row still held the original name.
- The ordering is reproduced deterministically by unit tests that fail on the
  untouched editor and pass with the repair (see below).

The bio alone survived, by accident: it was re-seeded as
`bio || profile.bio`. That same expression made it impossible to clear a bio
once a refetch landed.

## The invariant

A background refresh must not overwrite an unsaved edit. An acknowledged save
reconciles the form with the server's canonical data without destroying an
edit made after that save began.

## The repair

- **Edited fields are not re-seeded.** Each of name, phone, city and bio is
  marked when the person changes it; the seeding effect skips marked fields.
  The provider pin travels with the city.
- **A save releases only what it saved.** On acknowledgement, a field stops
  being an edit only if it still holds the value that was submitted. Something
  typed while the save was in flight stays an edit. The inputs are not disabled
  during a save, so this ordering is reachable.
- **The acknowledgement is the cache.** `useUpdateProfile` now writes the
  server's response into the profile query before invalidating it, as the
  provider profile mutation already did. Before this the cache held the
  pre-save profile until the refetch returned.
- **An older answer is ignored.** A profile older than the newest save this
  form has had acknowledged does not re-seed it.
- **Edits belong to an identity.** If the form is handed another account's
  profile, its edit marks are dropped.

Not changed: refetching, invalidation, stale times, the save payload, the
dual-write for providers and its partial-failure handling.

## Deterministic regression tests

`apps/web/src/app/components/profile/EditProfilePage.test.tsx`. Each test
decides when each response lands.

| Sequence                                                         | On the untouched editor | With the repair |
| ---------------------------------------------------------------- | ----------------------- | --------------- |
| A. A late refetch after name, phone and city were edited         | FAIL                    | PASS            |
| B. An untouched field still follows a newer server value         | FAIL                    | PASS            |
| C. A field cleared on purpose stays cleared and is saved as null | FAIL                    | PASS            |
| D. A save acknowledged while the cached GET is still old         | PASS                    | PASS            |
| E. An answer older than the acknowledged save                    | FAIL                    | PASS            |
| F. Something typed while a save is in flight                     | FAIL                    | PASS            |
| G. A failed save keeps the edit and shows no success             | FAIL                    | PASS            |
| H. Another account's profile in the same mounted form            | PASS                    | PASS            |
| I. A late provider refetch under a typed city (provider context) | FAIL                    | PASS            |
| I. Provider half fails: not reported saved, edit kept            | PASS                    | PASS            |
| The form follows the server again after a successful save        | PASS                    | PASS            |

D and H pass on the untouched editor because it never dropped an edit on
acknowledgement and never tracked edits at all; they are there because a first
version of this repair got D wrong and would have got H wrong. The existing
"seeker context does not post to the provider profile" test is unchanged and
still passes.

## Real-browser acceptance

`r05-seeker-durability.real-api.spec.ts` is unintercepted, as before. Added:

- the `PATCH` body actually sent must equal the typed values, and the server's
  acknowledgement must too; a 200 alone is no longer accepted;
- a sanitized timeline of the editor's profile reads and its write (methods,
  statuses, per-field booleans; no cookie, token or body) is attached to every
  run;
- no trace and no video, because they would carry the session cookie into the
  uploaded evidence.

The existing reload, fresh-login and direct PostgreSQL assertions are
unchanged.

CI runs the spec once as before, then once more as a bounded batch
(`--repeat-each=5 --retries=0 --max-failures=1`) in its own output directory.
The batch is supplementary evidence and not a proof of race freedom.

## Local browser history, stated exactly

All local browser runs below were against an uncommitted working tree that held
an earlier form of this repair (edited fields skipped; the save-ordering parts
came later). None is attributable to the final commit.

| Batch                               | Spec runs completed | Passed | Failed | Notes                                                                                                                                     |
| ----------------------------------- | ------------------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Before any repair                   | 5                   | 4      | 1      | Inspected: `PATCH` 200, row unchanged                                                                                                     |
| First batch with the earlier repair | 12                  | 11     | 1      | **UNKNOWN** (below). Console result only; no per-run log was retained                                                                     |
| Second and third batches            | 34                  | 34     | 0      | Per-run logs retained                                                                                                                     |
| Fourth batch                        | 6                   | 6      | 0      | Per-run logs retained                                                                                                                     |
| Fourth batch, run 7                 | —                   | —      | —      | **INTERRUPTED**: the machine ran out of memory and the browser and API were terminated mid-run. Not a pass and not an application failure |

A spec run is one execution of the file (two test cases). No retries were used.
With the earlier repair: 52 completed runs, 51 passed, the last 40 in a row.

**The one failure with the earlier repair is UNKNOWN — evidence was
overwritten; cause cannot be reconstructed.** It may have been ordering D, E or
F, which that version did not handle and this one does; it may be something
else. Neither is claimed.

## Residual risk

- The UNKNOWN failure above.
- A passing batch, local or hosted, does not prove the absence of a race.
- Avatar, skills selection and the provider pin's own "detect location" flow
  are outside this repair except where the pin travels with the city.

## Rollback

Revert the PR. Web only; no schema, migration, contract or flag is involved.
