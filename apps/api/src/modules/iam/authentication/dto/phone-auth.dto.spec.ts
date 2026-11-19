import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PhoneEnrollmentDto, PhoneIdentityDto, ResetPasswordOtpDto } from './phone-auth.dto';

const validationOptions = { whitelist: true, forbidNonWhitelisted: true };

describe('phone authentication DTO boundaries', () => {
  it('accepts canonical international phone numbers', async () => {
    const input = plainToInstance(PhoneIdentityDto, { phoneNumber: '+966501234567' });
    await expect(validate(input, validationOptions)).resolves.toEqual([]);
  });

  it.each([
    undefined,
    null,
    966501234567,
    '0501234567',
    '+0966501234567',
    '+966 50 123 4567',
    '+1234567890123456',
  ])(
    'rejects noncanonical phone input %p before database or delivery work',
    async (phoneNumber) => {
      const errors = await validate(
        plainToInstance(PhoneIdentityDto, { phoneNumber }),
        validationOptions,
      );
      expect(errors.some((error) => error.property === 'phoneNumber')).toBe(true);
    },
  );

  it('requires the current password when requesting a phone proof', async () => {
    const errors = await validate(
      plainToInstance(PhoneEnrollmentDto, { phoneNumber: '+966501234567' }),
      validationOptions,
    );
    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('accepts recovery only with an opaque challenge, six digits and a policy-compliant password', async () => {
    const valid = {
      challengeId: 'challenge-identifier-long',
      code: '123456',
      newPassword: 'a-long-replacement-password',
    };
    await expect(
      validate(plainToInstance(ResetPasswordOtpDto, valid), validationOptions),
    ).resolves.toEqual([]);
    for (const malformed of [
      { ...valid, challengeId: 'short' },
      { ...valid, code: '12345' },
      { ...valid, code: '12a456' },
      { ...valid, newPassword: 'short' },
      { ...valid, newPassword: 'x'.repeat(129) },
      { ...valid, userId: 'other-user' },
    ]) {
      expect(
        await validate(plainToInstance(ResetPasswordOtpDto, malformed), validationOptions),
      ).not.toEqual([]);
    }
  });
});
