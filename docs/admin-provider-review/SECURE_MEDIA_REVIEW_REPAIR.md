# Secure media review and provider correction messages

## Scope and baseline

Mode A (bounded integration/bug fix), with a small provider-visible correction action.
Repository: baraabd/homeservicemarketplace.
Base: 929afb55ce65a32671ff77eeb55fc95bc884e164.
Branch: fix/admin-secure-media-review-feedback.
No merge, deployment, live review decision, user permission change, migration, or database reset is part of this patch.

## Findings

The supplied Admin screenshot reports no identity verification case. The Protected badge is not a denial. Existing identity reads require authorized, live, finalized, CLEAN restricted evidence; missing documents cannot be made reviewable by exposing their storage.

The existing case action note is private reviewer prose, intentionally not delivered to the provider. The application-return workflow already supports a separate providerMessage, field/item targeting, revision/idempotency checks, correction unlocking, audit, durable notification and outbox in one transaction. The repair exposes that existing workflow beside the identity section and each portfolio card instead of inventing a second feedback authority.

The existing portfolio viewer could only recover a failed media request by closing and reopening it. Its MIME comparison rejected allowed image types with response parameters. Its retained blobs also lacked the identity viewer's session-expiry cleanup and bounded preview lifetime.

The normal local Compose stack does not start ClamAV. The default scanner is none and the scan worker is off. This is intentionally fail-closed; a compiler or health-check pass cannot prove that uploaded documents are scanned.

## Changes

- IdentityReviewContent.tsx is the original ReviewIdentity.tsx, preserved byte-for-byte as Git blob 9d9e9a8e4950f1930105c83b3a8fdcb481b3ff61. The small wrapper adds an explanatory empty state and the provider-message action; existing protected preview, approval/rejection, guards and case decisions are unchanged.
- ReviewEvidenceCorrection uses the existing request-changes API. It requires a provider-visible message, pins provider/submission/revision, keeps the same idempotency key on retry, pauses stale/denied dialogs and never includes private notes. A successful command followed by a failed refresh cannot be resent from the same stale component.
- The action returns the APPLICATION for correction. It does not directly approve, reject, publish, or replace an image. Its label and confirmation explain this. It is offered only when the server advertises requestChanges and the reviewer has the existing decision permission.
- Portfolio approval/rejection still requires a loaded image and the current server-advertised action/revision. A reviewer may request a replacement from the card even when image download fails, using the separate authorized return workflow.
- Private portfolio media has an explicit Retry action, normalized MIME checks, request timeout, cross-provider/revision isolation, abort/revoke cleanup, session-expiry cleanup and a five-minute preview lifetime. No public or signed-GET fallback is added.
- An opt-in local launcher starts a real, loopback-bound ClamAV and the native API scan worker. It refuses production/staging/test, remote PostgreSQL URLs and S3 configurations rather than silently modifying their settings. It never changes enforcement flags, file roots or .env.

## Local activation (Windows PowerShell or a local terminal)

Preserve local work and check out this branch only after reviewing git status. Stop only the current native API terminal with Ctrl+C. Keep the existing PostgreSQL, Redis and Mailpit running. Do not run a Docker API on port 4000 at the same time.

From the repository root, with the repository toolchain and dependencies already installed:

```powershell
node --env-file=.env scripts/dev/review-runtime.cjs
```

The launcher starts only the separate hsm-review scanner project, waits for its health check and runs the existing api dev:clean script. On first use Docker must download/start the scanner. No migration or seed is run. Existing storage locations are preserved.

In a separate terminal:

```powershell
curl.exe --connect-timeout 3 --max-time 15 -sS -i http://localhost:4000/health/ready
pnpm --filter @homeservicemarketplace/web dev
```

Use synthetic documents on a disposable local account for testing. Do not substitute the deterministic test scanner for real review evidence.

## Acceptance journey

1. Provider opens /provider/verification, creates/resumes their case, uploads and finalizes the required supported document. Wait for a real scanner verdict. CLEAN means the malware scan passed, not that identity has been approved.
2. Provider submits the case; Admin opens the protected identity preview and reviews the contents. Verify read authorization and audit remain enforced.
3. For a missing or unclear photo, Admin selects Request identity photo with a message, writes a provider-facing explanation and confirms. An existing submitted case is returned through the current workflow; no missing case or document is fabricated.
4. Provider receives the existing application notification, reads the explanation in onboarding, corrects the named task and resubmits. Admin reviews the new submission/revision. Old approvals and audit history are not overwritten.
5. In Portfolio, open the protected image. Transient media failure can be retried. Approve/reject uses the existing per-image route and expectedRevision; rejection still requires its provider-visible reason.
6. A replacement request from a portfolio card targets that item through the application-return flow. The provider uploads the replacement using the existing gallery controls and resubmits the application when required.
7. Check permission loss, HTTP 403/404, stale revision, unavailable scanner, duplicate/lost responses, Arabic/English, mobile and keyboard focus. None may turn an unreadable/unscanned image into an approved image.

## Missing files and deployment boundaries

A database row is not the stored file. If media was uploaded in a Docker API volume and the native API now points to a different LOCAL_STORAGE_DIR or RESTRICTED_STORAGE_DIR, those bytes may not be reachable. This patch never searches arbitrary roots or publishes files to work around that mismatch. The operator must restore the intended storage mapping/backup, or request a replacement. S3 staging/migration and permission failures remain explicit operational requirements.

An absent case, an unscanned document, a storage failure, and a missing reviewer permission are different conditions. A screenshot alone does not establish which affects every image in the user's local database.

## Verification record

Authoring container could not resolve github.com for a clone; it has no project dependency installation or Docker runtime. Source was read through the connected GitHub API at the pinned base. The reconstructed ReviewPortfolio source was checked against its exact original Git blob SHA before editing.

Executed locally on Node 22.16.0:
- node --test review-runtime.test.cjs: 8 passed, 0 failed, 0 skipped (configuration logic only).
- TypeScript transpileModule: no syntax diagnostics for the changed/new TypeScript files. This is NOT repository typecheck, Vitest, browser or runtime evidence.
- node --check review-runtime.cjs: passed.

Added Vitest regressions cover missing-case correction, required message, per-item targeting, permissions, stale revision, provider switch, paused dossier, conflicts, idempotent retry, acknowledged-command refresh failure, explicit private reads, MIME rejection, retry, session expiry and cross-provider byte isolation.

Final-head CI/CodeQL, repository Vitest, real API/PostgreSQL, ClamAV, browser/visual/accessibility and the user's local storage still require their own evidence. Keep the PR draft until required final-head checks and applicable browser evidence are recorded. Never replace a missing check with the baseline's results.

## Rollback

Revert application code together; no schema rollback is needed. Stop only the added scanner with:

```powershell
docker compose -p hsm-review -f infra/docker/docker-compose.review.yml stop clamav
```

The launcher never edits .env or changes the parent terminal environment. Existing evidence, decisions, notifications, database volumes and storage roots must be retained.
