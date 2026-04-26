import { describe, it, expect } from 'vitest';
import * as contracts from '@homeservicemarketplace/contracts';

// Sprint 0 scaffold guard: prove the contracts package still loads cleanly
// after the Seeker barrel was added, and that the existing IAM surface is
// untouched. The test imports the package's public entry (not the seeker
// subpath) so it doubles as a "would Vercel still build" smoke check.
//
// This file deliberately does not assert any Seeker-domain symbols — those
// land in Sprint 1+. It only pins what already exists and the absence of
// barrel-time crashes.

describe('contracts barrel — Sprint 0 scaffold', () => {
  it('loads without throwing', () => {
    expect(contracts).toBeDefined();
  });

  it('still exports the IAM surface (regression guard for the new seeker re-export)', () => {
    // Codes the IAM contract has emitted since pre-Sprint 0; if the new
    // seeker barrel ever shadows or breaks the iam re-export, these go
    // missing and this test fails loudly.
    expect(contracts.AuthErrorCode).toBeDefined();
    expect(contracts.AuthErrorCode.InvalidCredentials).toBe('AUTH_INVALID_CREDENTIALS');
    expect(contracts.AuthErrorCode.OtpInvalid).toBe('AUTH_OTP_INVALID');
    expect(contracts.AccountStatus).toBeDefined();
  });
});
