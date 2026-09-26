# S03 acceptance — runtime safety and preflight

Base SHA: `66e336cb4823802aabacc536584972aa43056d23`. Final head and run links are in the PR body. Mode: integration/bug fix; no UI, migrations, contracts, dependencies, flag activation or live-money changes.

Implemented actual boot-time boolean/CORS/cookie/scanner/S3 safety checks, consistent staging hardening, a stricter deployment preflight and the operator runtime/secrets matrix. Changes are confined to S03 configuration code/tests, infrastructure preflight and runtime documentation; shared `env.schema.ts` and all existing workflows are untouched.

Executed locally: TypeScript syntax/transpilation using the available global compiler and seven pure-policy runtime assertions. These are not project typecheck, Jest, Nest boot, browser, real database or cloud tests. The repository-pinned Jest/API build and all existing CI/CodeQL gates must run on the PR head. New negative tests exercise the real `validateEnv` integration, not only the pure helper.

Status: partial implementation, final CI pending. The stricter preflight is not yet enforced by a hosted deployment pipeline; source inspection and a passing unit suite cannot close S03. No real deployment secrets/resources are configured here, and actual mail/storage/TLS/bundle/log acceptance remains unexecuted. The reference Docker boot is not treated as production SMTP/S3 acceptance.

Rollback: revert this sprint's code/config changes on its branch. No database or stored-data rollback is required. Do not relax shared production security controls merely to make an invalid configuration boot; correct the environment first. Other sprints must coordinate any further environment changes with S03.
