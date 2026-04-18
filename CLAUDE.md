# CLAUDE.md

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

Core domains include:

- authentication and IAM
- users and providers
- services and categories
- geospatial search
- bookings and scheduling
- payments and escrow
- reviews and moderation
- notifications and chat
- admin analytics
- observability and DevSecOps

Target stack defaults:

- Node.js
- TypeScript
- PostgreSQL
- MongoDB
- Redis
- Docker
- Prisma for PostgreSQL ORM
- Mongoose only if MongoDB modeling is needed
- REST and/or GraphQL only when justified
- Redis for caching, distributed locks, queues, and rate limiting

---

## Operating Mode

You must work in this order unless explicitly instructed otherwise:

1. Inspect current codebase
2. Plan before coding
3. Implement in small safe increments
4. Add or update tests
5. Run review on the generated code
6. Patch discovered issues
7. Summarize changes and risks

Never jump directly into large code generation without first planning.

For any non-trivial task, always output:

- assumptions
- files to create/update
- risks
- implementation steps

Do not skip edge cases.

---

## Architecture Rules

### 1. Architecture style

Default to a **modular monolith with strict bounded contexts** unless the task explicitly requires a true microservice split.

Reason:

- easier local development
- easier transactions
- easier debugging
- lower operational complexity
- clean extraction path into microservices later

Even if modular monolith is used first, code must be written as **microservice-ready**:

- clear module boundaries
- no circular dependencies
- no shared hidden state
- domain ownership must be explicit
- avoid tight coupling between modules

### 2. Bounded contexts

Keep domains separated:

- iam
- users
- providers
- services
- categories
- search
- bookings
- schedules
- payments
- escrow
- wallets
- reviews
- moderation
- notifications
- chat
- admin
- analytics
- infrastructure

### 3. Folder discipline

Use consistent folder structure.
Prefer:

- `src/modules/<domain>/`
- `src/shared/`
- `src/infrastructure/`
- `src/config/`
- `src/lib/`
- `src/types/`
- `src/tests/`

Each module should contain only what it owns:

- controller / resolver
- service
- repository
- dto
- validator
- types
- tests

### 4. Naming

Use `camelCase` for variables and functions.
Use `PascalCase` for classes, interfaces, DTOs, schemas, and types.
Use clear file names.
Avoid abbreviations unless they are standard.

---

## Security Rules

These are non-negotiable.

### 1. No unsafe code

Never generate:

- backdoors
- hidden admin bypasses
- debug secrets
- hardcoded API keys
- hardcoded passwords
- malicious install scripts
- remote code execution helpers
- disabled auth checks
- “temporary” insecure shortcuts

### 2. Injection defense

Prevent:

- SQL injection
- NoSQL injection
- command injection
- template injection
- path traversal
- XSS
- SSRF
- IDOR
- CSRF where relevant

Always validate and sanitize untrusted input.

### 3. Secrets

Never hardcode secrets.
Always use environment variables.
If an example is needed, use placeholders only.

### 4. Auth

Never trust client-sent role, price, duration, ownership, payment amount, or status.
Always validate on server side.

### 5. Error handling

Do not leak:

- stack traces
- database schema internals
- token values
- infrastructure secrets
- internal hostnames
- raw SQL
- raw third-party failure payloads

### 6. Dependencies

Avoid unsafe, abandoned, or unnecessary dependencies.
Prefer minimal dependency footprint.

### 7. File handling

Any file upload must include:

- MIME validation
- extension validation
- size limits
- malware scanning hook placeholder
- secure storage path handling

### 8. Logging

Never log:

- passwords
- tokens
- card data
- OTP secrets
- raw personal documents
- full payment payloads
- sensitive identity data unless masked

---

## Database Rules

### 1. PostgreSQL

Use PostgreSQL for:

- users
- roles
- permissions
- bookings
- schedules
- transactions
- wallets
- reviews
- audit logs
- admin configurations
- relational reporting data

### 2. MongoDB

Use MongoDB only for:

- dynamic service metadata
- flexible provider portfolios
- complex non-uniform content documents
- optional denormalized read models when justified

Do not store the same source of truth in multiple databases without a clear sync strategy.

### 3. ORM / Access

- Use Prisma for PostgreSQL
- Use repository pattern where useful
- Do not write raw SQL unless absolutely necessary
- If raw SQL is necessary, explain why and include safety review

### 4. Audit columns

All important relational tables must include:

- `createdAt`
- `updatedAt`
- `deletedAt` where soft delete is appropriate

### 5. IDs

Use stable IDs consistently.
Cross-database linking must be explicit and documented.

### 6. Migrations

Every schema change must come with:

- migration
- rollback consideration
- index review
- test impact review

---

## API Rules

### 1. API design

- consistent naming
- version-aware if needed
- explicit DTOs
- strict validation
- pagination for list endpoints
- cursor pagination where large datasets exist

### 2. Responses

Prefer predictable response envelopes when appropriate:

- `success`
- `data`
- `error`
- `meta`

Do not return bloated objects.
Only return the minimum required shape.

### 3. Validation

All input must be validated.
All enums must be checked server-side.
Never trust frontend validation alone.

### 4. Ownership checks

All protected resources must enforce ownership and authorization checks.

---

## Testing Rules

Testing is required, not optional.

For any meaningful feature, generate:

1. unit tests
2. integration tests
3. edge case tests

Where relevant also include:

- auth tests
- validation tests
- concurrency tests
- regression tests
- security-focused negative tests

Test expectations:

- no silent failures
- no fake green tests
- assert behavior clearly
- test unhappy paths
- test unauthorized access
- test malformed payloads

---

## Performance Rules

Do not prematurely optimize, but do not ignore obvious bottlenecks.

Always consider:

- indexes
- connection pooling
- caching opportunities
- N+1 query risks
- unnecessary serialization
- heavy payload trimming
- background processing for expensive work
- event-driven updates where useful

When handling list endpoints:

- paginate
- select only needed fields
- avoid loading heavy relations by default

---

## Observability Rules

Code should be production-debuggable.

Prefer:

- structured logs
- request IDs / correlation IDs
- health endpoints
- metrics endpoints
- clear failure boundaries
- retry logic only where safe
- timeout handling
- circuit breaking where relevant

---

## CI/CD and Quality Rules

Before considering any task complete, ensure:

- lint passes
- typecheck passes
- tests pass
- no obvious security regression
- no dead code
- no orphan files
- no undocumented env vars

If Docker files are involved:

- use multi-stage builds where possible
- run as non-root user in production
- expose only required ports
- minimize image size

---

## Required Review Loop

After generating or modifying code, always perform a self-review.

The review must check:

1. architecture correctness
2. security flaws
3. missing validation
4. authorization mistakes
5. performance risks
6. race conditions
7. bad error handling
8. missing tests
9. dangerous dependencies
10. maintainability issues

After the review:

- apply fixes directly
- explain what was fixed
- mention any remaining risks

---

## Output Contract for Claude

For implementation tasks, structure the response like this:

1. Assumptions
2. Plan
3. Files created/updated
4. Code
5. Tests
6. Security notes
7. Risks / follow-ups

For review tasks, structure the response like this:

1. Critical issues
2. High priority issues
3. Medium issues
4. Recommended fixes
5. Patches applied
6. Residual risks

---

## Forbidden Behaviors

Do not:

- invent nonexistent files as if they already exist
- claim tests passed if they were not run
- claim code is production-ready without review
- skip validation for speed
- ignore authorization
- add placeholder “TODO security later” in critical paths
- add mock code inside production code paths without clearly labeling it
- silently change architecture without explanation
- add broad wildcard CORS in production defaults
- disable TLS/security checks for convenience
- expose internal admin endpoints publicly

---

## When Uncertain

If requirements are ambiguous:

- state assumptions clearly
- choose the safer implementation
- prefer maintainability over novelty
- prefer explicit code over magical abstractions

If a task is too large:

- break it into phases
- complete one phase fully
- keep boundaries clean

---

## Final Principle

Write code as if it will be:

- reviewed by a strict principal engineer
- deployed to production
- tested under load
- audited for security
- maintained by another team six months later
