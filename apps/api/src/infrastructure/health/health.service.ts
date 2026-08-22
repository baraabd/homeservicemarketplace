import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { MongoService } from '../mongo/mongo.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface DependencyStatus {
  name: string;
  status: 'up' | 'down';
}

export interface ReadinessReport {
  ready: boolean;
  dependencies: DependencyStatus[];
}

// Upper bound on how long a single dep's ping may block the readiness probe.
// Without this cap, a hung driver (TCP half-open, Postgres stall) would make
// /health/ready hang past the orchestrator's probe timeout and produce
// ambiguous failure modes instead of a clean 503.
const PING_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  liveness(): { status: 'ok'; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessReport> {
    // Sprint 4 — Mongo is reported ONLY when it is enabled.
    //
    // Previously it was probed unconditionally, so a store with no domain
    // consumer (docs/adr/0002-mongodb.md) could take the whole API out of the
    // load-balancer pool. Readiness must describe what this instance needs to
    // serve traffic; a disabled dependency is not one of those things, and
    // listing it as "down" would be both untrue and actively harmful.
    const mongoEnabled = this.config.get('MONGODB_ENABLED');

    const checks = [
      this.checkDep('postgres', () => this.prisma.isReady() && this.prisma.ping()),
      this.checkDep('redis', () => this.redis.isReady() && this.redis.ping()),
    ];
    if (mongoEnabled) {
      checks.push(this.checkDep('mongo', () => this.mongo.isReady() && this.mongo.ping()));
    }

    const deps = await Promise.all(checks);
    return { ready: deps.every((d) => d.status === 'up'), dependencies: deps };
  }

  private async checkDep(
    name: string,
    fn: () => Promise<boolean> | boolean,
  ): Promise<DependencyStatus> {
    try {
      const ok = await this.withTimeout(fn);
      return { name, status: ok ? 'up' : 'down' };
    } catch {
      return { name, status: 'down' };
    }
  }

  private withTimeout(fn: () => Promise<boolean> | boolean): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ping timeout')), PING_TIMEOUT_MS);
      Promise.resolve()
        .then(fn)
        .then((v) => {
          clearTimeout(timer);
          resolve(Boolean(v));
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
