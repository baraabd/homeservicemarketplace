import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';

import { AppConfigService } from '../../config/app-config.service';
import { retry } from '../../shared/retry/retry';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client?: Redis;
  private ready = false;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const options: RedisOptions = {
      host: this.config.get('REDIS_HOST'),
      port: this.config.get('REDIS_PORT'),
      password: this.config.get('REDIS_PASSWORD') || undefined,
      db: this.config.get('REDIS_DB'),
      tls: this.config.get('REDIS_TLS') ? {} : undefined,
      connectTimeout: this.config.get('REDIS_CONNECT_TIMEOUT_MS'),
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableAutoPipelining: true,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    };

    const client = new Redis(options);
    // Assign before retrying so onModuleDestroy can still quit() the client
    // if every connect attempt fails — otherwise the client's internal
    // retry-strategy timers would keep trying to reconnect in the background.
    this.client = client;

    client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
    client.on('end', () => {
      this.ready = false;
      this.logger.warn('Redis connection closed');
    });
    client.on('ready', () => {
      this.ready = true;
      this.logger.log('Redis ready');
    });

    const attempts = this.config.get('STARTUP_MAX_RETRIES');
    const baseMs = this.config.get('STARTUP_RETRY_BASE_MS');
    const capMs = this.config.get('STARTUP_RETRY_CAP_MS');

    await retry(() => client.connect(), {
      attempts,
      baseMs,
      capMs,
      onAttempt: (n, err) =>
        this.logger.warn(
          `Redis connect attempt ${n}/${attempts} failed: ${(err as Error).message}`,
        ),
    });

    this.ready = true;
    this.logger.log('Redis connection established');
  }

  async onModuleDestroy(): Promise<void> {
    this.ready = false;
    if (this.client) {
      try {
        await this.client.quit();
      } catch (err) {
        this.logger.error(`Error closing Redis: ${(err as Error).message}`);
      }
    }
  }

  getClient(): Redis {
    if (!this.client) throw new Error('Redis client not initialized');
    return this.client;
  }

  isReady(): boolean {
    return this.ready && this.client?.status === 'ready';
  }

  async ping(): Promise<boolean> {
    try {
      const pong = await this.client?.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
