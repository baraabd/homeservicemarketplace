# R26 rollback

No migration, contract version, dependency update, persisted data backfill or hosted deployment is introduced. Before merge, closing the review PR leaves develop unchanged.

If the owner later merges and observes a regression, prepare a reviewed revert of this sprint's runtime changes against that exact merge. Do not reset shared history or revert G1 acceptance publication. Rebuild and run full CI plus the R26 acceptance job before any owner-approved rollout.

For a legitimate CSP-blocked CDN/upload origin, prefer an exact reviewed build-origin addition and new artifact over disabling CSP or adding a wildcard/unsafe script directive. Verify both restricted previews and negative script/connect tests. An old bundle must travel with its matching CSP and edge headers; do not combine arbitrary headers and build artifacts.

Reverting parser protection can reintroduce generic 500s or unsafe syntax errors; reverting correlation validation can restore arbitrary early request-ID reflection. Retain those fixes when a rollback concerns only CSP. No authorization bypass, public private-media fallback, database reset, volume deletion or live-money activation is a rollback step.
