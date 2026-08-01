import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { AppConfigService } from '../../../../config/app-config.service';
import { UserRepository } from '../../../../infrastructure/persistence/iam/user.repository';
import { RedisService } from '../../../../infrastructure/redis/redis.service';
import { isInGoodStanding } from '../helpers/account-standing';

// Sprint 01 hardening — immediate access-token blocking.
//
// The JWT access token is stateless: once signed it stays cryptographically
// valid until it expires, so without a per-request check a user who is
// deleted / deactivated / suspended / locked keeps sailing through every
// guard until their token's TTL runs out (up to JWT_ACCESS_TTL_SECONDS).
//
// Decision (see docs/adr/0001-immediate-access-token-blocking.md): a
// "measured cached session check" rather than a tokenVersion column.
//   - JwtStrategy.validate() calls assertInGoodStanding() on every
//     authenticated request.
//   - A per-user "in good standing" flag is cached in Redis with a short
//     TTL (AUTH_SESSION_CACHE_TTL_SECONDS) so the hot path is a single
//     GET, not a DB read.
//   - Only the POSITIVE result is cached. A bad account is never cached,
//     so it is re-checked against the DB on every request and can never
//     be let back in by a stale cache entry.
//   - Suspend / lock / logout-all / password-reset call invalidate() to
//     drop the positive flag, so revocation is effective on the very next
//     request. The TTL is only a safety net for when explicit
//     invalidation cannot reach a node.
//   - The DB is always the source of truth: on a cache miss OR any Redis
//     error we fall through to a DB read and enforce the result. We fail
//     toward correctness (re-check), never open.
@Injectable()
export class SessionValidationService {
  private readonly logger = new Logger(SessionValidationService.name);
  private readonly keyPrefix = 'iam:session:standing:';

  constructor(
    private readonly users: UserRepository,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  // Throws UnauthorizedException when the user backing the presented
  // access token is no longer allowed to hold a live session. Resolves
  // silently when the user is in good standing.
  async assertInGoodStanding(userId: string): Promise<void> {
    const key = this.keyPrefix + userId;

    let cached: string | null = null;
    try {
      cached = await this.redis.getClient().get(key);
    } catch (err) {
      this.logger.warn({
        msg: 'session-standing-cache.get.failed',
        err: (err as Error).message,
      });
    }

    // Fast path: a fresh positive flag means the account was in good
    // standing within the TTL window. Bad accounts are never cached, so a
    // hit is always safe to trust.
    if (cached === '1') return;

    // Miss (or Redis down): consult the source of truth.
    const user = await this.users.findById(userId);
    if (!isInGoodStanding(user)) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }

    const ttl = this.config.get('AUTH_SESSION_CACHE_TTL_SECONDS');
    try {
      await this.redis.getClient().setex(key, ttl, '1');
    } catch (err) {
      this.logger.warn({
        msg: 'session-standing-cache.setex.failed',
        userId,
        err: (err as Error).message,
      });
    }
  }

  // Drop the cached positive flag so the next request re-checks the DB.
  // Called after suspend / lock / logout-all / password-reset. Never
  // throws — a failed invalidation degrades to TTL-bounded staleness, not
  // a broken mutation.
  async invalidate(userId: string): Promise<void> {
    try {
      await this.redis.getClient().del(this.keyPrefix + userId);
    } catch (err) {
      this.logger.warn({
        msg: 'session-standing-cache.del.failed',
        userId,
        err: (err as Error).message,
      });
    }
  }
}
