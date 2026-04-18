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

  it('drops non-primitive values even when the key is allowlisted', async () => {
    const h = makeHarness();
    await h.svc.record({
      type: 'SESSION_REVOKED',
      metadata: { sessionId: { nested: 'object' } as unknown as string },
    });
    expect(h.repo.write.mock.calls[0]![0].metadata).toEqual({});
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
