import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../../../config/app-config.service';
import { RoleRepository } from '../../../../infrastructure/persistence/iam/role.repository';
import { RedisService } from '../../../../infrastructure/redis/redis.service';

// Redis-backed permission cache per role. Single-flight via pipelined MGET.
// Misses fall back to a Prisma read and SETEX. On Redis failure we degrade
// open to DB-per-request rather than failing authorization.
@Injectable()
export class PermissionResolverService {
  private readonly logger = new Logger(PermissionResolverService.name);
  private readonly keyPrefix = 'iam:role:perm:';

  constructor(
    private readonly roles: RoleRepository,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  async resolveForRoles(roleNames: string[]): Promise<Set<string>> {
    if (roleNames.length === 0) return new Set();
    const unique = Array.from(new Set(roleNames));
    const keys = unique.map((r) => this.keyPrefix + r);
    const union = new Set<string>();

    let cached: (string | null)[];
    try {
      cached = (await this.redis.getClient().mget(...keys)) as (string | null)[];
    } catch (err) {
      this.logger.warn({
        msg: 'permission-cache.mget.failed',
        err: (err as Error).message,
      });
      cached = keys.map(() => null);
    }

    const misses: string[] = [];
    cached.forEach((value, i) => {
      if (value === null) {
        misses.push(unique[i]!);
        return;
      }
      try {
        const parsed = JSON.parse(value) as string[];
        parsed.forEach((p) => union.add(p));
      } catch {
        misses.push(unique[i]!);
      }
    });

    if (misses.length > 0) {
      const ttl = this.config.get('PERMISSION_CACHE_TTL_SECONDS');
      for (const roleName of misses) {
        const perms = await this.loadFromDb(roleName);
        perms.forEach((p) => union.add(p));
        try {
          await this.redis.getClient().setex(this.keyPrefix + roleName, ttl, JSON.stringify(perms));
        } catch (err) {
          this.logger.warn({
            msg: 'permission-cache.setex.failed',
            roleName,
            err: (err as Error).message,
          });
        }
      }
    }

    return union;
  }

  async invalidate(roleName?: string): Promise<void> {
    const client = this.redis.getClient();
    if (roleName) {
      await client.del(this.keyPrefix + roleName);
      return;
    }
    // Break-glass: drop the entire prefix. Uses SCAN to avoid KEYS blocking.
    const stream = client.scanStream({ match: this.keyPrefix + '*', count: 200 });
    for await (const batch of stream as AsyncIterable<string[]>) {
      if (batch.length) await client.del(...batch);
    }
  }

  private async loadFromDb(roleName: string): Promise<string[]> {
    const role = await this.roles.findByName(roleName);
    if (!role) return [];
    const rows = await this.roles.listPermissions(role.id);
    return rows.map((r) => r.permission.key);
  }
}
