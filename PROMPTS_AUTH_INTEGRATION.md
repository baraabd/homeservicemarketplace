Read CLAUDE.md completely before any planning, inspection, coding, or fixes, and follow it strictly throughout the task.

Inspect the real codebase, runtime configuration, environment usage, auth flow, database schema, shared contracts, and frontend-backend integration points before making any change.

Fix this issue by inspecting the real codebase first:
Signup succeeds in the UI, but verification token persistence, email verification, or OTP completion is broken. Verify the entire signup-to-verification flow in local development and Vercel-compatible production assumptions.

Rules:

- backend-first fix
- no UI redesign
- no masking backend, database, enum, email, cookie, CORS, or env defects in the frontend
- minimal frontend integration changes only
- verify DTO/schema/enum/contracts parity
- verify Prisma schema, generated client, DB enum values, backend logic, shared contracts, and frontend assumptions stay aligned
- verify signup request validation, token issuance, token persistence, token lookup, token invalidation, TTL handling, and verification completion
- verify email/OTP delivery path in development and production assumptions
- verify duplicate env vars, conflicting auth settings, and stale generated artifacts
- verify local runtime + clean local build + production-like backend boot + Vercel-compatible frontend build
- do not claim fixed unless signup and verification work end-to-end

Return:
Assumptions
Root Causes
Plan
Files Changed and Why
Tests Added or Updated
Commands Actually Run
Runtime Checks Performed
Environment Verification Results
Security Notes
Risks / Remaining Issues
Final Status

Read CLAUDE.md completely before any planning, inspection, coding, or fixes, and follow it strictly throughout the task.

Inspect the real codebase, runtime configuration, auth/session implementation, cookie settings, CORS handling, frontend request behavior, and backend guards before making any change.

Fix this issue by inspecting the real codebase first:
Login appears to succeed or partially succeed, but auth/me fails, cookies are missing or not sent, or cross-origin auth behavior is broken between frontend and backend in local development or production assumptions.

Rules:

- backend-first fix
- no UI redesign
- no masking cookie, session, CORS, proxy, origin, or env defects in the frontend
- minimal frontend integration changes only
- verify login flow, auth/me flow, session/access token lifecycle, logout behavior, and unauthorized access behavior
- verify cookie settings: Secure, SameSite, Domain, Path, Max-Age, HttpOnly where applicable
- verify CORS, credentials, allowed origins, preflight behavior, x-client-kind or custom header behavior, and reverse-proxy assumptions
- verify frontend HTTP client config such as credentials/include and base URL correctness
- verify local runtime + clean local build + production-like backend boot + Vercel-compatible frontend build
- do not claim fixed unless login and auth/me work end-to-end in the real runtime flow

Return:
Assumptions
Root Causes
Plan
Files Changed and Why
Tests Added or Updated
Commands Actually Run
Runtime Checks Performed
Environment Verification Results
Security Notes
Risks / Remaining Issues
Final Status

Read CLAUDE.md completely before any planning, inspection, coding, or fixes, and follow it strictly throughout the task.

Inspect the real codebase, runtime configuration, mail adapter, SMTP settings, reset-token persistence, frontend reset flow, and backend validation before making any change.

Fix this issue by inspecting the real codebase first:
Forgot-password claims success, but no email arrives, reset tokens are not created correctly, reset links are invalid, or the reset-password flow fails in local development or production assumptions.

Rules:

- backend-first fix
- no UI redesign
- no masking email, token, persistence, or env defects in the frontend
- minimal frontend integration changes only
- verify forgot-password request handling, anti-enumeration behavior, token generation, hashing, persistence, lookup, invalidation, TTL, and reset completion
- verify SMTP/mail provider config in local development and production assumptions
- verify Mailpit or local SMTP behavior in development and real-provider assumptions for production
- verify reset link format, frontend routing expectations, and backend token validation rules
- verify safe user-facing messaging without leaking account existence or raw infrastructure failures
- verify local runtime + clean local build + production-like backend boot + Vercel-compatible frontend build
- do not claim fixed unless forgot-password and reset-password work end-to-end

Return:
Assumptions
Root Causes
Plan
Files Changed and Why
Tests Added or Updated
Commands Actually Run
Runtime Checks Performed
Environment Verification Results
Security Notes
Risks / Remaining Issues
Final Status

Read CLAUDE.md completely before any planning, inspection, coding, or fixes, and follow it strictly throughout the task.

Inspect the real codebase, Prisma schema, migrations, generated client, database enum values, shared contracts, backend code, and frontend assumptions before making any change.

Fix this issue by inspecting the real codebase first:
Runtime or persistence is failing because Prisma schema, generated client, database enum values, backend code, shared contracts, or frontend assumptions are out of sync.

Rules:

- backend-first fix
- no UI redesign
- no masking schema or enum drift in the frontend
- minimal frontend integration changes only
- verify exact enum parity across database, Prisma schema, generated client, backend domain logic, shared contracts, API DTOs, and frontend usage
- verify migration correctness, rollback consideration, generate step, and workspace artifact sync
- verify no stale dist, stale prisma client, stale contracts build, or cache-dependent false positives
- verify package-scoped typecheck, lint, tests, and build
- verify local runtime + clean local build + production-like backend boot + Vercel-compatible frontend build
- do not claim fixed unless the failing runtime path works with the real database state

Return:
Assumptions
Root Causes
Plan
Files Changed and Why
Tests Added or Updated
Commands Actually Run
Runtime Checks Performed
Environment Verification Results
Security Notes
Risks / Remaining Issues
Final Status

Read CLAUDE.md completely before any planning, inspection, coding, or fixes, and follow it strictly throughout the task.

Inspect the real monorepo build flow, workspace dependency graph, generated artifacts, environment usage, package scripts, and frontend-backend integration assumptions before making any change.

Fix this issue by inspecting the real codebase first:
The app behaves differently between local development, clean local build, and Vercel-compatible production build. Resolve the root causes and restore environment parity without redesigning the frontend.

Rules:

- backend-first fix where relevant
- no UI redesign
- no masking monorepo, build-order, env, artifact, or deployment defects in the frontend
- minimal frontend integration changes only
- verify workspace package build order, generated artifacts, Prisma client generation, contracts build, and consumer package expectations
- verify package-scoped commands and root scripts
- verify environment variable requirements for local and production assumptions
- detect duplicate env vars, missing vars, stale dist, stale generated clients, and cache-only success
- verify production-like backend boot and Vercel-compatible frontend build from a clean state
- verify the relevant runtime flow after the build succeeds
- do not claim fixed unless local runtime, clean local build, and Vercel-compatible build all align

Return:
Assumptions
Root Causes
Plan
Files Changed and Why
Tests Added or Updated
Commands Actually Run
Runtime Checks Performed
Environment Verification Results
Security Notes
Risks / Remaining Issues
Final Status
