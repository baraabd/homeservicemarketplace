import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { TransactionRunner } from './transaction.runner';

@Global()
@Module({
  providers: [PrismaService, TransactionRunner],
  exports: [PrismaService, TransactionRunner],
})
export class PrismaModule {}
