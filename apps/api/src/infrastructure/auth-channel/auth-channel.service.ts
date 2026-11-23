import { Injectable } from '@nestjs/common';
import {
  DEFAULT_AUTH_OTP_CHANNEL,
  type AuthChannelConfiguration,
  type AuthOtpChannel,
} from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { AppError } from '../../shared/errors/app-error';
import { lockAuthAccount } from '../persistence/iam/auth-account-lock';
import { PlatformSettingRepository } from '../persistence/settings/platform-setting.repository';
import { WhatsAppAuthAdapter } from './whatsapp-auth.adapter';

export const AUTH_OTP_CHANNEL_SETTING = 'auth.otpChannel';

@Injectable()
export class AuthChannelService {
  constructor(
    private readonly settings: PlatformSettingRepository,
    private readonly whatsapp: WhatsAppAuthAdapter,
  ) {}

  async getChannel(tx?: PrismaTx): Promise<AuthOtpChannel> {
    const channel = await this.getSelectedChannel(tx);
    if (channel === 'whatsapp') this.assertWhatsAppReady();
    return channel;
  }

  private async getSelectedChannel(tx?: PrismaTx): Promise<AuthOtpChannel> {
    const row = await this.settings.findByKey(AUTH_OTP_CHANNEL_SETTING, tx);
    if (!row) return DEFAULT_AUTH_OTP_CHANNEL;
    if (row.value !== 'email' && row.value !== 'whatsapp')
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'Authentication configuration is unavailable.',
        503,
      );
    return row.value;
  }

  async getPublicConfig(tx?: PrismaTx): Promise<AuthChannelConfiguration> {
    // Availability is a separate capability: losing provider configuration must
    // not hide the selected method or prevent an operator's explicit rollback.
    // New sign-ins use only this selected method; sending still fails closed.
    return {
      otpChannel: await this.getSelectedChannel(tx),
      whatsappAvailable: this.whatsapp.isConfigured(),
    };
  }

  assertWhatsAppReady(): void {
    if (!this.whatsapp.isConfigured())
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'WhatsApp authentication is not configured.',
        503,
      );
  }

  /** Run under the settings transaction and account lock. A switch cannot
   * remove the operator's own verified way back into the platform. New sign-ins
   * use only the selected method; issued challenges retain their bound contact. */
  async assertSelectable(channel: unknown, adminUserId: string, tx: PrismaTx): Promise<void> {
    if (channel !== 'email' && channel !== 'whatsapp')
      throw new AppError('VALIDATION_ERROR', 'Unsupported authentication channel.', 400);
    if (channel === 'whatsapp') this.assertWhatsAppReady();
    await lockAuthAccount(tx, adminUserId);
    const user = await tx.user.findUnique({
      where: { id: adminUserId },
      select: {
        email: true,
        emailVerifiedAt: true,
        phoneNumber: true,
        phoneVerifiedAt: true,
        status: true,
        isActive: true,
        deletedAt: true,
      },
    });
    if (!user || user.status !== 'ACTIVE' || !user.isActive || user.deletedAt)
      throw new AppError('FORBIDDEN', 'Account is not active.', 403);
    const ready =
      channel === 'whatsapp'
        ? user?.phoneNumber && user.phoneVerifiedAt
        : user?.email && user.emailVerifiedAt;
    if (!ready)
      throw new AppError(
        'VALIDATION_ERROR',
        'Verify your own contact for this channel before switching.',
        400,
      );
  }
}
