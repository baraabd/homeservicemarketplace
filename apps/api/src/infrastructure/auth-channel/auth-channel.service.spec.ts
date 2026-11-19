import type { PrismaTx } from '@homeservicemarketplace/database';
import type { PlatformSettingRepository } from '../persistence/settings/platform-setting.repository';
import { AuthChannelService } from './auth-channel.service';
import type { WhatsAppAuthAdapter } from './whatsapp-auth.adapter';

function harness(value?: unknown, configured = false) {
  const settings = {
    findByKey: jest.fn().mockResolvedValue(value === undefined ? null : { value }),
  };
  const whatsapp = { isConfigured: jest.fn(() => configured) };
  const service = new AuthChannelService(
    settings as unknown as PlatformSettingRepository,
    whatsapp as unknown as WhatsAppAuthAdapter,
  );
  return { settings, whatsapp, service };
}

describe('server-owned OTP channel', () => {
  it('defaults to email and exposes only a safe availability boolean', async () => {
    await expect(harness().service.getPublicConfig()).resolves.toEqual({
      otpChannel: 'email',
      whatsappAvailable: false,
    });
  });

  it('keeps a valid WhatsApp preference readable during provider outage for email recovery and rollback', async () => {
    const { service } = harness('whatsapp', false);
    await expect(service.getPublicConfig()).resolves.toEqual({
      otpChannel: 'whatsapp',
      whatsappAvailable: false,
    });
    // A readable policy never authorizes an unavailable delivery transport.
    await expect(service.getChannel()).rejects.toMatchObject({ status: 503 });
  });

  it('still rejects an invalid persisted channel instead of guessing a fallback', async () => {
    await expect(harness('sms', true).service.getPublicConfig()).rejects.toMatchObject({
      status: 503,
    });
  });

  it('re-reads policy on each request so a switch applies without restart', async () => {
    const h = harness('email', true);
    expect(await h.service.getChannel()).toBe('email');
    h.settings.findByKey.mockResolvedValue({ value: 'whatsapp' });
    expect(await h.service.getChannel()).toBe('whatsapp');
  });

  it.each(['invalid', 'whatsapp'])('fails closed for unavailable policy %s', async (value) => {
    await expect(harness(value).service.getChannel()).rejects.toMatchObject({ status: 503 });
  });

  it('blocks activation before the operator has a verified WhatsApp identity', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          isActive: true,
          deletedAt: null,
          phoneNumber: '+966500000001',
          phoneVerifiedAt: null,
        }),
      },
    };
    await expect(
      harness('email', true).service.assertSelectable(
        'whatsapp',
        'admin',
        tx as unknown as PrismaTx,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('checks the verified target under the account lock in the supplied transaction', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          isActive: true,
          deletedAt: null,
          phoneNumber: '+966500000001',
          phoneVerifiedAt: new Date(),
        }),
      },
    };
    await expect(
      harness('email', true).service.assertSelectable(
        'whatsapp',
        'admin',
        tx as unknown as PrismaTx,
      ),
    ).resolves.toBeUndefined();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'admin' } }),
    );
  });

  it('blocks email rollback for an operator without a verified email', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          isActive: true,
          deletedAt: null,
          email: null,
          emailVerifiedAt: null,
        }),
      },
    };
    await expect(
      harness('whatsapp', true).service.assertSelectable(
        'email',
        'admin',
        tx as unknown as PrismaTx,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
