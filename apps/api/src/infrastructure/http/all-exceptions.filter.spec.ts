import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppError } from '../../shared/errors/app-error';
import type { AppConfigService } from '../../config/app-config.service';

function mkHost(
  req: Partial<{ id: string; url: string; header: (k: string) => string | undefined }> = {},
) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json };
  const request = {
    url: req.url ?? '/whatever',
    id: req.id,
    header: req.header ?? (() => undefined),
  };
  const host: ArgumentsHost = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => res,
      getNext: () => undefined as never,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function mkConfig(isProduction = false): AppConfigService {
  return { isProduction } as unknown as AppConfigService;
}

describe('AllExceptionsFilter', () => {
  it('maps AppError through with its own status and code', () => {
    const filter = new AllExceptionsFilter(mkConfig());
    const { host, status, json } = mkHost();
    filter.catch(new AppError('NOT_FOUND', 'user gone', 404), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0][0]).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', message: 'user gone' },
    });
  });

  it('maps NestJS HttpException (400 BadRequest) to VALIDATION_ERROR', () => {
    const filter = new AllExceptionsFilter(mkConfig());
    const { host, status, json } = mkHost();
    filter.catch(new BadRequestException('bad body'), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
  });

  it('maps NestJS NotFoundException to NOT_FOUND', () => {
    const filter = new AllExceptionsFilter(mkConfig());
    const { host, status, json } = mkHost();
    filter.catch(new NotFoundException(), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0][0].error.code).toBe('NOT_FOUND');
  });

  describe('Prisma known errors', () => {
    const cases: Array<[string, string, number]> = [
      ['P2002', 'CONFLICT', HttpStatus.CONFLICT],
      ['P2003', 'CONFLICT', HttpStatus.CONFLICT],
      ['P2014', 'CONFLICT', HttpStatus.CONFLICT],
      ['P2025', 'NOT_FOUND', HttpStatus.NOT_FOUND],
      ['P2034', 'CONFLICT', HttpStatus.CONFLICT],
    ];
    it.each(cases)('%s -> %s (%i)', (code, expectedCode, expectedStatus) => {
      const filter = new AllExceptionsFilter(mkConfig());
      const { host, status, json } = mkHost();
      filter.catch({ code, message: 'driver detail' }, host);
      expect(status).toHaveBeenCalledWith(expectedStatus);
      expect(json.mock.calls[0][0].error.code).toBe(expectedCode);
      expect(json.mock.calls[0][0].error.message).not.toContain('driver detail');
    });
  });

  describe('Mongoose normalization', () => {
    it('ValidationError -> 400 VALIDATION_ERROR', () => {
      const filter = new AllExceptionsFilter(mkConfig());
      const { host, status, json } = mkHost();
      const err = Object.assign(new Error('bad doc'), { name: 'ValidationError' });
      filter.catch(err, host);
      expect(status).toHaveBeenCalledWith(400);
      expect(json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    });

    it('CastError -> 400 VALIDATION_ERROR', () => {
      const filter = new AllExceptionsFilter(mkConfig());
      const { host, status, json } = mkHost();
      const err = Object.assign(new Error('invalid id'), { name: 'CastError' });
      filter.catch(err, host);
      expect(status).toHaveBeenCalledWith(400);
      expect(json.mock.calls[0][0].error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('unknown failures', () => {
    it('maps unknown Error to 500 INTERNAL_ERROR', () => {
      const filter = new AllExceptionsFilter(mkConfig());
      const { host, status, json } = mkHost();
      filter.catch(new Error('mystery'), host);
      expect(status).toHaveBeenCalledWith(500);
      expect(json.mock.calls[0][0].error.code).toBe('INTERNAL_ERROR');
    });

    it('hides raw error details and stack in production', () => {
      const filter = new AllExceptionsFilter(mkConfig(true));
      const { host, json } = mkHost();
      filter.catch(new Error('leaky driver message'), host);
      const body = json.mock.calls[0][0];
      expect(body.error.message).toBe('Internal server error');
      expect(body.error).not.toHaveProperty('details');
    });
  });

  describe('requestId propagation', () => {
    it('copies req.id into the error envelope', () => {
      const filter = new AllExceptionsFilter(mkConfig());
      const { host, json } = mkHost({ id: 'req-abc' });
      filter.catch(new Error('x'), host);
      expect(json.mock.calls[0][0].error.requestId).toBe('req-abc');
    });

    it('falls back to the x-request-id header when req.id is missing', () => {
      const filter = new AllExceptionsFilter(mkConfig());
      const { host, json } = mkHost({
        header: (k) => (k === 'x-request-id' ? 'hdr-1' : undefined),
      });
      filter.catch(new Error('x'), host);
      expect(json.mock.calls[0][0].error.requestId).toBe('hdr-1');
    });
  });

  it('flattens HttpException array messages into a single string', () => {
    const filter = new AllExceptionsFilter(mkConfig());
    const { host, json } = mkHost();
    filter.catch(new HttpException({ message: ['a', 'b'] }, 400), host);
    expect(json.mock.calls[0][0].error.message).toBe('a; b');
  });

  it('omits HttpException details payload in production even for 4xx responses', () => {
    const filter = new AllExceptionsFilter(mkConfig(true));
    const { host, json } = mkHost();
    filter.catch(new HttpException({ message: 'bad', hint: 'internal-detail' }, 400), host);
    const body = json.mock.calls[0][0];
    expect(body.error).not.toHaveProperty('details');
    // The normalized message is still safe — no leak of the "internal-detail" field.
    expect(JSON.stringify(body)).not.toContain('internal-detail');
  });

  it('exposes HttpException details in non-production to aid debugging', () => {
    const filter = new AllExceptionsFilter(mkConfig(false));
    const { host, json } = mkHost();
    filter.catch(new HttpException({ message: 'bad', hint: 'context' }, 400), host);
    expect(json.mock.calls[0][0].error).toHaveProperty('details');
  });

  describe('safe messages for structured-code HttpExceptions (no class-name leak)', () => {
    // Regression: before the fix, the filter fell back to `exception.message`
    // when the response payload carried only a `code`. NestJS auto-derives
    // that message from the class name, so users saw "Unauthorized Exception"
    // literally rendered on the login form after a password reset. These
    // tests lock in that every IAM throw site produces a safe, user-facing
    // string even when the throw site supplied only `{ code }`.

    const cases: Array<[() => HttpException, string, string, number]> = [
      [
        () => new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' }),
        'AUTH_INVALID_CREDENTIALS',
        'Invalid email or password.',
        401,
      ],
      [
        () => new UnauthorizedException({ code: 'AUTH_ACCOUNT_LOCKED' }),
        'AUTH_ACCOUNT_LOCKED',
        'Account temporarily locked. Please try again later or reset your password.',
        401,
      ],
      [
        () => new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' }),
        'AUTH_REFRESH_INVALID',
        'Your session has expired. Please sign in again.',
        401,
      ],
      [
        () => new ForbiddenException({ code: 'AUTH_ACCOUNT_SUSPENDED' }),
        'AUTH_ACCOUNT_SUSPENDED',
        'This account has been suspended.',
        403,
      ],
      [
        () => new ForbiddenException({ code: 'AUTH_ACCOUNT_UNVERIFIED' }),
        'AUTH_ACCOUNT_UNVERIFIED',
        'Please verify your email before signing in.',
        403,
      ],
      [
        () => new BadRequestException({ code: 'AUTH_CSRF_FAILED' }),
        'AUTH_CSRF_FAILED',
        'Request rejected. Please refresh the page and try again.',
        400,
      ],
      [
        () => new BadRequestException({ code: 'AUTH_OTP_INVALID' }),
        'AUTH_OTP_INVALID',
        'Incorrect code.',
        400,
      ],
    ];

    it.each(cases)(
      'exception → stable code + safe message (%#)',
      (make, expectedCode, expectedMessage, expectedStatus) => {
        const filter = new AllExceptionsFilter(mkConfig());
        const { host, status, json } = mkHost();
        filter.catch(make(), host);
        expect(status).toHaveBeenCalledWith(expectedStatus);
        const body = json.mock.calls[0][0];
        expect(body.error.code).toBe(expectedCode);
        expect(body.error.message).toBe(expectedMessage);
        // Crucially: the message MUST NOT be any NestJS class-name-derived
        // string. If someone later removes defaultMessageFor(), this fails.
        expect(body.error.message).not.toMatch(/Exception$/);
        expect(body.error.message).not.toBe('Unauthorized Exception');
        expect(body.error.message).not.toBe('Forbidden Exception');
        expect(body.error.message).not.toBe('Bad Request Exception');
      },
    );

    it('honors an explicit message when one is provided in the payload', () => {
      const filter = new AllExceptionsFilter(mkConfig());
      const { host, json } = mkHost();
      filter.catch(
        new BadRequestException({ code: 'VALIDATION_ERROR', message: 'email must be valid' }),
        host,
      );
      expect(json.mock.calls[0][0].error.message).toBe('email must be valid');
    });

    it('unknown code + unmapped status still produces a safe string', () => {
      const filter = new AllExceptionsFilter(mkConfig());
      const { host, json } = mkHost();
      filter.catch(new HttpException({ code: 'NEW_CODE_NOT_IN_MAP' }, 418), host);
      const msg = json.mock.calls[0][0].error.message;
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toMatch(/Exception$/);
    });
  });

  it('normalized error envelope shape is { success: false, error: { code, message, ... } }', () => {
    const filter = new AllExceptionsFilter(mkConfig());
    const { host, json } = mkHost();
    filter.catch(new BadRequestException('x'), host);
    const body = json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('object');
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
  });
});
