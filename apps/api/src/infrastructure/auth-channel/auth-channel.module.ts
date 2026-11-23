import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module';
import { AuthChannelController } from './auth-channel.controller';
import { AuthChannelService } from './auth-channel.service';
import { OtpDeliveryService } from './otp-delivery.service';

@Module({
  imports: [MailModule],
  controllers: [AuthChannelController],
  providers: [AuthChannelService, OtpDeliveryService],
  exports: [AuthChannelService, OtpDeliveryService],
})
export class AuthChannelModule {}
