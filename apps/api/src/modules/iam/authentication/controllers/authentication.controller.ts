import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthResponse, MeResponse, RoleName } from '@homeservicemarketplace/contracts';

import { AppConfigService } from '../../../../config/app-config.service';
import { UserRepository } from '../../../../infrastructure/persistence/iam/user.repository';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { ResendVerificationDto } from '../dto/resend-verification.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { CsrfGuard } from '../guards/csrf.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  clearAuthCookies,
  csrfCookieOptions,
  refreshCookieOptions,
} from '../helpers/cookies';
import {
  AuthenticationService,
  type ClientContext,
  type LoginResult,
} from '../services/authentication.service';
import type { AuthenticatedUser } from '../types/authenticated-user';
import type { ClientKind } from '@homeservicemarketplace/database';
import { randomBytes } from 'node:crypto';

const MOBILE_REFRESH_HEADER = 'x-refresh-token';
const CLIENT_KIND_HEADER = 'x-client-kind';

@Controller({ path: 'auth', version: '1' })
export class AuthenticationController {
  constructor(
    private readonly auth: AuthenticationService,
    private readonly users: UserRepository,
    private readonly config: AppConfigService,
  ) {}

  // --- Registration -------------------------------------------------------
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() body: RegisterDto, @Req() req: Request): Promise<{ success: true }> {
    await this.auth.register(body, buildContext(req));
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(
    @Body() body: ResendVerificationDto,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    await this.auth.resendVerification(body.email, buildContext(req));
    return { success: true };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: VerifyEmailDto, @Req() req: Request): Promise<{ success: true }> {
    await this.auth.verifyEmail(body.token, buildContext(req));
    return { success: true };
  }

  // --- Login --------------------------------------------------------------
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(body, buildContext(req));
    return this.shapeAuthResponse(req, res, result);
  }

  // --- Refresh ------------------------------------------------------------
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const presented = extractRefreshToken(req);
    if (!presented) throw new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' });

    // CSRF for web: refresh is a state-changing cookie-mounted endpoint.
    if (readRefreshCookie(req)) {
      const csrfCookie = readCookie(req, CSRF_COOKIE);
      const csrfHeader = req.header('x-csrf-token');
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        throw new BadRequestException({ code: 'AUTH_CSRF_FAILED' });
      }
    }

    const ctx = buildContext(req);
    const { issued, roles, userId } = await this.auth.refresh({
      refreshTokenRaw: presented,
      device: ctx.device,
      requestId: ctx.requestId,
    });
    return this.shapeAuthResponse(req, res, {
      user: { id: userId } as LoginResult['user'],
      roles,
      issued,
    });
  }

  // --- Logout -------------------------------------------------------------
  // CsrfGuard runs after JwtAuthGuard. JwtStrategy's extractor sets
  // req.authTransport; CsrfGuard only enforces the double-submit when the
  // transport was a cookie. Mobile / Bearer flows pass through.
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.sessionId, buildContext(req));
    clearAuthCookies(res, this.config);
  }

  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user.id, buildContext(req));
    clearAuthCookies(res, this.config);
  }

  // --- Password reset -----------------------------------------------------
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgot(@Body() body: ForgotPasswordDto, @Req() req: Request): Promise<{ success: true }> {
    await this.auth.forgotPassword(body.email, buildContext(req));
    return { success: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async reset(@Body() body: ResetPasswordDto, @Req() req: Request): Promise<{ success: true }> {
    await this.auth.resetPassword(body.token, body.newPassword, buildContext(req));
    return { success: true };
  }

  // --- Me -----------------------------------------------------------------
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    const row = await this.users.findById(user.id);
    if (!row) throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    const roleRows = await this.users.listRoles(row.id);
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      status: row.status,
      emailVerifiedAt: row.emailVerifiedAt ? row.emailVerifiedAt.toISOString() : null,
      mfaEnabled: row.mfaEnabled,
      roles: roleRows.map((r) => r.role.name as RoleName),
    };
  }

  // ------------------------------------------------------------------------

  private shapeAuthResponse(req: Request, res: Response, result: LoginResult): AuthResponse {
    const kind = detectClientKind(req);
    const roles = result.roles as RoleName[];
    const body: AuthResponse = {
      userId: result.user.id,
      roles,
      mfaRequired: false,
      tokens: null,
    };

    if (kind === 'WEB') {
      res.cookie(
        ACCESS_COOKIE,
        result.issued.access.token,
        accessCookieOptions(this.config, result.issued.access.ttlSeconds),
      );
      res.cookie(
        REFRESH_COOKIE,
        result.issued.refresh.raw,
        refreshCookieOptions(this.config, result.issued.refresh.expiresAt),
      );
      res.cookie(
        CSRF_COOKIE,
        randomBytes(24).toString('base64url'),
        csrfCookieOptions(this.config, result.issued.access.ttlSeconds),
      );
      return body;
    }

    // Mobile: tokens in body, no cookies.
    body.tokens = {
      accessToken: result.issued.access.token,
      refreshToken: result.issued.refresh.raw,
      expiresIn: result.issued.access.ttlSeconds,
    };
    return body;
  }
}

function buildContext(req: Request): ClientContext {
  return {
    device: {
      ipAddress: req.ip ?? 'unknown',
      userAgent: req.header('user-agent') ?? 'unknown',
      clientKind: detectClientKind(req),
    },
    requestId: (req as Request & { id?: string }).id ?? req.header('x-request-id') ?? null,
  };
}

function detectClientKind(req: Request): ClientKind {
  const raw = req.header(CLIENT_KIND_HEADER)?.toLowerCase();
  return raw === 'mobile' ? 'MOBILE' : 'WEB';
}

function extractRefreshToken(req: Request): string | null {
  const cookie = readRefreshCookie(req);
  const header = req.header(MOBILE_REFRESH_HEADER);
  if (cookie && header) {
    throw new BadRequestException({ code: 'AUTH_AMBIGUOUS_TRANSPORT' });
  }
  return cookie ?? header ?? null;
}

function readRefreshCookie(req: Request): string | null {
  return readCookie(req, REFRESH_COOKIE);
}

function readCookie(req: Request, name: string): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const v = cookies?.[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
