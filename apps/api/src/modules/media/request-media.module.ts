import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { RequestMediaService } from './request-media.service';

// Separate from MediaModule so RequestsModule can depend on the attachment
// authority without importing the media HTTP controller.
@Module({
  imports: [PrismaModule, StorageModule],
  providers: [RequestMediaService],
  exports: [RequestMediaService],
})
export class RequestMediaModule {}
