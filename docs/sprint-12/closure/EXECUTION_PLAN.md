# Sprint 12 closure — execution plan

Written 2026-09-20 from the verified state, not from a prior report.

## Method

Vertical slices, each reviewable on its own: contract/schema → domain → API →
real route/UI → tests → evidence. Baseline health is established before any
scope is added; a red baseline is repaired before anything new is built.

Baseline check performed first, on `develop` `8cad728`:
`web typecheck` rc=0 and 37/37 dispute tests. **Baseline green — no repair
needed**, so the slice below was additive.

## Slice status

| #   | Slice                                                                      | Status      | Evidence                                          |
| --- | -------------------------------------------------------------------------- | ----------- | ------------------------------------------------- |
| 1   | Re-verify state, read authoritative docs, build requirements matrix        | **DONE**    | `REQUIREMENTS_MATRIX.md`                          |
| 2   | **12D — six real tabs in the Admin dispute workspace**                     | **DONE**    | commit `65eeff1`, 12 tests, `UX_UI_ACCEPTANCE.md` |
| 3   | Browser + visual matrix for slice 2                                        | **BLOCKED** | host memory; `HANDOFF.md` §4.1                    |
| 4   | API DB-gated integration suites                                            | **NOT_RUN** | `HANDOFF.md` §4.2                                 |
| 5   | Remote CI on this source (`dispute-workspace`, `evidence-retention`)       | **BLOCKED** | needs push authorisation                          |
| 6   | 12B backup/restore suppression, account-wide erasure, orphan KYC inventory | **BLOCKED** | needs an authorised operational environment       |
| 7   | 12A/12C/12E re-verification as acceptance runs                             | **NOT_RUN** | depends on slices 3–4                             |

## Why slice 2 was chosen first

It is the one concrete engineering gap the brief names that is (a) fully
specified in writing, (b) executable without any external approval, and (c)
verifiable locally. Every other open item needs either a product decision, an
operational environment, or publication rights — none of which are mine to
grant.

## Scope boundaries deliberately held

- The participant dispute workspace was **not** redesigned. The brief names the
  Admin workspace; the Seeker/Provider journeys are to be preserved.
- No feature flag was added for the tabs. It is a presentation change on an
  existing authorised Admin route; a flag would hide delivery status without
  reducing risk, and `CLAUDE.md` forbids inventing one to explain missing UI.
- No permission, transition, deadline or remedy semantics were touched.
