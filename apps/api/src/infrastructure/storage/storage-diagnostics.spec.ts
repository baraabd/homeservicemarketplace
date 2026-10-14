import {
  StorageFaultError,
  classifyStorageFault,
  keyFingerprint,
  storageFaultEvent,
} from './storage-diagnostics';

describe('storage fault classification (R20)', () => {
  it.each([
    [{ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }, 'missing'],
    [{ name: 'NotFound', $metadata: { httpStatusCode: 404 } }, 'missing'],
    [{ $metadata: { httpStatusCode: 404 } }, 'missing'],
    [{ code: 'ENOENT' }, 'missing'],
    // A wrong bucket is ALSO a 404. Reading it as "missing" would make a
    // configuration error look like a provider who never uploaded.
    [{ name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }, 'misconfigured'],
    [{ name: 'PermanentRedirect', $metadata: { httpStatusCode: 301 } }, 'misconfigured'],
    [new Error('storage-root-namespace-mismatch'), 'misconfigured'],
    [{ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }, 'denied'],
    [{ name: 'InvalidAccessKeyId' }, 'denied'],
    [{ name: 'SignatureDoesNotMatch' }, 'denied'],
    [{ $metadata: { httpStatusCode: 403 } }, 'denied'],
    [{ code: 'EACCES' }, 'denied'],
    [{ code: 'ECONNREFUSED' }, 'unavailable'],
    [{ name: 'TimeoutError' }, 'unavailable'],
    [{ name: 'InternalError', $metadata: { httpStatusCode: 500 } }, 'unavailable'],
    [null, 'unavailable'],
  ])('%j → %s', (err, outcome) => {
    expect(classifyStorageFault(err)).toBe(outcome);
  });

  it('logs a fingerprint, never the key, bucket, principal or message', () => {
    const key = 'verification/case-123/asset-456.pdf';
    const event = storageFaultEvent({
      operation: 'read',
      namespace: 'restricted',
      key,
      err: Object.assign(
        new Error('Access Denied for arn:aws:iam::123456789012:user/x on hsm-id'),
        {
          name: 'AccessDenied',
          $metadata: { httpStatusCode: 403 },
        },
      ),
    });
    expect(event).toEqual({
      msg: 'storage.fault',
      operation: 'read',
      namespace: 'restricted',
      outcome: 'denied',
      kind: 'AccessDenied',
      keyFp: keyFingerprint(key),
    });
    const text = JSON.stringify(event);
    for (const secret of ['case-123', 'asset-456', 'arn:aws', 'hsm-id', '123456789012']) {
      expect(text).not.toContain(secret);
    }
  });

  it('refuses free text in the kind field', () => {
    const event = storageFaultEvent({
      operation: 'read',
      namespace: 'public',
      err: { name: 'bucket hsm-public at 10.0.0.1 says no' },
    });
    expect(event.kind).toBe('Unknown');
  });

  it('fingerprints deterministically and irreversibly', () => {
    expect(keyFingerprint('requests/a.jpg')).toBe(keyFingerprint('requests/a.jpg'));
    expect(keyFingerprint('requests/a.jpg')).not.toBe(keyFingerprint('requests/b.jpg'));
    expect(keyFingerprint('requests/a.jpg')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('carries only the outcome across the boundary', () => {
    const err = new StorageFaultError('denied');
    expect(err.message).toBe('storage-denied');
    expect(err.outcome).toBe('denied');
  });
});
