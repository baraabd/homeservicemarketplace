import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { LoginDto } from './login.dto';

const validationOptions = { whitelist: true, forbidNonWhitelisted: true };

describe('LoginDto selected-method input', () => {
  it('accepts canonical phone-only login without a password', async () => {
    await expect(
      validate(plainToInstance(LoginDto, { phoneNumber: '+966501234567' }), validationOptions),
    ).resolves.toEqual([]);
  });

  it('keeps email login password-required', async () => {
    const errors = await validate(
      plainToInstance(LoginDto, { email: 'ada@example.com' }),
      validationOptions,
    );
    expect(errors.some((error) => error.property === 'password')).toBe(true);
    await expect(
      validate(
        plainToInstance(LoginDto, { email: 'ada@example.com', password: 'existing-password' }),
        validationOptions,
      ),
    ).resolves.toEqual([]);
  });

  it.each([null, 123456, '', 'x'.repeat(129)])(
    'validates a supplied legacy phone-login password instead of accepting malformed %p',
    async (password) => {
      const errors = await validate(
        plainToInstance(LoginDto, { phoneNumber: '+966501234567', password }),
        validationOptions,
      );
      expect(errors.some((error) => error.property === 'password')).toBe(true);
    },
  );

  it.each(['0501234567', '+966 501234567', '+1234567890123456'])(
    'still rejects noncanonical phone identity %p',
    async (phoneNumber) => {
      const errors = await validate(plainToInstance(LoginDto, { phoneNumber }), validationOptions);
      expect(errors.some((error) => error.property === 'phoneNumber')).toBe(true);
    },
  );
});
