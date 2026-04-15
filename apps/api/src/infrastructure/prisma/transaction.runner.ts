import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from './prisma.service';

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
}

@Injectable()
export class TransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(fn: (tx: PrismaTx) => Promise<T>, options?: TransactionOptions): Promise<T> {
    return this.prisma.client.$transaction(fn, options);
  }
}
