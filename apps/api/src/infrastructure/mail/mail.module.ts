import { Global, Module } from '@nestjs/common';

import { InMemoryMailAdapter } from './in-memory-mail.adapter';
import { MAIL_PORT, MailPort } from './mail.port';

@Global()
@Module({
  providers: [
    InMemoryMailAdapter,
    { provide: MAIL_PORT, useExisting: InMemoryMailAdapter },
    { provide: MailPort, useExisting: InMemoryMailAdapter },
  ],
  exports: [MAIL_PORT, MailPort, InMemoryMailAdapter],
})
export class MailModule {}
