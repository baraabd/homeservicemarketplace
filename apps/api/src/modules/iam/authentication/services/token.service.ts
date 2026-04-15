import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';

import { AppConfigService } from '../../../../config/app-config.service';

export interface AccessTokenClaims {
  sub: string; // userId
  sid: string; // sessionId
  jti: string; // token id
  roles: string[];
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface IssuedAccessToken {
  token: string;
  jti: string;
  expiresAt: Date;
  ttlSeconds: number;
}

export interface IssuedRefreshToken {
  raw: string; // returned to client ONCE; never persisted
  hash: string; // stored server-side
  expiresAt: Date;
}

// Centralized JWT + opaque-token primitives. No other module may sign JWTs
// or hash refresh tokens directly — keeps the crypto boundary narrow.
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  signAccessToken(params: {
    userId: string;
    sessionId: string;
    roles: string[];
  }): IssuedAccessToken {
    const jti = randomBytes(16).toString('base64url');
    const ttlSeconds = this.config.get('JWT_ACCESS_TTL_SECONDS');
    const token = this.jwt.sign(
      { sub: params.userId, sid: params.sessionId, roles: params.roles },
      {
        expiresIn: ttlSeconds,
        jwtid: jti,
        issuer: this.config.get('JWT_ISSUER'),
        audience: this.config.get('JWT_AUDIENCE'),
      },
    );
    return {
      token,
      jti,
      ttlSeconds,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    return this.jwt.verify<AccessTokenClaims>(token, {
      issuer: this.config.get('JWT_ISSUER'),
      audience: this.config.get('JWT_AUDIENCE'),
    });
  }

  mintRefreshToken(): IssuedRefreshToken {
    const raw = randomBytes(32).toString('base64url');
    const hash = this.hashRefreshToken(raw);
    const days = this.config.get('JWT_REFRESH_TTL_DAYS');
    return {
      raw,
      hash,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    };
  }

  hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  hashOpaqueToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  mintOpaqueToken(bytes = 32): { raw: string; hash: string } {
    const raw = randomBytes(bytes).toString('base64url');
    return { raw, hash: this.hashOpaqueToken(raw) };
  }
}
