import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';

import { AppConfigService } from '../../config/app-config.service';
import { retry } from '../../shared/retry/retry';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private connection?: Connection;
  private ready = false;
  // Memoized so async model factory providers and onModuleInit converge on
  // the same single connect attempt. Without this, a useFactory provider
  // that referenced getConnection() ran BEFORE onModuleInit populated
  // `this.connection`, producing "Mongo connection not initialized".
  private connectionPromise?: Promise<Connection>;

  constructor(private readonly config: AppConfigService) {}

  connect(): Promise<Connection> {
    if (!this.connectionPromise) {
      this.connectionPromise = this.establish().catch((err) => {
        // Clear the memoized promise on failure so a subsequent caller
        // (e.g. a retry-aware supervisor) can attempt a fresh connect
        // instead of being permanently wedged on a rejected promise.
        this.connectionPromise = undefined;
        throw err;
      });
    }
    return this.connectionPromise;
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  private async establish(): Promise<Connection> {
    const uri = this.config.get('MONGODB_URI');
    const dbName = this.config.get('MONGODB_DB_NAME');
    const attempts = this.config.get('STARTUP_MAX_RETRIES');
    const baseMs = this.config.get('STARTUP_RETRY_BASE_MS');
    const capMs = this.config.get('STARTUP_RETRY_CAP_MS');

    const conn = await retry(
      () =>
        mongoose
          .createConnection(uri, {
            dbName,
            serverSelectionTimeoutMS: this.config.get('MONGODB_SERVER_SELECTION_TIMEOUT_MS'),
            connectTimeoutMS: this.config.get('MONGODB_CONNECT_TIMEOUT_MS'),
            maxPoolSize: this.config.get('MONGODB_MAX_POOL_SIZE'),
            autoIndex: !this.config.isProduction,
          })
          .asPromise(),
      {
        attempts,
        baseMs,
        capMs,
        onAttempt: (n, err) =>
          this.logger.warn(
            `Mongo connect attempt ${n}/${attempts} failed: ${(err as Error).message}`,
          ),
      },
    );

    // Register handlers before flipping ready=true so a disconnect event
    // arriving on the next microtask cannot be dropped.
    conn.on('disconnected', () => {
      this.ready = false;
      this.logger.warn('Mongo connection lost');
    });
    conn.on('reconnected', () => {
      this.ready = true;
      this.logger.log('Mongo connection restored');
    });
    conn.on('error', (err) => {
      this.logger.error(`Mongo error: ${err.message}`);
    });

    this.connection = conn;
    this.ready = true;
    this.logger.log('Mongo connection established');
    return conn;
  }

  async onModuleDestroy(): Promise<void> {
    this.ready = false;
    this.connectionPromise = undefined;
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (err) {
        this.logger.error(`Error closing Mongo: ${(err as Error).message}`);
      }
    }
  }

  getConnection(): Connection {
    if (!this.connection) throw new Error('Mongo connection not initialized');
    return this.connection;
  }

  isReady(): boolean {
    return this.ready && this.connection?.readyState === 1;
  }

  async ping(): Promise<boolean> {
    try {
      const admin = this.connection?.db?.admin();
      if (!admin) return false;
      const res = await admin.ping();
      return res?.ok === 1;
    } catch {
      return false;
    }
  }
}
