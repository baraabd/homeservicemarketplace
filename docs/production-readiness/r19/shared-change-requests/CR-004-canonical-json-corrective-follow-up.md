# CR-004 — Correct ambiguous R19 idempotency payloads

## Owner authorization and exact scope

The repository owner asked on 2026-10-15 at 20:36:57 Asia/Damascus to continue
R19 after being presented with the candidate patch, the eight-file allowlist
and a corrective PR on the assigned branch. That instruction approves this
bounded continuation. No further approval of these paths is outstanding.

Approved exact paths:

1. `packages/contracts/src/money/wire.ts`
2. `apps/api/test/unit/r19-canonical-json-regression.spec.ts` (new)
3. `docs/production-readiness/r19/IMPLEMENTATION.md`
4. `docs/production-readiness/r19/ACCEPTANCE.md`
5. `docs/production-readiness/r19/RISKS.md`
6. `docs/production-readiness/r19/ROLLBACK.md`
7. `docs/production-readiness/r19/CONTRACT_CATALOG.md`
8. `docs/production-readiness/r19/shared-change-requests/CR-004-canonical-json-corrective-follow-up.md` (this file)

These paths are within R19's existing approved ownership prefixes. No shared
schema, migration, root barrel, AppModule, manifest, lockfile or CI lease is
requested or used. Other lanes' files remain read-only.

Original G0 base: `059c018576a75837d4dfb262ee49168d9217d881`.
Corrective parent: `fcdf1deb1a34044b9253ebac8e0e308a69e7a667`.
Branch: `feat/r19-money-authority-contracts`.
Inspected develop: `af662586a640e41d8438d0cb2dd69e8cbb0e172a`.
The affected source is identical between the corrective parent and develop.
PR #159 is already merged; the owner-approved continuation uses one new R19
corrective Draft PR. No rebase, branch merge, force-push, deployment or live
activation is authorized by this continuation.

## Reproduced defect

The previous encoder produces identical digests for distinct payloads:

```ts
canonicalJson({ amount: 5n }) === canonicalJson({ amount: { $bigint: '5' } });
canonicalJson({ items: [] }) === canonicalJson({ items: new Array(1) });
```

It also silently drops symbol/hidden object properties and extra array
properties, and invokes accessors. This contradicts the shared helper's
fail-closed input contract. This finding does not assert a duplicate payment
or exploit on a live endpoint; activation remains without a live caller.

## Correction

Preserve the byte encoding of valid existing financial commands. Reserve the
`$bigint` object key for the encoder, require dense arrays with no extra
properties, and reject symbol keys, non-enumerable data and accessors without
invoking getters. Object-key sorting, bigint precision, null-prototype plain
objects and repeated non-cyclic references remain supported. Finite numbers
retain standard JSON serialization semantics, including negative zero as zero.

The new regression suite imports the published workspace contracts package.
No package-relative source import, duplicate ledger, financial backfill or
stored-digest rewrite is introduced. Contract version remains `hsm.money.v1`.

## Validation and remaining gates

Before approval, the isolated 15-case diagnostic passed 5 and failed 10 on the
unchanged source, and passed all 15 against the candidate. Those historical
candidate results are not integration acceptance of the applied correction.
Executed repository tests and final-head CI are recorded in ACCEPTANCE.md and
the corrective PR. No assertion, timeout or scanner rule may be weakened.

CR-002 outbox registration/consumer, the remaining internal-port catalog,
refund-link constraints, the coordinator's G1 record and commercial policies
remain separate open handoffs. This correction does not accept a wave or
enable a payment rail. Reverting the corrective code restores the old defect
but requires no schema or data rollback.
