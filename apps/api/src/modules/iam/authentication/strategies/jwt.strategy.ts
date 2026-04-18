import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';

import { AppConfigService } from '../../../../config/app-config.service';
import { ACCESS_COOKIE } from '../helpers/cookies';
import type { AuthenticatedUser } from '../types/authenticated-user';
// The global Express.Request augmentation in ../types/express.d.ts is
// picked up automatically because the .d.ts file is inside the tsconfig
// `include` glob. Do NOT re-add `import '../types/express'` — under
// module=commonjs, a side-effect import of a pure declaration file is
// preserved as `require("../types/express")` at runtime, and since no
// .js is emitted for a .d.ts, Node throws "Cannot find module" at boot.

interface JwtPayload {
  sub: string;
  sid: string;
  jti: string;
  roles: string[];
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: AppConfigService) {
    super({
      // Single authoritative extractor. See precedence rules in docs/iam.md.
      jwtFromRequest: (req: Request) => resolveAccessToken(req),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
      issuer: config.get('JWT_ISSUER'),
      audience: config.get('JWT_AUDIENCE'),
      passReqToCallback: false,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload?.sub || !payload?.sid || !payload?.jti) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    return {
      id: payload.sub,
      sessionId: payload.sid,
      jti: payload.jti,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    };
  }
}

// Exported for reuse by the refresh guard + tests.
export function resolveAccessToken(req: Request): string | null {
  const cookieToken = readAccessCookie(req);
  const headerToken = readBearer(req);

  if (cookieToken && headerToken) {
    // Ambiguous transport is always rejected — see ADR-3 (iam plan).
    throw new BadRequestException({ code: 'AUTH_AMBIGUOUS_TRANSPORT' });
  }

  if (cookieToken) {
    req.authTransport = 'cookie';
    return cookieToken;
  }
  if (headerToken) {
    req.authTransport = 'header';
    return headerToken;
  }
  return null;
}

function readAccessCookie(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const v = cookies?.[ACCESS_COOKIE];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function readBearer(req: Request): string | null {
  const raw = req.header('authorization');
  if (!raw) return null;
  const [scheme, token] = raw.split(' ', 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}
