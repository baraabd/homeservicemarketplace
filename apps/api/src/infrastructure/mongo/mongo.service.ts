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

  // Sprint 4 — Mongo is an OPTIONAL dependency. See docs/adr/0002-mongodb.md.
  //
  // A code search found no domain consumer of either Mongo model, so the only
  // thing the connection fed was the readiness probe that reported on it. That
  // is a dependency which can only ever subtract availability, so it is now
  // off unless an operator turns it on.
  isEnabled(): boolean {
    return this.config.get('MONGODB_ENABLED');
  }

  connect(): Promise<Connection> {
    // Callers that reach connect() while Mongo is off get a hard, descriptive
    // failure rather than a hang or a confusing "not initialized" later. The
    // model providers below check isEnabled() first, so this only fires for a
    // genuine mistake: code that needs Mongo in a deployment that disabled it.
    if (!this.isEnabled()) {
      return Promise.reject(
        new Error(
          'MongoDB is disabled (MONGODB_ENABLED=false) but a component requested ' +
            'a connection. Set MONGODB_ENABLED=true and MONGODB_URI to enable it.',
        ),
      );
    }
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
    // Disabled is a normal, supported state — not a degraded one. Boot must
    // not open a socket, must not retry, and must not log an error.
    if (!this.isEnabled()) {
      this.logger.log('Mongo is disabled (MONGODB_ENABLED=false); skipping connection');
      return;
    }
    await this.connect();
  }

  private async establish(): Promise<Connection> {
    const uri = this.config.get('MONGODB_URI');
    const dbName = this.config.get('MONGODB_DB_NAME');
    const attempts = this.config.get('STARTUP_MAX_RETRIES');
    const baseMs = this.config.get('STARTUP_RETRY_BASE_MS');
    const capMs = this.config.get('STARTUP_RETRY_CAP_MS');

    // Fail fast BEFORE the retry loop: a missing URI is a configuration fault,
    // not a transient one, so burning STARTUP_MAX_RETRIES on it only delays a
    // crash that should be immediate. The env schema already rejects
    // MONGODB_ENABLED=true with no MONGODB_URI, so this guard covers the paths
    // that construct the service outside that contract. It is also what narrows
    // `uri` from `string | undefined` to the `string` createConnection expects,
    // with no non-null assertion or cast.
    if (!uri) {
      throw new Error(
        'MongoDB URI is not defined in the application configuration. ' +
          'Set MONGODB_URI in your environment (it is required whenever ' +
          'MONGODB_ENABLED=true).',
      );
    }

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
