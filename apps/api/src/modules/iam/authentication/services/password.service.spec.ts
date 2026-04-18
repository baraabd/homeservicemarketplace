import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let svc: PasswordService;

  beforeAll(async () => {
    svc = new PasswordService();
    await svc.onModuleInit();
  });

  it('hashes and verifies a password round-trip', async () => {
    const hash = await svc.hash('correct-horse-battery-staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(svc.verify(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
    await expect(svc.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('runs a verify against the dummy hash when no hash is stored (anti-enumeration)', async () => {
    const started = Date.now();
    await expect(svc.verify(null, 'any-password')).resolves.toBe(false);
    await expect(svc.verify(undefined, 'any-password')).resolves.toBe(false);
    await expect(svc.verify('', 'any-password')).resolves.toBe(false);
    // We can't easily assert timing parity, but a bare short-circuit would
    // complete in ~0ms; a real argon2.verify completes in ~50ms+.
    expect(Date.now() - started).toBeGreaterThan(10);
  });

  it('needsRehash returns false for a freshly created hash', async () => {
    const hash = await svc.hash('pw');
    expect(svc.needsRehash(hash)).toBe(false);
  });
});
