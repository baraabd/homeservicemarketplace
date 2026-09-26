## Scope and source identity

- Sprint:
- Base SHA:
- Final SHA:
- Owned paths:
- Shared files modified:
- Schema change:
- Migration:
- Contract change:
- Feature flag:
- Security impact:

Describe the root cause or capability, the implementation, and why each shared-file edit is necessary. Record the actual branch-start merge base, not a copied plan SHA. Update Final SHA in this PR body after committing; do not create a self-referential commit just to insert its own hash.

## Acceptance evidence

- Tests:
- Browser evidence:
- Known limitations:
- Rollback:

Link `docs/production-readiness/<sprint>/` and the CI / CodeQL runs for the final head. Distinguish executed PASS / FAIL / BLOCKED / NOT RUN / NOT APPLICABLE. Test source and mocked responses are not evidence of a real browser, database or storage journey.

## Review checklist

- [ ] One sprint, one branch, one PR; no unrelated files.
- [ ] Shared-file owners coordinated; no concurrent migration outside S10.
- [ ] Latest `develop` integrated safely and affected gates re-run afterwards.
- [ ] Lint, typecheck, affected tests and production build passed where applicable.
- [ ] Required real-service, browser, RTL/mobile/accessibility and negative-security evidence is attached.
- [ ] CI and CodeQL passed on the final SHA; missing/queued/cancelled is not PASS.
- [ ] No skipped tests, weakened gates, exposed secrets or unintended flag activation.
- [ ] Remaining risks and rollback are explicit; no merge or deployment performed by this task.
