import { Prisma } from '@homeservicemarketplace/database';
import type {
  AdminProviderReview,
  ApproveAdminProviderReviewRequest,
} from '@homeservicemarketplace/contracts';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { AdminProviderReviewService } from './provider-review.service';
import { reviewFixture } from '../../../../test/fixtures/admin-provider-review.fixture';
import { reviewHash, reviewRevision } from './provider-review.policy';

const actor = { id: 'admin-1', roles: ['admin'] } as AuthenticatedUser;
function fixture() {
  const data = reviewFixture();
  const db = {
    providerOnboardingSubmission: {
      findFirst: jest.fn().mockResolvedValue(data.submission),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notification: { create: jest.fn().mockResolvedValue({ id: 'notification-1' }) },
  };
  const tx = { run: jest.fn(async (fn: (client: unknown) => unknown) => fn(db)) };
  const repository = { load: jest.fn().mockResolvedValue(data) };
  const permissions = {
    resolveFreshForUser: jest
      .fn()
      .mockResolvedValue(
        new Set(['user:read:any', 'verification:decide', 'verification:evidence:view']),
      ),
  };
  const providers = { decideIfInStatus: jest.fn().mockResolvedValue(1) };
  const workflow = {
    approve: jest.fn().mockResolvedValue({ changed: true }),
    requestAction: jest.fn().mockResolvedValue({ changed: true }),
    reverify: jest.fn().mockResolvedValue({ changed: true }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const security = { emitProviderStatusChanged: jest.fn() };
  const service = new AdminProviderReviewService(
    tx as never,
    repository as never,
    permissions as never,
    {} as never,
    {} as never,
    providers as never,
    workflow as never,
    audit as never,
    outbox as never,
    security as never,
  );
  const response = { provider: { userId: 'owner-1' } } as AdminProviderReview;
  jest.spyOn(service, 'get').mockResolvedValue(response);
  const input: ApproveAdminProviderReviewRequest = {
    submissionId: 'submission-1',
    expectedRevision: reviewRevision(data),
    idempotencyKey: 'decision-key-1',
    reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
    note: 'Private administrative reasoning',
  };
  return {
    service,
    data,
    db,
    tx,
    repository,
    permissions,
    providers,
    workflow,
    audit,
    outbox,
    security,
    input,
  };
}

describe('unified provider review decisions', () => {
  it('forwards one serializable transaction through submission, onboarding, case, grant, audit and durable notification', async () => {
    const f = fixture();
    await expect(f.service.approve(actor, 'provider-1', f.input)).resolves.toMatchObject({
      changed: true,
    });
    expect(f.tx.run).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
    expect(f.permissions.resolveFreshForUser).toHaveBeenCalledWith(actor.id, f.db);
    expect(f.providers.decideIfInStatus).toHaveBeenCalledWith(
      'provider-1',
      expect.objectContaining({ to: 'ACTIVE', onboardingState: 'ACCEPTED' }),
      f.db,
    );
    expect(f.workflow.approve).toHaveBeenCalledWith(
      actor.id,
      expect.objectContaining({ caseId: 'case-1' }),
      { transaction: f.db, suppressNotification: true },
    );
    expect(f.audit.record).toHaveBeenCalledWith(expect.any(Object), f.db);
    expect(f.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'provider.review.decided' }),
      f.db,
    );
    expect(JSON.stringify(f.db.notification.create.mock.calls)).not.toContain(f.input.note);
    expect(f.security.emitProviderStatusChanged).toHaveBeenCalledTimes(1);
  });

  it('refuses stale revisions before any decision write', async () => {
    const f = fixture();
    f.data.current.profile.phoneNumber = '+19999999999';
    await expect(f.service.approve(actor, 'provider-1', f.input)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'STALE_REVIEW' },
    });
    expect(f.db.providerOnboardingSubmission.updateMany).not.toHaveBeenCalled();
  });

  it('recognizes the exact actor-bound idempotent receipt and rejects altered retry content', async () => {
    const f = fixture();
    f.data.submission!.decisionIdempotencyKey = f.input.idempotencyKey;
    f.data.submission!.decidedByUserId = actor.id;
    f.data.submission!.decidedAt = new Date();
    f.data.submission!.decisionRequestHash = reviewHash({
      actorUserId: actor.id,
      providerProfileId: 'provider-1',
      action: 'APPROVE',
      ...f.input,
    });
    await expect(f.service.approve(actor, 'provider-1', f.input)).resolves.toMatchObject({
      changed: false,
    });
    expect(f.db.providerOnboardingSubmission.updateMany).not.toHaveBeenCalled();
    await expect(
      f.service.approve(actor, 'provider-1', { ...f.input, note: 'Different content' }),
    ).rejects.toMatchObject({ status: 409, details: { reason: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('honors permission revocation inside the decision transaction', async () => {
    const f = fixture();
    f.permissions.resolveFreshForUser
      .mockResolvedValueOnce(new Set(['user:read:any', 'verification:decide']))
      .mockResolvedValueOnce(new Set());
    await expect(f.service.approve(actor, 'provider-1', f.input)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.db.providerOnboardingSubmission.updateMany).not.toHaveBeenCalled();
  });

  it('requires evidence access before approving an unverified identity', async () => {
    const f = fixture();
    f.permissions.resolveFreshForUser.mockResolvedValue(
      new Set(['user:read:any', 'verification:decide']),
    );
    await expect(f.service.approve(actor, 'provider-1', f.input)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('returns targeted provider feedback while keeping the private note out of the feedback, audit and notification', async () => {
    const f = fixture();
    await f.service.requestChanges(actor, 'provider-1', {
      ...f.input,
      feedback: [
        {
          taskId: 'WORK_AREA',
          reasonCode: 'INCOMPLETE',
          providerMessage: 'Please select your city.',
        },
      ],
    });
    const stored = f.db.providerOnboardingSubmission.updateMany.mock.calls[0][0].data;
    expect(stored.decision).toBe('RETURNED');
    expect(stored.reviewFeedback.items[0]).toMatchObject({
      taskId: 'WORK_AREA',
      providerMessage: 'Please select your city.',
    });
    expect(stored.decisionNote).toBe(f.input.note);
    expect(JSON.stringify(stored.reviewFeedback)).not.toContain(f.input.note);
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain(f.input.note);
    expect(f.workflow.approve).not.toHaveBeenCalled();
  });

  it('never publishes a success when the case/grant transaction fails', async () => {
    const f = fixture();
    f.workflow.approve.mockRejectedValue(new Error('simulated database failure'));
    await expect(f.service.approve(actor, 'provider-1', f.input)).rejects.toThrow(
      'simulated database failure',
    );
    expect(f.security.emitProviderStatusChanged).not.toHaveBeenCalled();
    expect(f.outbox.enqueue).not.toHaveBeenCalled();
  });
});

describe('evidence correction unlocks the provider task atomically', () => {
  it.each(['SUBMITTED', 'IN_REVIEW'])(
    'returns a %s case inside the application decision transaction',
    async (state) => {
      const f = fixture();
      f.data.verificationCase!.state = state as never;
      await f.service.requestChanges(actor, 'provider-1', {
        ...f.input,
        expectedRevision: reviewRevision(f.data),
        feedback: [
          {
            taskId: 'BASICS_IDENTITY',
            field: 'verificationDocuments',
            reasonCode: 'DOCUMENT_ILLEGIBLE',
            providerMessage: 'Replace the blurred identity image.',
          },
        ],
      });
      expect(f.workflow.requestAction).toHaveBeenCalledWith(
        actor.id,
        { caseId: 'case-1', expectedState: state, reasonCode: 'OTHER' },
        { transaction: f.db, suppressNotification: true },
      );
      expect(f.workflow.reverify).not.toHaveBeenCalled();
    },
  );

  it('renews a verified case before requesting replacement evidence', async () => {
    const f = fixture();
    f.data.verificationCase!.state = 'VERIFIED';
    await f.service.requestChanges(actor, 'provider-1', {
      ...f.input,
      expectedRevision: reviewRevision(f.data),
      feedback: [
        {
          taskId: 'BASICS_IDENTITY',
          field: 'identityDocument',
          reasonCode: 'DOCUMENT_EXPIRED',
          providerMessage: 'Provide your renewed identity document.',
        },
      ],
    });
    expect(f.workflow.reverify).toHaveBeenCalledWith(
      actor.id,
      { caseId: 'case-1', expectedState: 'VERIFIED', reasonCode: 'OTHER' },
      { transaction: f.db, suppressNotification: true },
    );
  });

  it.each(['DRAFT', 'ACTION_REQUIRED'])('retains an already editable %s case', async (state) => {
    const f = fixture();
    f.data.verificationCase!.state = state as never;
    await f.service.requestChanges(actor, 'provider-1', {
      ...f.input,
      expectedRevision: reviewRevision(f.data),
      feedback: [
        {
          taskId: 'SERVICES_EXPERIENCE',
          field: 'categoryLicense',
          reasonCode: 'LICENSE_MISSING',
          providerMessage: 'Upload the trade license.',
        },
      ],
    });
    expect(f.workflow.requestAction).not.toHaveBeenCalled();
    expect(f.workflow.reverify).not.toHaveBeenCalled();
  });

  it('leaves identity untouched for a personal profile correction', async () => {
    const f = fixture();
    await f.service.requestChanges(actor, 'provider-1', {
      ...f.input,
      feedback: [
        {
          taskId: 'BASICS_IDENTITY',
          field: 'phoneNumber',
          reasonCode: 'INCORRECT',
          providerMessage: 'Correct your contact number.',
        },
      ],
    });
    expect(f.workflow.requestAction).not.toHaveBeenCalled();
    expect(f.workflow.reverify).not.toHaveBeenCalled();
  });

  it('fails the decision before notification if the evidence task cannot be unlocked', async () => {
    const f = fixture();
    f.workflow.requestAction.mockRejectedValue(new Error('case conflict'));
    await expect(
      f.service.requestChanges(actor, 'provider-1', {
        ...f.input,
        feedback: [
          {
            taskId: 'BASICS_IDENTITY',
            field: 'identityDocument',
            reasonCode: 'DOCUMENT_ILLEGIBLE',
            providerMessage: 'Replace image.',
          },
        ],
      }),
    ).rejects.toThrow('case conflict');
    expect(f.db.notification.create).not.toHaveBeenCalled();
    expect(f.security.emitProviderStatusChanged).not.toHaveBeenCalled();
  });
});
