import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';

import { AppConfigService } from '../../../../config/app-config.service';
import { ACCESS_COOKIE } from '../helpers/cookies';
import { SessionValidationService } from '../services/session-validation.service';
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
  constructor(
    config: AppConfigService,
    private readonly sessionValidation: SessionValidationService,
  ) {
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

  // D-2 — the single chokepoint every JwtAuthGuard-protected route passes
  // through.
  //
  // The stateless half is handled by passport-jwt from the options above:
  // signature, `iss`, `aud`, and `exp` are all verified before this method
  // runs (ignoreExpiration is false, and issuer/audience are pinned).
  //
  // The stateful half is here. Previously this only asked whether the ACCOUNT
  // was in good standing, which meant logout / logout-all / password reset /
  // refresh rotation left the already-issued access token working until it
  // expired. It now validates the specific Session row the token was minted
  // for, so those revocations take effect on the very next request. See
  // SessionValidationService for the full rule set and the fail-closed policy.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Claim-shape gate. A token missing sub/sid/jti cannot be tied to a
    // session, so there is nothing to validate against.
    if (!payload?.sub || !payload?.sid || !payload?.jti) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    await this.sessionValidation.assertSessionActive({
      userId: payload.sub,
      sessionId: payload.sid,
      jti: payload.jti,
    });
    return {
      id: payload.sub,
      sessionId: payload.sid,
      jti: payload.jti,
      // NOTE: roles here come from the token. RolesGuard consumes them, so a
      // role change only reaches REST authorization once the session is
      // re-issued — which is why every role mutation revokes the user's
      // sessions (see AdminUsersService / ProviderService).
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
