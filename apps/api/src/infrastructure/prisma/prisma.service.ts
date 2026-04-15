import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, prisma } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../config/app-config.service';
import { retry } from '../../shared/retry/retry';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient = prisma;
  private ready = false;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const attempts = this.config.get('STARTUP_MAX_RETRIES');
    const baseMs = this.config.get('STARTUP_RETRY_BASE_MS');
    const capMs = this.config.get('STARTUP_RETRY_CAP_MS');
    const timeoutMs = this.config.get('DATABASE_CONNECT_TIMEOUT_MS');

    await retry(() => this.connectWithTimeout(timeoutMs), {
      attempts,
      baseMs,
      capMs,
      onAttempt: (n, err) =>
        this.logger.warn(
          `Postgres connect attempt ${n}/${attempts} failed: ${(err as Error).message}`,
        ),
    });

    this.ready = true;
    this.logger.log('Postgres connection established');
  }

  async onModuleDestroy(): Promise<void> {
    this.ready = false;
    try {
      await this.client.$disconnect();
    } catch (err) {
      this.logger.error(`Error disconnecting Prisma: ${(err as Error).message}`);
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async ping(): Promise<boolean> {
    try {
      // Tagged-template form is parameterized by Prisma. The literal is
      // constant, but using the safe form keeps the "no raw SQL unless
      // strictly necessary" rule unambiguous for future readers.
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async connectWithTimeout(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.client.$connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Postgres connect timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
