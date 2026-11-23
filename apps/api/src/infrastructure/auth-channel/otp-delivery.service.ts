import { Inject, Injectable } from '@nestjs/common';
import type { AuthOtpChannel } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { AppError } from '../../shared/errors/app-error';
import type { MailTemplateId } from '../mail/templates/mail-template.types';
import { MAIL_PORT, MailPort, type MailTicket } from '../mail/mail.port';
import { AuthChannelService } from './auth-channel.service';

export interface OtpDeliveryInput {
  channel: AuthOtpChannel;
  destination: string;
  userId: string;
  rawCode: string;
  purpose:
    | 'REGISTRATION_OTP'
    | 'LOGIN_OTP'
    | 'PASSWORD_RESET_OTP'
    | 'PHONE_VERIFICATION_OTP'
    | 'EMAIL_CONTACT_OTP';
  expiresAt: Date;
}

const OTP_TEMPLATES = {
  REGISTRATION_OTP: 'auth.registration_otp',
  LOGIN_OTP: 'auth.login_otp',
  PASSWORD_RESET_OTP: 'auth.password_reset_otp',
  PHONE_VERIFICATION_OTP: 'auth.phone_verification_otp',
  EMAIL_CONTACT_OTP: 'auth.email_contact_otp',
} as const satisfies Record<OtpDeliveryInput['purpose'], MailTemplateId>;

@Injectable()
export class OtpDeliveryService {
  constructor(
    @Inject(MAIL_PORT) private readonly messages: MailPort,
    private readonly channels: AuthChannelService,
  ) {}

  enqueue(input: OtpDeliveryInput, tx?: PrismaTx): Promise<MailTicket> {
    if (input.purpose === 'EMAIL_CONTACT_OTP' && input.channel !== 'email')
      throw new AppError(
        'VALIDATION_ERROR',
        'Email contact verification requires email delivery.',
        400,
      );
    if (input.channel === 'whatsapp') this.channels.assertWhatsAppReady();
    const template = OTP_TEMPLATES[input.purpose];
    return this.messages.enqueue(
      {
        channel: input.channel,
        to: input.destination,
        userId: input.userId,
        template,
        vars: { code: input.rawCode, minutes: 5 },
        expiresAt: input.expiresAt,
      },
      tx,
    );
  }

  dispatch(ticket: MailTicket): Promise<void> {
    return this.messages.dispatch(ticket);
  }
}
