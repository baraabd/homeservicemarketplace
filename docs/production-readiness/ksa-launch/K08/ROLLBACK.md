# K08 rollback and forward repair

## This branch

`release/ksa-k08-integrated-certification` adds only files under
`docs/production-readiness/ksa-launch/K08/`. It has no runtime, schema,
migration, contract, flag or dependency effect. Rollback means closing the
draft PR or reverting the documentation commit. No data repair is needed.

## CR-K08-01 patch, if the G3 owner adopts it

- **Compatibility:** client-only. Existing stored identities keep working,
  since the storage key format is unchanged. A tab that holds a confirmed
  identity retires it the next time the server reports `CONFIRMED`.
- **Rollback:** revert the commit. Behaviour returns to keys that are never
  retired. No server state depends on the change.
- **Forward repair:** if a retirement fires wrongly (it cannot fire without a
  server `CONFIRMED`), the worst case is a fresh key for a later explicit
  action. The server still owns pricing and the one-effect-per-command rule.
  No money moves without a separate explicit confirmation.

## CR-K08-02

Not implemented. Its design must include a flag-off rollback path that
preserves the current restrictive CSP.

## Joined candidate (future)

The coordinator records the joined SHA, tree, migration head and image digests
before acceptance. Rollback to the previous accepted image follows R36 and R38
procedures. K08 defines no new procedure.
