import { describe, expect, it } from 'vitest';
import { otpErrorMessage, registrationErrorMessage } from './auth-errors';

describe('R04 safe authentication messages', () => {
  it('never renders a raw registration provider or database message', () => {
    const err = { response: { status: 500, data: { error: { message: 'fixture-private-connection-detail' } } } };
    expect(registrationErrorMessage(err)).not.toContain('fixture-private');
    expect(registrationErrorMessage(err)).toContain('could not be confirmed');
  });
  it('does not call an unavailable OTP verification service an incorrect code', () => {
    expect(otpErrorMessage(new Error('offline'), 'verify')).toContain('could not confirm');
    expect(otpErrorMessage({ response: { status: 503 } }, 'verify')).toContain('could not confirm');
    expect(otpErrorMessage({ response: { status: 429 } }, 'verify')).toContain('Too many requests');
    expect(otpErrorMessage({ response: { status: 400, data: { error: { code: 'AUTH_OTP_INVALID' } } } }, 'verify'))
      .toContain('Incorrect code');
  });
});
