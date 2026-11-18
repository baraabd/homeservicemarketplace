import { Controller, Get, Header } from '@nestjs/common';
import type { AuthChannelConfiguration } from '@homeservicemarketplace/contracts';

import { Public } from '../../modules/iam/authentication/decorators/public.decorator';
import { AuthChannelService } from './auth-channel.service';

@Controller({ path: 'auth', version: '1' })
export class AuthChannelController {
  constructor(private readonly channels: AuthChannelService) {}

  @Public()
  @Get('config')
  @Header('Cache-Control', 'no-store')
  getConfig(): Promise<AuthChannelConfiguration> {
    return this.channels.getPublicConfig();
  }
}
