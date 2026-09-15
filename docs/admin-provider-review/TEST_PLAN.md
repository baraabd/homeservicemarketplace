# Admin provider review verification

The change uses UX/UI Redesign Mode for the Admin workspace and Product Feature / Integration Mode for review policy, provider feedback and media boundaries.

## Evidence boundaries

- `apps/api/test/integration/admin-provider-review.integration.spec.ts` uses real Nest HTTP routing, validation, role and permission guards, Prisma repositories, PostgreSQL transactions, verification workflow and capability policy. Its test harness supplies an authenticated principal and bypasses CSRF; it does not prove credential issuance, cookie handling or token validation.
- `apps/web/e2e/admin-provider-review.spec.ts` drives the ordinary `/admin/providers/:id` route with deterministic API fixtures. It proves browser interaction, layout, direction, focus and fixture-state rendering. It is not evidence that the production API persisted a review.
- The existing onboarding review/submit integration suite covers provider feedback and canonical resubmission. Existing identity read integration suites cover restricted downloads, durable read audit and revoked permission access.

## Real database cases

The new suite covers immutable six-task snapshots; historical missing snapshots; explicit specialty moderation; clean identity requirements; stale content and country changes; exact submission IDs and opaque revisions; idempotency; concurrent decision exclusion; final-write rollback across application, identity, work grant, audit, notification and outbox; private note separation; atomic evidence correction from submitted/in-review cases; verification renewal and previous grant expiry when an identity correction follows approval; current membership and permission revocation; anonymous, non-admin, self-review and ineligible-account refusals.

All owned fixtures have a per-run namespace. Cleanup only removes that namespace. Shared advisory locks coordinate with existing table-wide lifecycle, outbox, grant and media sweep tests; the suite does not reduce parallel workers.

## Browser cases

The default Playwright matrix runs desktop 1440×900, tablet 768×1024 and mobile 375×812. An additional Arabic adaptation test checks widths 320, 390 and 1024 pixels and minimum 44-pixel decision controls. The dossier is captured in Arabic/RTL and English/LTR in both light and dark themes. Tests check six section landmarks, no horizontal overflow, WCAG-tagged axe results, confirmation focus containment and focus return, no writes before confirmation, 409 recovery preserving instructions, protected media opened on demand, permission-limited views, old submissions and directory cursor/filter return paths.

Screenshots and axe JSON are attached using `testInfo.outputPath` and `testInfo.attach`, under `apps/web/test-results/playwright/`. CI uploads these and `apps/web/playwright-report/`. A person must inspect the rendered captures before making a visual acceptance claim.

## Commands

```sh
pnpm --filter @homeservicemarketplace/api typecheck
RUN_DB_INTEGRATION=1 pnpm --filter @homeservicemarketplace/api test --runInBand admin-provider-review.integration.spec.ts
pnpm --filter @homeservicemarketplace/web typecheck:e2e
E2E_PREBUILT=1 pnpm --filter @homeservicemarketplace/web exec playwright test admin-provider-review.spec.ts
```

`--runInBand` above scopes one suite for diagnosis; normal CI runs the integration matrix in parallel. Real DB execution requires the migrated/seeded test PostgreSQL environment and normal test configuration. Browser execution requires the production web build and Chromium installed by CI. A fixture screenshot is never substituted for a real API flow or production deployment evidence.
