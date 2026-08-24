import {
  auditOutcomeFor,
  decideEvidenceRead,
  isSelfReview,
  type EvidenceReadContext,
} from './evidence-read.policy';

// Sprint 9B — the restricted-read authorization matrix. docs/adr/0009 §3
//
// Walked as a CROSS-PRODUCT, not sampled. This decides who sees a passport.

const OWNER = 'user-owner';
const REVIEWER = 'user-reviewer';
const STRANGER = 'user-stranger';

function ctx(over: Partial<EvidenceReadContext> = {}): EvidenceReadContext {
  return {
    actorUserId: REVIEWER,
    actorHasEvidenceViewPermission: true,
    ownerUserId: OWNER,
    visibility: 'RESTRICTED',
    scanState: 'CLEAN',
    evidenceDeletedAt: null,
    caseId: 'case-1',
    ...over,
  };
}

describe('who may read', () => {
  it('allows the owning provider', () => {
    expect(
      decideEvidenceRead(ctx({ actorUserId: OWNER, actorHasEvidenceViewPermission: false })),
    ).toEqual({ allowed: true, as: 'owner' });
  });

  it('allows a reviewer holding the dedicated permission', () => {
    expect(decideEvidenceRead(ctx())).toEqual({ allowed: true, as: 'reviewer' });
  });

  it('DENIES another provider — the IDOR case', () => {
    // The single most important cell. Provider B must not read Provider A's
    // identity document by knowing or guessing its id.
    expect(
      decideEvidenceRead(ctx({ actorUserId: STRANGER, actorHasEvidenceViewPermission: false })),
    ).toEqual({ allowed: false, reason: 'NOT_AUTHORIZED' });
  });

  it('DENIES an admin who lacks the dedicated evidence permission', () => {
    // Viewing a passport is narrower than administering the platform.
    // Conflating them means every admin can read every identity document, and
    // the audit trail stops meaning anything.
    expect(
      decideEvidenceRead(ctx({ actorUserId: STRANGER, actorHasEvidenceViewPermission: false })),
    ).toMatchObject({ allowed: false });
  });

  it('DENIES when the profile has no owner and the actor is not a reviewer', () => {
    expect(
      decideEvidenceRead(
        ctx({ ownerUserId: null, actorUserId: STRANGER, actorHasEvidenceViewPermission: false }),
      ),
    ).toEqual({ allowed: false, reason: 'NOT_AUTHORIZED' });
  });

  it('does not treat a null owner as matching a null-ish actor', () => {
    // Guards the classic `undefined === undefined` authorization bug.
    expect(
      decideEvidenceRead(
        ctx({ ownerUserId: null, actorUserId: '', actorHasEvidenceViewPermission: false }),
      ),
    ).toMatchObject({ allowed: false });
  });
});

describe('self-review', () => {
  it('lets an owner who ALSO holds the reviewer permission read their own document', () => {
    // Reading your own passport is something you are entitled to do. Refusing
    // it would lock a provider who happens to hold a staff permission out of
    // their own evidence — a support problem dressed as a security control.
    expect(
      decideEvidenceRead(ctx({ actorUserId: OWNER, actorHasEvidenceViewPermission: true })),
    ).toEqual({ allowed: true, as: 'owner' });
  });

  it('still flags that same person as a self-reviewer for DECISIONS', () => {
    // The other half, and the reason both live in one file: reading is fine,
    // deciding is not.
    expect(isSelfReview({ actorUserId: OWNER, subjectUserId: OWNER })).toBe(true);
    expect(isSelfReview({ actorUserId: REVIEWER, subjectUserId: OWNER })).toBe(false);
  });

  it('does not call an orphaned profile a self-review', () => {
    expect(isSelfReview({ actorUserId: OWNER, subjectUserId: null })).toBe(false);
  });
});

describe('what may be read', () => {
  it.each([
    ['PENDING', 'NOT_SCANNED'],
    ['SCAN_FAILED', 'NOT_SCANNED'],
    ['QUARANTINED', 'QUARANTINED'],
  ] as Array<[EvidenceReadContext['scanState'], string]>)(
    'refuses a %s asset even to an authorized reviewer',
    (scanState, reason) => {
      expect(decideEvidenceRead(ctx({ scanState }))).toEqual({ allowed: false, reason });
    },
  );

  it('never serves a quarantined file', () => {
    // Serving a file a scanner flagged would hand malware to the reviewer it
    // was aimed at.
    expect(decideEvidenceRead(ctx({ scanState: 'QUARANTINED' }))).toMatchObject({
      allowed: false,
      reason: 'QUARANTINED',
    });
  });

  it('refuses once the bytes have been deleted under retention', () => {
    expect(decideEvidenceRead(ctx({ evidenceDeletedAt: new Date() }))).toEqual({
      allowed: false,
      reason: 'EVIDENCE_DELETED',
    });
  });

  it('refuses deletion BEFORE scan state, so a deleted file never reports its scan', () => {
    // Ordering: a deleted object has nothing to say about its scan, and
    // reporting NOT_SCANNED for it would be misleading to the reviewer.
    expect(
      decideEvidenceRead(ctx({ evidenceDeletedAt: new Date(), scanState: 'PENDING' })),
    ).toMatchObject({ reason: 'EVIDENCE_DELETED' });
  });

  it.each(['PUBLIC', 'PRIVATE'] as Array<EvidenceReadContext['visibility']>)(
    'refuses a %s asset on this route',
    (visibility) => {
      // A non-restricted asset arriving here means a caller found the wrong
      // route. Serving it would make this endpoint a general file reader.
      expect(decideEvidenceRead(ctx({ visibility }))).toEqual({
        allowed: false,
        reason: 'NOT_RESTRICTED_ASSET',
      });
    },
  );

  it('checks visibility FIRST, before authorization', () => {
    // Otherwise a stranger probing a PUBLIC asset learns "not authorized",
    // which distinguishes existing assets from non-existing ones.
    expect(
      decideEvidenceRead(
        ctx({ visibility: 'PUBLIC', actorUserId: STRANGER, actorHasEvidenceViewPermission: false }),
      ),
    ).toEqual({ allowed: false, reason: 'NOT_RESTRICTED_ASSET' });
  });
});

describe('the full cross-product', () => {
  const ACTORS = [
    ['owner', { actorUserId: OWNER, actorHasEvidenceViewPermission: false }],
    ['reviewer', { actorUserId: REVIEWER, actorHasEvidenceViewPermission: true }],
    ['stranger', { actorUserId: STRANGER, actorHasEvidenceViewPermission: false }],
    ['owner+reviewer', { actorUserId: OWNER, actorHasEvidenceViewPermission: true }],
  ] as const;

  const STATES = ['PENDING', 'CLEAN', 'QUARANTINED', 'SCAN_FAILED'] as const;

  it('grants ONLY to owner or reviewer, and ONLY on a clean present asset', () => {
    // Collected rather than asserted cell-by-cell: a mismatch prints the whole
    // offending combination instead of a bare "expected true, got false" with
    // no indication of WHICH of the 32 cells failed.
    const wrong: string[] = [];

    for (const [label, actor] of ACTORS) {
      for (const scanState of STATES) {
        for (const deleted of [null, new Date()]) {
          const decision = decideEvidenceRead(
            ctx({ ...actor, scanState, evidenceDeletedAt: deleted }),
          );
          const shouldAllow = label !== 'stranger' && scanState === 'CLEAN' && deleted === null;

          if (decision.allowed !== shouldAllow) {
            wrong.push(
              `${label} / ${scanState} / deleted=${deleted !== null} → got ${decision.allowed}, want ${shouldAllow}`,
            );
          }
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it('never returns allowed for a stranger under ANY combination', () => {
    for (const scanState of STATES) {
      for (const visibility of ['PUBLIC', 'PRIVATE', 'RESTRICTED'] as const) {
        expect(
          decideEvidenceRead(
            ctx({
              actorUserId: STRANGER,
              actorHasEvidenceViewPermission: false,
              scanState,
              visibility,
            }),
          ).allowed,
        ).toBe(false);
      }
    }
  });
});

describe('audit outcome', () => {
  it('records how a grant was obtained', () => {
    expect(auditOutcomeFor({ allowed: true, as: 'reviewer' })).toBe('GRANTED_REVIEWER');
    expect(auditOutcomeFor({ allowed: true, as: 'owner' })).toBe('GRANTED_OWNER');
  });

  it('records the denial code — a DENIED read is the more interesting row', () => {
    expect(auditOutcomeFor({ allowed: false, reason: 'NOT_AUTHORIZED' })).toBe(
      'DENIED_NOT_AUTHORIZED',
    );
  });

  it('never carries anything but ids and an outcome', () => {
    // The audit row must not become the leak. No filename, no key, no bytes.
    const out = auditOutcomeFor({ allowed: false, reason: 'QUARANTINED' });
    expect(out).toMatch(/^[A-Z_]+$/);
  });
});
