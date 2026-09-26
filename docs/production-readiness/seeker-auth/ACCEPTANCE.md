# S04 — post-auth boundary and session-cache repair

Base: `66e336cb4823802aabacc536584972aa43056d23`; final SHA and run links are in the PR. Mode: integration/bug fix. No new UI design, schema, IAM server semantics, feature flags, routes, dependencies or S03 environment changes.

## Proven source defects and repair

`GuestOnly` passed router returnTo state directly into a resolver which trusted any nonempty string; the login page's separate lightweight check did not protect that caller. The shared final resolver now rejects external/protocol-relative/backslash/control/malformed targets and normalized auth-entry loops, preserving valid deep-link query/hash data and intent fallback. Theme selection now handles Provider/Admin root paths with query strings correctly. API role/capability checks are unchanged; destination selection grants no permission.

Clearing auth/me without cancelling its in-flight fetch allowed a late old response to replace the null session. Logout and session-expired now use the same cancel-before-clear helper; non-auth query data is purged while retaining the mounted auth observer. A subsequent intentional login remains possible.

## Evidence

New targeted tests exercise unsafe targets and real TanStack Query cancellation with a controlled late response, not a fake assertion that a filename proves security. Local global-TypeScript transpilation and 53 pure sanitizer assertions were executed; repository-pinned Vitest/typecheck/build and real-browser/API/DB gates must pass on the PR head. Existing auth-cookie, real SMTP-catcher, API session/RBAC and web routing suites remain enabled. No timeout, skip or security gate was relaxed.

## Scope still open

This is a substantive S04 repair, not full Seeker identity certification. Full Arabic/English/360px keyboard/error journeys, UI-driven registration/recovery against the real backend/mail transport, disabled/unverified accounts and hosted TLS topology must all have explicit final-head evidence before S04 is complete. Existing generic CI success is not substituted for those journeys. A failed network logout clears local UI but cannot itself prove that an unreachable server revoked its HttpOnly session; that residual behavior is not concealed by these cache tests.

Rollback: revert the isolated auth helper/provider/resolver changes. No stored data or runtime environment rollback is needed. No merge or deployment performed.
