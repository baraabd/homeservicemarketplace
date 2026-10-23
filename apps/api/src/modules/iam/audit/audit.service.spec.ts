// Unit tests for AuditService. Pins the metadata allowlist — unknown keys
// or sensitive values must never land in the audit_events table.

import type { AuditEventRepository } from '../../../infrastructure/persistence/iam/audit-event.repository';
import { AuditService } from './audit.service';

function makeHarness() {
  const repo = {
    write: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<AuditEventRepository>;
  const svc = new AuditService(repo);
  return { svc, repo };
}

describe('AuditService', () => {
  it('retains R30 evidence identifiers while excluding receipt content, settlement references and notes', async () => {
    const h = makeHarness();
    const identifiers = {
      paymentIntentId: 'intent-r30',
      receiptVersionId: 'receipt-r30',
      receiptInspectionId: 'inspection-r30',
      manualDecisionId: 'decision-r30',
      manualSettlementId: 'settlement-r30',
      manualRefundEventId: 'refund-event-r30',
    };
    await h.svc.record({
      type: 'MONEY_RECEIPT_VIEWED',
      metadata: {
        ...identifiers,
        storageKey: 'financial-receipts/private-object',
        sha256: 'private-evidence-digest',
        settlementReference: 'private-deposit-reference',
        internalNote: 'private-reviewer-note',
        receiptContents: 'private-original-bytes',
      },
    });
    expect(h.repo.write.mock.calls[0]![0].metadata).toEqual(identifiers);
  });
  it('writes an audit row with userId, type, ip, userAgent, and requestId', async () => {
    const h = makeHarness();
    await h.svc.record({
      type: 'LOGIN_SUCCESS',
      userId: 'u-1',
      ipAddress: '1.2.3.4',
      userAgent: 'ua',
      requestId: 'req-1',
      metadata: { sessionId: 'sess-1' },
    });
    expect(h.repo.write).toHaveBeenCalledWith(
      {
        userId: 'u-1',
        type: 'LOGIN_SUCCESS',
        metadata: { sessionId: 'sess-1' },
        ipAddress: '1.2.3.4',
        userAgent: 'ua',
        requestId: 'req-1',
      },
      undefined,
    );
  });

  it('strips metadata keys that are not in the allowlist (no PII / tokens / secrets)', async () => {
    const h = makeHarness();
    await h.svc.record({
      type: 'LOGIN_FAILED',
      metadata: {
        sessionId: 'ok',
        email: 'user@example.com', // must be stripped
        password: 'should-never-land-here', // must be stripped
        authorization: 'Bearer xyz', // must be stripped
        rawError: { stack: 'internal' }, // non-primitive, dropped regardless
      },
    });
    const written = h.repo.write.mock.calls[0]![0];
    expect(written.metadata).toEqual({ sessionId: 'ok' });
    expect(JSON.stringify(written.metadata)).not.toContain('user@example.com');
    expect(JSON.stringify(written.metadata)).not.toContain('should-never-land-here');
  });

  it('keeps who decided an admin-access request and which one (R18)', async () => {
    const repo = { write: jest.fn().mockResolvedValue(undefined) };
    const svc = new AuditService(repo as never);
    await svc.record({
      type: 'ADMIN_ACCESS_APPROVED' as never,
      userId: 'u-applicant',
      metadata: { adminAccessRequestId: 'aar-1', reviewerUserId: 'admin-1', reason: 'vouched' },
    });
    expect(repo.write.mock.calls[0][0].metadata).toEqual({
      adminAccessRequestId: 'aar-1',
      reviewerUserId: 'admin-1',
      reason: 'vouched',
    });
  });

  it('drops non-primitive values even when the key is allowlisted', async () => {
    const h = makeHarness();
    await h.svc.record({
      type: 'SESSION_REVOKED',
      metadata: { sessionId: { nested: 'object' } as unknown as string },
    });
    expect(h.repo.write.mock.calls[0]![0].metadata).toEqual({});
  });

  it.each([
    'MONEY_COMMAND_ACCEPTED',
    'MONEY_EXTERNAL_EVENT_PROCESSED',
    'MONEY_REFUND_RESULT_RECORDED',
  ] as const)(
    'keeps R24 identifiers for %s while dropping money and external authority payloads',
    async (type) => {
      const h = makeHarness();
      await h.svc.record({
        type,
        metadata: {
          moneyCommandId: 'cmd-r24',
          moneyAction: 'CREATE_INTENT',
          paymentIntentId: 'intent-r24',
          paymentAttemptId: 'attempt-r24',
          moneyExternalEventId: 'event-r24',
          paymentConfirmationId: 'confirmation-r24',
          refundRequestId: 'request-r24',
          refundId: 'refund-r24',
          subscriptionId: 'subscription-r24',
          subscriptionPeriodId: 'period-r24',
          amountMinor: '9007199254740993',
          accountReference: 'private-rail-account',
          debitAccountId: 'private-ledger-account',
          response: { authority: 'private' },
          receiptContents: 'private receipt',
          providerIdempotencyKey: 'private-key',
          rawWebhook: 'private event',
          signature: 'private signature',
        },
      });
      expect(h.repo.write.mock.calls[0]![0].metadata).toEqual({
        moneyCommandId: 'cmd-r24',
        moneyAction: 'CREATE_INTENT',
        paymentIntentId: 'intent-r24',
        paymentAttemptId: 'attempt-r24',
        moneyExternalEventId: 'event-r24',
        paymentConfirmationId: 'confirmation-r24',
        refundRequestId: 'request-r24',
        refundId: 'refund-r24',
        subscriptionId: 'subscription-r24',
        subscriptionPeriodId: 'period-r24',
      });
    },
  );

  it.each(['SUPPORT_TICKET_CREATED', 'SUPPORT_MESSAGE_SENT', 'ADMIN_SUPPORT_REPLIED'] as const)(
    'preserves support identifiers for %s without retaining message content',
    async (type) => {
      const h = makeHarness();
      await h.svc.record({
        type,
        userId: 'u-1',
        metadata: {
          supportTicketId: 'ticket-1',
          supportMessageId: 'message-1',
          subject: 'Private ticket subject',
          body: 'Private message body',
          email: 'requester@example.com',
        },
      });

      expect(h.repo.write.mock.calls[0]![0].metadata).toEqual({
        supportTicketId: 'ticket-1',
        supportMessageId: 'message-1',
      });
    },
  );

  it.each([
    ['ADMIN_SUPPORT_CLOSED', 'OPEN', 'CLOSED'],
    ['ADMIN_SUPPORT_REOPENED', 'CLOSED', 'OPEN'],
  ] as const)('preserves the ticket and status transition for %s', async (type, from, to) => {
    const h = makeHarness();
    await h.svc.record({
      type,
      metadata: {
        supportTicketId: 'ticket-1',
        previousStatus: from,
        newStatus: to,
        body: 'Private closure explanation',
      },
    });

    expect(h.repo.write.mock.calls[0]![0].metadata).toEqual({
      supportTicketId: 'ticket-1',
      previousStatus: from,
      newStatus: to,
    });
  });

  it('propagates repository errors — audit is not best-effort for critical events', async () => {
    const h = makeHarness();
    h.repo.write.mockRejectedValueOnce(new Error('db-down'));
    await expect(h.svc.record({ type: 'REFRESH_REPLAY' })).rejects.toThrow('db-down');
  });

  it('accepts a null userId (e.g., LOGIN_FAILED before the user is known)', async () => {
    const h = makeHarness();
    await h.svc.record({ type: 'LOGIN_FAILED', userId: null });
    expect(h.repo.write.mock.calls[0]![0].userId).toBeNull();
  });
});
