import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ClientKind, Session } from '@homeservicemarketplace/database';

import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import { SessionRepository } from '../../../../infrastructure/persistence/iam/session.repository';
import { AuditService } from '../../audit/audit.service';
import { TokenService, type IssuedAccessToken, type IssuedRefreshToken } from './token.service';

export interface IssuedSession {
  session: Session;
  access: IssuedAccessToken;
  refresh: IssuedRefreshToken;
}

export interface DeviceMetadata {
  ipAddress: string;
  userAgent: string;
  clientKind: ClientKind;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenService,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
  ) {}

  // Brand-new login = new family + first session row in the family.
  async createForLogin(params: {
    userId: string;
    roles: string[];
    device: DeviceMetadata;
    requestId: string | null;
  }): Promise<IssuedSession> {
    const familyId = randomBytes(16).toString('base64url');
    return this.mintAndStore({ ...params, familyId, parentJti: null });
  }

  // Refresh rotation: atomically revoke the presented refresh token's session
  // row and issue a new row inside the same family. Replay (presenting a
  // refresh token we already revoked) revokes the entire family and 401s.
  async rotate(params: {
    presentedRefreshRaw: string;
    roles: string[];
    device: DeviceMetadata;
    requestId: string | null;
  }): Promise<IssuedSession> {
    const presentedHash = this.tokens.hashRefreshToken(params.presentedRefreshRaw);

    return this.tx.run(async (trx) => {
      const row = await this.sessions.findByTokenHash(presentedHash, trx);
      if (!row) {
        throw new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' });
      }

      // Replay: the row exists but is already revoked. Kill the entire family
      // — any live sibling is compromised — and audit.
      if (row.revokedAt !== null) {
        await this.sessions.revokeFamily(row.familyId, trx);
        await this.audit.record(
          {
            type: 'REFRESH_REPLAY',
            userId: row.userId,
            ipAddress: params.device.ipAddress,
            userAgent: params.device.userAgent,
            requestId: params.requestId,
            metadata: { familyId: row.familyId, sessionId: row.id },
          },
          trx,
        );
        throw new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' });
      }

      if (row.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' });
      }

      // Atomic revoke-if-active closes the concurrent-refresh race: two
      // parallel callers with the same refresh token will have exactly one
      // winner; the loser sees count=0 and is treated as replay.
      const revoked = await this.sessions.markRevokedIfActive(row.id, trx);
      if (revoked === 0) {
        await this.sessions.revokeFamily(row.familyId, trx);
        await this.audit.record(
          {
            type: 'REFRESH_REPLAY',
            userId: row.userId,
            ipAddress: params.device.ipAddress,
            userAgent: params.device.userAgent,
            requestId: params.requestId,
            metadata: { familyId: row.familyId, sessionId: row.id, reason: 'race' },
          },
          trx,
        );
        throw new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' });
      }

      const issued = await this.mintAndStoreWithinTx({
        userId: row.userId,
        roles: params.roles,
        device: params.device,
        familyId: row.familyId,
        parentJti: row.currentJti,
        tx: trx,
      });

      await this.audit.record(
        {
          type: 'REFRESH_ROTATED',
          userId: row.userId,
          ipAddress: params.device.ipAddress,
          userAgent: params.device.userAgent,
          requestId: params.requestId,
          metadata: { familyId: row.familyId, sessionId: issued.session.id },
        },
        trx,
      );

      return issued;
    });
  }

  // Read-only lookup used by AuthenticationService.refresh to resolve
  // current roles BEFORE calling rotate (so the new access token carries
  // up-to-date roles). Does not mutate state.
  async peekByRefreshRaw(raw: string): Promise<Session | null> {
    return this.sessions.findByTokenHash(this.tokens.hashRefreshToken(raw));
  }

  // `tx` lets logout revoke the session in the SAME transaction that writes
  // the LOGOUT audit row, so an operator never sees one without the other
  // (D-2).
  async revokeById(
    sessionId: string,
    tx?: Parameters<SessionRepository['revokeById']>[1],
  ): Promise<void> {
    await this.sessions.revokeById(sessionId, tx);
  }

  // `tx` lets a caller revoke every session as part of a larger atomic unit
  // (e.g. password reset revokes sessions in the SAME transaction that
  // consumes the token and rewrites the password hash). Omit it for
  // standalone revocation (logout-all).
  async revokeAllForUser(
    userId: string,
    tx?: Parameters<SessionRepository['revokeAllForUser']>[1],
  ): Promise<number> {
    const { count } = await this.sessions.revokeAllForUser(userId, tx);
    return count;
  }

  listActive(userId: string) {
    return this.sessions.listActiveByUser(userId);
  }

  private async mintAndStore(params: {
    userId: string;
    roles: string[];
    device: DeviceMetadata;
    familyId: string;
    parentJti: string | null;
  }): Promise<IssuedSession> {
    return this.tx.run((trx) => this.mintAndStoreWithinTx({ ...params, tx: trx }));
  }

  private async mintAndStoreWithinTx(params: {
    userId: string;
    roles: string[];
    device: DeviceMetadata;
    familyId: string;
    parentJti: string | null;
    tx: Parameters<Parameters<TransactionRunner['run']>[0]>[0];
  }): Promise<IssuedSession> {
    const refresh = this.tokens.mintRefreshToken();
    // Pre-generate jti/access so the persisted currentJti matches the issued token.
    const access = this.tokens.signAccessToken({
      userId: params.userId,
      sessionId: 'pending',
      roles: params.roles,
    });
    // Create the session with real jti; then re-sign access token with the
    // real sessionId now known. Cheap (one extra sign). Avoids two-phase
    // cross-referencing.
    const session = await this.sessions.create(
      {
        userId: params.userId,
        familyId: params.familyId,
        parentJti: params.parentJti,
        currentJti: access.jti,
        tokenHash: refresh.hash,
        ipAddress: params.device.ipAddress,
        userAgent: params.device.userAgent,
        clientKind: params.device.clientKind,
        expiresAt: refresh.expiresAt,
      },
      params.tx,
    );
    const finalAccess = this.tokens.signAccessToken({
      userId: params.userId,
      sessionId: session.id,
      roles: params.roles,
    });
    // Update session's currentJti to the finalAccess jti for consistency.
    await params.tx.session.update({
      where: { id: session.id },
      data: { currentJti: finalAccess.jti },
    });
    return { session: { ...session, currentJti: finalAccess.jti }, access: finalAccess, refresh };
  }
}
