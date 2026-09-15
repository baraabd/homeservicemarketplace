import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { PortfolioMediaService } from './portfolio-media.service';

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [PortfolioMediaService],
  exports: [PortfolioMediaService],
})
export class PortfolioMediaModule {}
