# CLAUDE.md - Project Identity & Rules

## Project Identity

This project is a production-grade service marketplace platform similar to TaskRabbit / Thumbtack / regional on-demand service apps.

Primary goals:

- scalability
- security
- maintainability
- testability
- clean architecture
- production readiness
- safe deployments
- minimal technical debt

Core stack:

- Node.js
- TypeScript
- PostgreSQL + Prisma
- MongoDB
- Redis
- Docker
- pnpm workspace / monorepo
- Vercel-compatible frontend deployment

---

## Current Delivery Phase: Backend-Frontend Integration

This phase has strict priority over general feature expansion.

### Phase Objective

The frontend is already substantially built and should be treated as the reference UI.
The current goal is to stabilize and complete backend behavior, then integrate the existing frontend with real backend flows.

### Mandatory Rules For This Phase

1. Do not redesign, restyle, or restructure the frontend unless strictly required for:
   - API integration
   - validation correctness
   - loading, error, empty, and success state handling
   - accessibility-critical fixes
   - security fixes

2. Default priority order:
   - backend core correctness first:
     - DTOs
     - validation
     - services
     - repositories
     - auth
     - persistence
     - env and runtime correctness
   - integration second:
     - connect existing frontend screens to real backend behavior
   - minimal frontend logic third:
     - API wiring
     - state synchronization
     - auth/session handling
     - loading/error handling
     - safe field mapping

3. Do not introduce design drift:
   - no unnecessary changes to spacing
   - no unnecessary changes to colors
   - no unnecessary changes to typography
   - no unnecessary component rewrites
   - no unrelated UI refactors

4. Do not patch backend, schema, database, or auth defects only in the frontend.

5. Integration is not complete until the relevant flow works end-to-end at runtime.

---

## Environment and Deployment Parity

All meaningful work must be verified across the relevant environments:

- local development
- clean local build
- local production-like execution
- Vercel-compatible frontend build
- backend production-like boot

Do not consider a task complete if it only works in one environment.

Do not rely on:

- stale dist folders
- stale generated clients
- stale workspace outputs
- hidden local state
- machine-specific fixes
- cached artifacts as proof of correctness

When builds or runtime behavior differ by environment, identify and fix the root cause rather than masking it.

---

## Operating Mode

Always work in this order unless explicitly instructed otherwise:

1. inspect current codebase
2. plan before coding
3. implement in small safe increments
4. add or update tests
5. run typecheck, lint, test, and build
6. verify runtime flows
7. self-review
8. patch discovered issues
9. summarize changes, evidence, and remaining risks

For any non-trivial task, always output:

- assumptions
- root causes
- files to create or update
- risks
- implementation steps

Never jump directly into large code generation without first planning.

---

## Monorepo and Command Discipline

This repository uses pnpm workspace.
Prefer package-scoped commands when verifying changes.

Examples:

- `pnpm --filter @homeservicemarketplace/api typecheck`
- `pnpm --filter @homeservicemarketplace/api test`
- `pnpm --filter @homeservicemarketplace/web build`
- `pnpm --filter @homeservicemarketplace/contracts build`

Do not report a green result from a root-level command if the relevant package-level command was not verified.

When reporting command results:

- list the exact commands actually run
- do not claim success for commands that were not run
- separate static checks from runtime verification

---

## Integration-Specific Acceptance Rules

For integration tasks, completion requires all relevant items below:

- request and response shapes align exactly between frontend and backend
- DTOs, enums, Prisma schema, database values, shared contracts, and frontend expectations are consistent
- migrations are in sync with code
- generated clients and artifacts are up to date
- auth and session flows work in practice
- validation works server-side and is reflected safely in the UI
- loading, error, empty, and success states are handled safely
- required env vars are documented and validated
- local and Vercel-compatible builds succeed
- backend production-like boot succeeds
- raw internal, Prisma, database, and infrastructure errors are not leaked to the UI

No green report is allowed without runtime verification of the relevant user-facing flow.

---

## Runtime Acceptance Flows

For auth and integration work, verify the relevant real flows when applicable:

- signup
- email verification
- OTP verification
- login
- auth/me
- forgot password
- reset password
- logout
- session invalidation
- protected route access
- error-state handling for invalid credentials or expired tokens

A task is not complete if these flows fail at runtime even when lint, typecheck, test, and build pass.

---

## Prisma, Database, and Schema Discipline

Use Prisma for PostgreSQL access unless explicitly justified otherwise.

After schema changes, verify all relevant steps:

- migration creation for development
- `prisma generate`
- production-safe migration application path
- test impact review
- enum and contract parity review

Enum and contract parity must be verified across:

- Prisma schema
- generated Prisma client
- database enum values
- backend code
- shared contracts
- frontend assumptions

Do not fix schema drift in only one layer.

Important relational tables should include:

- `createdAt`
- `updatedAt`
- `deletedAt` where soft delete is appropriate

Every meaningful schema change must come with:

- migration
- rollback consideration
- index review
- test impact review

---

## Env and Config Hygiene

- no duplicate environment keys with conflicting values
- all required env vars must be documented
- dev and production expectations must be explicit
- missing env vars must fail clearly and safely
- local development config must not silently diverge from production-like behavior
- security-sensitive defaults must never be weakened for convenience without explicit justification

Never hardcode:

- API keys
- secrets
- tokens
- passwords
- SMTP credentials
- database credentials

Use placeholders only when examples are necessary.

---

## Architecture and Folder Discipline

### Architecture Style

Default to a modular monolith with strict bounded contexts, written in a microservice-ready way:

- explicit module ownership
- no circular dependencies
- no hidden shared state
- clear boundaries
- safe extraction paths later if needed

### Preferred Structure

- `src/modules/<domain>/`
- `src/shared/`
- `src/infrastructure/`
- `src/config/`
- `src/lib/`
- `src/types/`
- `src/tests/`

### Naming

- use `camelCase` for variables and functions
- use `PascalCase` for classes, DTOs, interfaces, schemas, and types
- use clear file names
- avoid unclear abbreviations

---

## Security Rules

These are non-negotiable.

- never trust client-sent role, price, ownership, payment amount, duration, or status
- validate and sanitize all untrusted input
- do not leak stack traces, raw Prisma errors, SQL details, token values, or internal hostnames to the client
- backend must map internal failures into safe, stable client-facing errors
- frontend must never render raw stack traces, raw database errors, or file paths
- never introduce insecure shortcuts, bypasses, or temporary debug backdoors
- never log passwords, OTPs, reset tokens, or sensitive personal data unmasked

---

## Testing and Quality

Testing is required, not optional.

For meaningful work, generate or update as relevant:

- unit tests
- integration tests
- edge case tests
- auth tests
- validation tests
- regression tests
- security-focused negative tests

For integration and auth tasks:

- tests must not be limited to unit tests
- verify the real runtime flow manually or through integration or e2e coverage where practical

No task is complete until the relevant commands pass:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Run package-scoped equivalents where appropriate for the monorepo.

Do not claim success based on static checks alone.

Do not claim tests passed if they were not actually run.

---

## Observability and Runtime Reliability

Code should be production-debuggable.

Prefer:

- structured logs
- request IDs or correlation IDs
- health endpoints
- metrics endpoints
- clear failure boundaries
- safe timeout handling
- safe retry logic only where justified

Development-only logging convenience must never crash application boot.

---

## Output Contract

For implementation or bug-fix tasks, always return:

1. Assumptions
2. Root Causes
3. Plan
4. Files Changed and Why
5. Tests Added or Updated
6. Commands Actually Run
7. Environment Verification Results
8. Security Notes
9. Risks or Remaining Issues
10. Final Status:

- fixed
- partially fixed
- blocked

Do not overstate success.

---

## Forbidden Behaviors

Do not:

- redesign frontend UI without explicit instruction
- claim integration is complete without runtime verification
- patch backend problems only in the frontend
- patch database or schema drift in only one layer
- add TODO placeholders in critical security or auth paths
- expose internal admin endpoints publicly
- disable validation for speed
- invent passing tests
- claim production readiness without verification
- stop at static checks when runtime flows are broken
- delete orphan or unused UI files unless they are proven to break the build or are explicitly approved for cleanup

If blocked:

- explain exactly what is blocked
- explain why it is blocked
- reproduce locally first
- investigate from the codebase first
- request external evidence only if truly necessary
