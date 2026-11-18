import { hasVerifiedAuthenticationContact } from './verified-contact';

describe('verified authentication contact', () => {
  it('accepts an owned verified phone without an email', () => {
    expect(
      hasVerifiedAuthenticationContact({
        email: null,
        phoneNumber: '+966500000001',
        phoneVerifiedAt: new Date(),
      }),
    ).toBe(true);
  });
  it('requires both the identity and its verification timestamp', () => {
    expect(hasVerifiedAuthenticationContact({ phoneNumber: '+966500000001' })).toBe(false);
    expect(hasVerifiedAuthenticationContact({ phoneVerifiedAt: new Date() })).toBe(false);
    expect(hasVerifiedAuthenticationContact({ emailVerifiedAt: new Date() })).toBe(false);
  });
  it('preserves verified email and rejects missing accounts', () => {
    expect(
      hasVerifiedAuthenticationContact({
        email: 'person@example.test',
        emailVerifiedAt: new Date(),
      }),
    ).toBe(true);
    expect(hasVerifiedAuthenticationContact(null)).toBe(false);
  });
});
