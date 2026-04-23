import { describe, it, expect } from 'vitest';
import {
  extractAuthError,
  loginErrorMessage,
  otpErrorMessage,
  resetPasswordErrorMessage,
} from './auth-errors';

// Build an axios-style error envelope.
function axiosErr(
  status: number,
  body: { error?: { code?: string; message?: string } } = {},
): unknown {
  return { response: { status, data: body } };
}

describe('extractAuthError', () => {
  it('pulls stable code + status out of an axios error envelope', () => {
    const e = axiosErr(401, { error: { code: 'AUTH_INVALID_CREDENTIALS' } });
    expect(extractAuthError(e)).toEqual({ code: 'AUTH_INVALID_CREDENTIALS', status: 401 });
  });

  it('returns { code: null, status: null } for unknown shapes', () => {
    expect(extractAuthError(new Error('boom'))).toEqual({ code: null, status: null });
    expect(extractAuthError(undefined)).toEqual({ code: null, status: null });
  });
});

describe('loginErrorMessage', () => {
  // Regression: this is the exact scenario the bug report described.
  // The server emitted message="Unauthorized Exception" (NestJS class-name
  // derivation leaking through the exception filter). The UI MUST translate
  // from the stable code and never display the raw message.
  it('never displays the raw backend message — maps from code instead', () => {
    const e = axiosErr(401, {
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Unauthorized Exception' },
    });
    const msg = loginErrorMessage(e);
    expect(msg).not.toBe('Unauthorized Exception');
    expect(msg).not.toContain('Exception');
    expect(msg).toBe('Incorrect email or password.');
  });

  it('AUTH_ACCOUNT_LOCKED — tells the user to wait or reset (covers login-after-lockout flow)', () => {
    const e = axiosErr(401, { error: { code: 'AUTH_ACCOUNT_LOCKED' } });
    const msg = loginErrorMessage(e);
    expect(msg.toLowerCase()).toContain('locked');
    expect(msg.toLowerCase()).toMatch(/reset|try again/);
    expect(msg).not.toContain('Exception');
  });

  it('AUTH_ACCOUNT_UNVERIFIED — tells the user to verify their email', () => {
    const e = axiosErr(403, { error: { code: 'AUTH_ACCOUNT_UNVERIFIED' } });
    expect(loginErrorMessage(e).toLowerCase()).toContain('verify');
  });

  it('AUTH_ACCOUNT_SUSPENDED — tells the user the account is suspended', () => {
    const e = axiosErr(403, { error: { code: 'AUTH_ACCOUNT_SUSPENDED' } });
    expect(loginErrorMessage(e).toLowerCase()).toContain('suspended');
  });

  it('RATE_LIMITED — tells the user to wait', () => {
    const e = axiosErr(429, { error: { code: 'RATE_LIMITED' } });
    expect(loginErrorMessage(e).toLowerCase()).toMatch(/too many|wait/);
  });

  it('unknown code on a 401 still says "incorrect email or password" (not a leak)', () => {
    const e = axiosErr(401, { error: { code: 'NEW_CODE_NOT_IN_MAP' } });
    expect(loginErrorMessage(e)).toBe('Incorrect email or password.');
  });

  it('5xx / network failure falls through to a neutral retry message', () => {
    expect(loginErrorMessage(axiosErr(503))).toBe(
      "We couldn't reach the server. Please try again.",
    );
    expect(loginErrorMessage(new Error('Network Error'))).toBe(
      "Couldn't sign in. Please try again.",
    );
  });

  it('no scenario — even a backend mistake — emits "Unauthorized Exception"', () => {
    // Fuzz a handful of code/status/message combos; the UI copy must never
    // contain the framework class name.
    const fixtures = [
      axiosErr(401, { error: { message: 'Unauthorized Exception' } }),
      axiosErr(403, { error: { message: 'Forbidden Exception' } }),
      axiosErr(400, { error: { message: 'Bad Request Exception' } }),
      axiosErr(500, { error: { message: 'Internal Server Error Exception' } }),
      axiosErr(401, {
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Unauthorized Exception' },
      }),
    ];
    for (const f of fixtures) {
      const msg = loginErrorMessage(f);
      expect(msg).not.toMatch(/Exception/);
    }
  });
});

describe('otpErrorMessage', () => {
  it('verify: AUTH_OTP_LOCKED', () => {
    const msg = otpErrorMessage(axiosErr(400, { error: { code: 'AUTH_OTP_LOCKED' } }), 'verify');
    expect(msg.toLowerCase()).toContain('too many');
  });

  it('verify: AUTH_OTP_EXPIRED', () => {
    const msg = otpErrorMessage(axiosErr(400, { error: { code: 'AUTH_OTP_EXPIRED' } }), 'verify');
    expect(msg.toLowerCase()).toContain('expired');
  });

  it('verify: unknown code → generic "Incorrect code"', () => {
    const msg = otpErrorMessage(axiosErr(400, {}), 'verify');
    expect(msg.toLowerCase()).toContain('incorrect code');
  });

  it('resend: AUTH_OTP_RESEND_EXCEEDED', () => {
    const msg = otpErrorMessage(
      axiosErr(400, { error: { code: 'AUTH_OTP_RESEND_EXCEEDED' } }),
      'resend',
    );
    expect(msg.toLowerCase()).toContain('resend limit');
  });
});

describe('resetPasswordErrorMessage', () => {
  it('400 / AUTH_INVALID_CREDENTIALS — explains the link is invalid or expired', () => {
    const msg = resetPasswordErrorMessage(
      axiosErr(400, { error: { code: 'AUTH_INVALID_CREDENTIALS' } }),
    );
    expect(msg.toLowerCase()).toMatch(/invalid|expired/);
  });

  it('other failures — generic retry copy', () => {
    expect(resetPasswordErrorMessage(axiosErr(503))).toMatch(/something went wrong/i);
  });
});
