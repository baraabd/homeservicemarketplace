import type {
  AuditEvent,
  ProviderProfile,
  ProviderProfileStatus,
} from '@homeservicemarketplace/database';

import type { AuditEventRepository } from '../../../infrastructure/persistence/iam/audit-event.repository';
import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { NotificationsService } from '../../notifications/notifications.service';
import { SecurityEventsBus } from '../../../shared/security-events/security-events.bus';
import type { AdminAuditService } from '../admin-audit.service';
import { AdminVerificationService } from './admin-verification.service';

const tx: TransactionRunner = {
  run: <T>(fn: (t: undefined) => Promise<T>) => fn(undefined),
} as unknown as TransactionRunner;

function makeProfile(over: Partial<ProviderProfile> = {}): ProviderProfile & {
  user: { id: string; email: string } | null;
} {
  return {
    id: 'pp-1',
    userId: 'user-prov-1',
    displayName: 'Ada L.',
    initials: 'AL',
    avatarUrl: null,
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: false,
    topPro: false,
    bio: null,
    headline: null,
    phoneNumber: null,
    serviceAreaCity: null,
    serviceAreaCountry: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    availability: 'OFFLINE',
    status: 'PENDING_REVIEW',
    createdAt: new Date('2026-04-30T00:00:00Z'),
    updatedAt: new Date('2026-04-30T00:00:00Z'),
    deletedAt: null,
    ...over,
    user: { id: 'user-prov-1', email: 'p@example.com' },
  } as unknown as ProviderProfile & { user: { id: string; email: string } | null };
}

interface Mocks {
  providers: ProviderProfileRepository;
  notifications: NotificationsService;
  audit: AdminAuditService;
  auditEvents: AuditEventRepository;
  securityEvents: SecurityEventsBus;
}

function makeMocks(
  profile: ReturnType<typeof makeProfile> | null,
  auditRows: AuditEvent[] = [],
): Mocks {
  const reloaded = profile ? { ...profile, status: 'ACTIVE' as ProviderProfileStatus } : null;
  let call = 0;
  return {
    providers: {
      findByIdForAdmin: jest.fn().mockImplementation(() => {
        call += 1;
        return Promise.resolve(call === 1 ? profile : reloaded);
      }),
      listForAdmin: jest.fn().mockResolvedValue(profile ? [profile] : []),
      updateStatusById: jest.fn().mockResolvedValue(profile),
      // Phase 4: the state-machine edge is now enforced by a status-scoped
      // updateMany, so the write reports how many rows it actually moved.
      // 1 = this caller won; 0 = a concurrent reviewer got there first.
      decideIfInStatus: jest.fn().mockResolvedValue(1),
      // Sprint 9B.29: the decision is also stamped onto the submission row it
      // decided, so the history can answer who decided an application and how.
      stampSubmissionDecision: jest.fn().mockResolvedValue(1),
      updateReviewNotesById: jest
        .fn()
        .mockImplementation((_id, notes) =>
          Promise.resolve(profile ? { ...profile, reviewNotes: notes } : null),
        ),
    } as unknown as ProviderProfileRepository,
    notifications: {
      createForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    audit: {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AdminAuditService,
    auditEvents: {
      listForProviderProfile: jest.fn().mockResolvedValue(auditRows),
    } as unknown as AuditEventRepository,
    // D-4: real bus, so the emitted payloads can be asserted directly.
    securityEvents: new SecurityEventsBus(),
  };
}

function makeService(m: Mocks): AdminVerificationService {
  return new AdminVerificationService(
    m.providers,
    m.notifications,
    m.audit,
    m.auditEvents,
    tx,
    m.securityEvents,
  );
}

describe('AdminVerificationService', () => {
  it('approve: PENDING_REVIEW → ACTIVE writes audit + notifies provider', async () => {
    const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
    await makeService(m).approve('admin-1', 'pp-1', 'looks good');
    expect(m.providers.decideIfInStatus).toHaveBeenCalledWith(
      'pp-1',
      expect.objectContaining({ to: 'ACTIVE', reviewedByUserId: 'admin-1' }),
      undefined,
    );
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADMIN_PROVIDER_APPROVED' }),
      undefined,
    );
    expect(m.notifications.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-prov-1' }),
      undefined,
    );
  });

  it('approve: 409 if already ACTIVE', async () => {
    const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
    await expect(makeService(m).approve('admin-1', 'pp-1', null)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reject: writes ADMIN_PROVIDER_REJECTED audit', async () => {
    const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
    await makeService(m).reject('admin-1', 'pp-1', 'incomplete docs');
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADMIN_PROVIDER_REJECTED',
        metadata: expect.objectContaining({ reason: 'incomplete docs' }),
      }),
      undefined,
    );
  });

  it('reject: 409 if already REJECTED', async () => {
    const m = makeMocks(makeProfile({ status: 'REJECTED' }));
    await expect(makeService(m).reject('admin-1', 'pp-1', 'x')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('suspend: only ACTIVE providers may be suspended', async () => {
    const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
    await expect(makeService(m).suspend('admin-1', 'pp-1', 'misuse')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('suspend: ACTIVE → SUSPENDED writes audit', async () => {
    const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
    await makeService(m).suspend('admin-1', 'pp-1', 'misuse');
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADMIN_PROVIDER_SUSPENDED',
        metadata: expect.objectContaining({ reason: 'misuse' }),
      }),
      undefined,
    );
  });

  it('suspend: empty reason omits metadata.reason and uses generic notification (Sprint 5.1.4)', async () => {
    const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
    await makeService(m).suspend('admin-1', 'pp-1', undefined);
    const auditCall = (m.audit.record as jest.Mock).mock.calls[0][0];
    expect(auditCall.metadata).not.toHaveProperty('reason');
    const notifyCall = (m.notifications.createForUser as jest.Mock).mock.calls[0][0];
    expect(notifyCall.body).toBe('Your provider account was suspended.');
  });

  it('reject: empty reason omits metadata.reason and uses generic notification (Sprint 5.1.4)', async () => {
    const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
    await makeService(m).reject('admin-1', 'pp-1', undefined);
    const auditCall = (m.audit.record as jest.Mock).mock.calls[0][0];
    expect(auditCall.metadata).not.toHaveProperty('reason');
    const notifyCall = (m.notifications.createForUser as jest.Mock).mock.calls[0][0];
    expect(notifyCall.body).toBe('Your provider application was rejected.');
  });

  // Sprint 9B.29 — the ONBOARDING axis moves with the status.
  //
  // Leaving it behind was a deadlock: a rejected application kept the
  // `DOCUMENTS_REQUIRED` its submission wrote, so `lifecycleState` never
  // reported RETURNED, `assertEditable` refused the correction with a 409, and
  // the submit claim — which accepts only NULL/NOT_STARTED/DRAFT/RETURNED —
  // silently matched nothing. The provider was told to wait for a decision that
  // had already been made. `phase3-journey-d-returned-correction.integration.spec.ts`
  // drives the whole loop against a real database; these pin the mapping.
  describe('the onboarding axis moves with the decision', () => {
    it('rejection returns the application so it can be corrected', async () => {
      const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
      await makeService(m).reject('admin-1', 'pp-1', 'Headline is too vague.');
      expect(m.providers.decideIfInStatus).toHaveBeenCalledWith(
        'pp-1',
        expect.objectContaining({ to: 'REJECTED', onboardingState: 'RETURNED' }),
        undefined,
      );
      expect(m.providers.stampSubmissionDecision).toHaveBeenCalledWith(
        'pp-1',
        { decidedByUserId: 'admin-1', decision: 'RETURNED' },
        undefined,
      );
    });

    it('approval accepts the application', async () => {
      const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
      await makeService(m).approve('admin-1', 'pp-1', null);
      expect(m.providers.decideIfInStatus).toHaveBeenCalledWith(
        'pp-1',
        expect.objectContaining({ to: 'ACTIVE', onboardingState: 'ACCEPTED' }),
        undefined,
      );
      expect(m.providers.stampSubmissionDecision).toHaveBeenCalledWith(
        'pp-1',
        { decidedByUserId: 'admin-1', decision: 'ACCEPTED' },
        undefined,
      );
    });

    it('suspension keeps the application ACCEPTED — it is a conduct decision', async () => {
      // Rewriting a suspended provider's onboarding axis would send them back
      // into the wizard to fix something the wizard cannot fix.
      const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
      await makeService(m).suspend('admin-1', 'pp-1', 'Under investigation.');
      expect(m.providers.decideIfInStatus).toHaveBeenCalledWith(
        'pp-1',
        expect.objectContaining({ to: 'SUSPENDED', onboardingState: 'ACCEPTED' }),
        undefined,
      );
    });

    // Sprint 9B.29 — moving the AXIS and DECIDING THE APPLICATION are two
    // different things, and conflating them was a real defect.
    //
    // `suspend` and `reactivate` both map the onboarding axis to ACCEPTED, the
    // same value `approve` maps to. Driving the submission stamp off that
    // mapping meant a suspension stamped any still-undecided application with
    // a verdict, a date and a reviewer — from an operator making a CONDUCT
    // decision who had never read it. Two undecided submissions are reachable
    // through ordinary use (submit → withdraw → submit), so this was not
    // hypothetical. `phase3-submission-stamping-audit.integration.spec.ts`
    // demonstrates it end to end.
    it('suspension does NOT decide a submission', async () => {
      const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
      await makeService(m).suspend('admin-1', 'pp-1', 'Under investigation.');
      expect(m.providers.stampSubmissionDecision).not.toHaveBeenCalled();
    });

    it('reactivation does NOT decide a submission', async () => {
      // Lifting a suspension says nothing about the paperwork.
      const m = makeMocks(makeProfile({ status: 'SUSPENDED' }));
      await makeService(m).reactivate('admin-1', 'pp-1');
      expect(m.providers.decideIfInStatus).toHaveBeenCalledWith(
        'pp-1',
        expect.objectContaining({ to: 'ACTIVE', onboardingState: 'ACCEPTED' }),
        undefined,
      );
      expect(m.providers.stampSubmissionDecision).not.toHaveBeenCalled();
    });
  });

  it('reactivate: SUSPENDED → ACTIVE writes audit + notifies (Sprint 5.1.4)', async () => {
    const m = makeMocks(makeProfile({ status: 'SUSPENDED' }));
    await makeService(m).reactivate('admin-1', 'pp-1');
    expect(m.providers.decideIfInStatus).toHaveBeenCalledWith(
      'pp-1',
      expect.objectContaining({
        from: ['SUSPENDED'],
        to: 'ACTIVE',
        reviewedByUserId: 'admin-1',
        // Lifting a suspension must clear any stale rejection reason so the
        // reactivated provider is not shown a message about a past decision.
        rejectionReason: null,
      }),
      undefined,
    );
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADMIN_PROVIDER_APPROVED',
        metadata: expect.objectContaining({
          reactivate: true,
          previousStatus: 'SUSPENDED',
          newStatus: 'ACTIVE',
        }),
      }),
      undefined,
    );
    expect(m.notifications.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-prov-1',
        title: 'Provider account reactivated',
      }),
      undefined,
    );
  });

  it('reactivate: 409 if not currently SUSPENDED', async () => {
    const m = makeMocks(makeProfile({ status: 'ACTIVE' }));
    await expect(makeService(m).reactivate('admin-1', 'pp-1')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reactivate: 404 if profile is missing', async () => {
    const m = makeMocks(null);
    await expect(makeService(m).reactivate('admin-1', 'pp-missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('list returns admin summary including userId + email', async () => {
    const m = makeMocks(makeProfile());
    const out = await makeService(m).list({});
    expect(out.items[0]).toMatchObject({
      id: 'pp-1',
      userId: 'user-prov-1',
      email: 'p@example.com',
    });
  });

  it('detail returns 404 when missing', async () => {
    const m = makeMocks(null);
    await expect(makeService(m).detail('pp-missing')).rejects.toMatchObject({ status: 404 });
  });

  // ── Sprint 6.2 — review notes ──────────────────────────────────

  describe('updateReviewNotes', () => {
    it('persists notes + writes ADMIN_PROVIDER_NOTES_UPDATED audit', async () => {
      const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
      await makeService(m).updateReviewNotes('admin-1', 'pp-1', 'Suspicious documents');
      expect(m.providers.updateReviewNotesById).toHaveBeenCalledWith(
        'pp-1',
        'Suspicious documents',
        undefined,
      );
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: 'admin-1',
          type: 'ADMIN_PROVIDER_NOTES_UPDATED',
          metadata: expect.objectContaining({
            providerProfileId: 'pp-1',
            previousNotesLength: 0,
            newNotesLength: 20,
          }),
        }),
        undefined,
      );
    });

    it('does NOT fan out a user-facing notification (admin-private)', async () => {
      const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
      await makeService(m).updateReviewNotes('admin-1', 'pp-1', 'note');
      expect(m.notifications.createForUser).not.toHaveBeenCalled();
    });

    it('skips the DB write when notes are unchanged (idempotent), still audits', async () => {
      const m = makeMocks(
        makeProfile({ status: 'PENDING_REVIEW' }) as unknown as ProviderProfile & {
          user: { id: string; email: string } | null;
          reviewNotes: string;
        },
      );
      // Patch the makeProfile result to have an existing note string
      // by intercepting findByIdForAdmin's first return.
      (m.providers.findByIdForAdmin as jest.Mock).mockReset();
      (m.providers.findByIdForAdmin as jest.Mock).mockResolvedValue({
        ...makeProfile({ status: 'PENDING_REVIEW' }),
        reviewNotes: 'same',
      });
      await makeService(m).updateReviewNotes('admin-1', 'pp-1', 'same');
      expect(m.providers.updateReviewNotesById).not.toHaveBeenCalled();
      expect(m.audit.record).toHaveBeenCalled();
    });

    it('returns 404 when the provider profile is missing', async () => {
      const m = makeMocks(null);
      await expect(
        makeService(m).updateReviewNotes('admin-1', 'pp-missing', 'x'),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });
  });

  describe('getAuditHistory', () => {
    it('queries the repo with the providerProfileId + cursor pagination', async () => {
      const m = makeMocks(makeProfile({ status: 'PENDING_REVIEW' }));
      await makeService(m).getAuditHistory('pp-1', { limit: 25 });
      expect(m.auditEvents.listForProviderProfile).toHaveBeenCalledWith(
        expect.objectContaining({ providerProfileId: 'pp-1', take: 26 }),
      );
    });

    it('projects audit rows to the contract shape', async () => {
      const auditRow = {
        id: 'ae-1',
        userId: 'admin-1',
        type: 'ADMIN_PROVIDER_APPROVED',
        metadata: { providerProfileId: 'pp-1', previousStatus: 'PENDING_REVIEW' },
        ipAddress: null,
        userAgent: null,
        requestId: null,
        createdAt: new Date('2026-05-02T00:00:00Z'),
      } as unknown as AuditEvent;
      const m = makeMocks(makeProfile({ status: 'ACTIVE' }), [auditRow]);
      const out = await makeService(m).getAuditHistory('pp-1', {});
      expect(out.items).toHaveLength(1);
      expect(out.items[0]).toMatchObject({
        id: 'ae-1',
        type: 'ADMIN_PROVIDER_APPROVED',
        adminUserId: 'admin-1',
      });
    });

    it('emits nextCursor when the page overflows', async () => {
      const rows = ['a', 'b', 'c'].map(
        (id) =>
          ({
            id,
            userId: 'admin-1',
            type: 'ADMIN_PROVIDER_APPROVED',
            metadata: {},
            ipAddress: null,
            userAgent: null,
            requestId: null,
            createdAt: new Date('2026-05-02T00:00:00Z'),
          }) as unknown as AuditEvent,
      );
      const m = makeMocks(makeProfile(), rows);
      const out = await makeService(m).getAuditHistory('pp-1', { limit: 2 });
      expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(out.nextCursor).toBe('b');
    });

    it('returns 404 when the provider profile is missing (no IDOR cover)', async () => {
      const m = makeMocks(null);
      await expect(makeService(m).getAuditHistory('pp-missing', {})).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
