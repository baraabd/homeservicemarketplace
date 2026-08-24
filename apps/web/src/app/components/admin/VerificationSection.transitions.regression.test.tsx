import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 9 — FAILING REGRESSION TEST, written before any implementation.
//
// D-3 (docs/sprint-09/INSPECTION.md): the admin UI renders an enabled Approve
// button for a DRAFT provider, and the backend refuses that transition.
//
//   VerificationSection.tsx
//     const canApprove = status === 'DRAFT' || status === 'PENDING_REVIEW';
//
//   admin-verification.service.ts#approve
//     from: ['PENDING_REVIEW']
//     // "Phase 4: DRAFT is NO LONGER an approvable source state."
//
// Clicking it produces a 409 the reviewer cannot act on. Worse than the dead
// click is what it teaches: the UI is asserting an authorization rule it does
// not own, which is the drift ADR 0006 exists to prevent. The client must not
// carry its own copy of the transition table.
//
// This is asserted against the SOURCE rather than through a rendered click,
// deliberately. A render test proves the button is disabled for the one status
// someone thought to fixture; reading the rule proves no hardcoded transition
// table exists at all, which is the actual requirement.
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'VerificationSection.tsx'), 'utf8');

describe('Sprint 9 regression — the admin UI must not own the transition table', () => {
  it('does not offer Approve for a DRAFT provider', () => {
    // The backend's approvable source set is exactly ['PENDING_REVIEW'].
    // Any client-side rule that admits DRAFT contradicts it.
    const approvesDraft = /canApprove\s*=\s*[^;]*['"]DRAFT['"]/.test(source);
    expect(approvesDraft).toBe(false);
  });

  it('derives available actions from the server rather than hardcoding statuses', () => {
    // The fix is not "delete DRAFT from the list" — that leaves a second copy
    // of the rule which drifts again on the next backend change. The component
    // must render the actions the server says are available.
    const hardcoded = /const\s+can(Approve|Reject|Suspend|Reactivate)\s*=\s*status\s*===/.test(
      source,
    );
    expect(hardcoded).toBe(false);
  });

  it('renders real evidence rather than a documents placeholder', () => {
    // The detail drawer currently mounts <DocumentsPlaceholder />, whose copy
    // reads "Document storage ships in a follow-up sprint." This is that
    // sprint. A reviewer approving against a placeholder is approving against
    // no evidence at all, which is D-4 seen from the UI side.
    //
    // Matching the component name, not the word "document" — the DOM global
    // makes any loose /document/i match trivially true.
    expect(source).not.toMatch(/DocumentsPlaceholder/);
  });
});
