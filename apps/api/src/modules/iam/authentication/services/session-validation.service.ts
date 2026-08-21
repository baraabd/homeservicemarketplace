import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { SessionRepository } from '../../../../infrastructure/persistence/iam/session.repository';
import { isInGoodStanding } from '../helpers/account-standing';

// D-2 — immediate access-token revocation.
//
// ── What was wrong ───────────────────────────────────────────────────────────
// `JwtStrategy.validate()` used to call `assertInGoodStanding(userId)`, which
// only asked "is this ACCOUNT allowed to hold a session?". It never looked at
// the Session row the token was minted for. Consequences:
//
//   - logout revoked the Session row, but the access token it belonged to kept
//     passing every guard until `exp` (up to JWT_ACCESS_TTL_SECONDS).
//   - logout-all and password reset had the same hole: refresh was killed, but
//     already-issued access tokens survived.
//   - a token from a session that had been rotated away by refresh stayed
//     valid alongside its replacement.
//
// Only the admin suspend/lock path was immediate, and only because it changed
// account standing — the one thing the check actually looked at.
//
// ── What it does now ─────────────────────────────────────────────────────────
// `assertSessionActive` is the single authority. It verifies, on every
// authenticated request (REST *and* the Socket.IO handshake — same method, so
// the two surfaces cannot drift):
//
//   1. the Session row exists;
//   2. `Session.userId === payload.sub`   (token is not being replayed against
//      another user's session);
//   3. `Session.id === payload.sid`       (trivially true by lookup key, but
//      asserted so the invariant is explicit and tested);
//   4. `Session.currentJti === payload.jti` (the token is the CURRENT one for
//      this session — a token replaced by refresh rotation is rejected);
//   5. `Session.revokedAt === null`       (logout / logout-all / reset /
//      suspend / family-revoke all set this);
//   6. the Session has not passed `expiresAt`;
//   7. the owning User is still in good standing (exists, not soft-deleted,
//      active, status ACTIVE).
//
// ── Why there is no positive cache ───────────────────────────────────────────
// The previous design cached a per-USER "in good standing" flag in Redis for
// AUTH_SESSION_CACHE_TTL_SECONDS. Two problems: it was keyed by the wrong
// thing (a user can hold many sessions, and logging one out must not affect
// the others), and a positive entry that outlived a failed invalidation kept a
// revoked session usable for the rest of the TTL.
//
// The requirement is that a revoked session is dead on the NEXT request, on
// EVERY instance, with no window — so the check reads the shared source of
// truth. That is ONE indexed primary-key lookup that also pulls the four user
// columns standing depends on through the relation, so it is a single round
// trip and adds no N+1. Correctness here is worth more than a Redis GET, and
// it removes an entire class of stale-cache bug rather than bounding it.
//
// ── Failure policy: FAIL CLOSED ──────────────────────────────────────────────
// If the lookup cannot be completed, the request is REJECTED. A token is never
// admitted because the infrastructure that would have refused it was
// unavailable — that would turn a database blip into an authorization bypass.
@Injectable()
export class SessionValidationService {
  private readonly logger = new Logger(SessionValidationService.name);

  constructor(private readonly sessions: SessionRepository) {}

  /**
   * Authoritative per-request session check. Resolves silently when the
   * presented token still corresponds to a live session held by a user in good
   * standing; throws 401 otherwise.
   *
   * Every rejection collapses to the SAME opaque code. The caller must not be
   * able to tell "that session was revoked" from "that session never existed"
   * from "that account is suspended" — each distinction is an oracle.
   */
  async assertSessionActive(params: {
    userId: string;
    sessionId: string;
    jti: string;
  }): Promise<void> {
    const { userId, sessionId, jti } = params;

    if (!userId || !sessionId || !jti) {
      throw unauthorized();
    }

    let session;
    try {
      session = await this.sessions.findByIdWithUserStanding(sessionId);
    } catch (err) {
      // FAIL CLOSED. Never admit on infrastructure failure.
      this.logger.error({
        msg: 'session-validation.lookup.failed.fail-closed',
        sessionId,
        err: (err as Error).message,
      });
      throw unauthorized();
    }

    if (!session) throw unauthorized(); // session row gone (hard-deleted user, bogus sid)
    if (session.id !== sessionId) throw unauthorized(); // invariant guard
    if (session.userId !== userId) throw unauthorized(); // token/session owner mismatch
    if (session.currentJti !== jti) throw unauthorized(); // superseded by refresh rotation
    if (session.revokedAt !== null) throw unauthorized(); // logout / logout-all / reset / suspend
    if (session.expiresAt.getTime() <= Date.now()) throw unauthorized(); // session lifetime over
    if (!isInGoodStanding(session.user)) throw unauthorized(); // deleted/inactive/suspended/locked

    return;
  }
}

// One shape, one code, for every rejection reason.
function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
}
