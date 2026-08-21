import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppConfigService } from '../../config/app-config.service';
import { AppError, type AppErrorCode } from '../../shared/errors/app-error';
import { REQUEST_ID_HEADER } from './request-id.middleware';

interface ErrorBody {
  success: false;
  error: {
    code: AppErrorCode | string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

interface NormalizedError {
  status: number;
  code: AppErrorCode | string;
  message: string;
  details?: unknown;
  /**
   * True when `details` was AUTHORED by our own domain code (an AppError we
   * constructed) rather than harvested from a framework/driver exception.
   *
   * Framework details are suppressed in production because they can carry
   * internal shapes; authored details are part of the API contract. Collapsing
   * the two is why POST /v1/me/provider/submit-for-review would have returned
   * its 422 with an EMPTY missing-field list in production — exactly the
   * machine-readable payload the client needs to tell the user what to fix.
   */
  detailsAreAuthored?: boolean;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly config: AppConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const { status, code, message, details, detailsAreAuthored } = this.normalize(exception);
    const headerId = req.header(REQUEST_ID_HEADER);
    const requestId = req.id != null ? String(req.id) : (headerId ?? undefined);

    const body: ErrorBody = {
      success: false,
      error: {
        code,
        message,
        requestId,
        ...(details !== undefined && (detailsAreAuthored || !this.config.isProduction)
          ? { details }
          : {}),
      },
    };

    if (status >= 500) {
      this.logger.error({
        msg: 'Unhandled exception',
        status,
        code,
        requestId,
        path: req.url,
        err: this.serializeError(exception),
      });
    } else {
      this.logger.debug({ msg: 'Handled exception', status, code, requestId, path: req.url });
    }

    res.status(status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
        // AppError details are hand-built by domain code (e.g. the provider
        // onboarding 422's machine-readable missing-field list), never a raw
        // driver payload, so they are part of the contract in every
        // environment. Anything that could leak internals must not be put
        // here in the first place.
        detailsAreAuthored: true,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      // Honor a structured `code` in the response body. IAM throws
      // `new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' })` etc.;
      // the status-derived code ('UNAUTHORIZED') would erase that stable
      // domain code. Falls back to the status-derived code for plain
      // `new BadRequestException('bad body')` callers.
      if (typeof resp === 'object' && resp !== null) {
        const structured = resp as { code?: unknown; message?: string | string[] };
        const code =
          typeof structured.code === 'string' ? structured.code : this.mapHttpStatusToCode(status);
        // NestJS's HttpException constructor derives `this.message` from the
        // class name when the response object carries no `message` field —
        // `new UnauthorizedException({ code: 'X' })` ends up with
        // exception.message === "Unauthorized Exception". Falling back to
        // that here leaks a framework artifact straight into the client
        // (users literally saw "Unauthorized Exception" on the login form
        // after a password reset). Only honor an explicit `message` from the
        // payload; otherwise use the stable code/status mapping so the wire
        // always carries a safe, user-facing string.
        const explicit = structured.message;
        const message =
          explicit !== undefined
            ? Array.isArray(explicit)
              ? explicit.join('; ')
              : explicit
            : this.defaultMessageFor(code, status);
        return {
          status,
          code,
          message,
          details: resp,
        };
      }
      return {
        status,
        code: this.mapHttpStatusToCode(status),
        message: resp,
        details: undefined,
      };
    }

    const err = exception as { code?: string; name?: string } | undefined;
    // Prisma known request errors — translated to stable domain codes so client
    // never sees driver-internal messages, schema names, or constraint names.
    switch (err?.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'Resource already exists',
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'Related resource constraint violated',
        };
      case 'P2014':
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'Required relation violated',
        };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'Resource not found' };
      case 'P2034':
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'Transaction conflict, retry the request',
        };
      default:
        break;
    }
    // Catch-all for any other PrismaClient* error class (e.g. P2022 column
    // mismatch, validation errors, init failures, panics). The slice-2
    // outage shipped a leaking raw "column addresses.type does not exist"
    // string straight to the browser because P2022 fell through to the
    // dev-mode `exception.message` path below. Anything Prisma-shaped is
    // an infrastructure problem from the client's point of view —
    // collapse to a stable 500 with a safe message regardless of env. The
    // detail is still recorded in the structured server log above for
    // debugging.
    if (this.isPrismaError(exception)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      };
    }
    // Mongoose validation / cast errors
    if (err?.name === 'ValidationError') {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Invalid document',
      };
    }
    if (err?.name === 'CastError') {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Invalid identifier',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: this.config.isProduction
        ? 'Internal server error'
        : ((exception as Error)?.message ?? 'Internal server error'),
    };
  }

  // True when the exception originates from any @prisma/client error
  // class. We match by class name so we don't have to import the Prisma
  // error classes here (and accidentally couple the HTTP layer to the
  // Prisma client). Names checked: PrismaClientKnownRequestError,
  // PrismaClientUnknownRequestError, PrismaClientValidationError,
  // PrismaClientInitializationError, PrismaClientRustPanicError.
  private isPrismaError(exception: unknown): boolean {
    if (exception === null || typeof exception !== 'object') return false;
    const ctorName = (exception as { constructor?: { name?: string } }).constructor?.name;
    if (typeof ctorName === 'string' && ctorName.startsWith('PrismaClient')) return true;
    // PrismaClientValidationError doesn't always carry a `.code`. Detect
    // it by `.name` as a defensive secondary signal.
    const errName = (exception as { name?: string }).name;
    if (typeof errName === 'string' && errName.startsWith('PrismaClient')) return true;
    return false;
  }

  // Safe, user-facing default message for an error we know the code of but
  // that wasn't given an explicit `message` at throw time. Keeps the wire
  // free of framework-derived strings like "Unauthorized Exception" and
  // gives the frontend something non-alarming to fall back on when it
  // doesn't yet recognize a code.
  private defaultMessageFor(code: string, status: number): string {
    switch (code) {
      case 'AUTH_INVALID_CREDENTIALS':
        return 'Invalid email or password.';
      case 'AUTH_ACCOUNT_LOCKED':
        return 'Account temporarily locked. Please try again later or reset your password.';
      case 'AUTH_ACCOUNT_SUSPENDED':
        return 'This account has been suspended.';
      case 'AUTH_ACCOUNT_UNVERIFIED':
        return 'Please verify your email before signing in.';
      case 'AUTH_REFRESH_INVALID':
        return 'Your session has expired. Please sign in again.';
      case 'AUTH_TOKEN_EXPIRED':
        return 'Your session has expired. Please sign in again.';
      case 'AUTH_CSRF_FAILED':
        return 'Request rejected. Please refresh the page and try again.';
      case 'AUTH_AMBIGUOUS_TRANSPORT':
        return 'Request rejected.';
      case 'AUTH_MFA_REQUIRED':
        return 'Additional verification is required.';
      case 'AUTH_OTP_INVALID':
        return 'Incorrect code.';
      case 'AUTH_OTP_EXPIRED':
        return 'This code has expired.';
      case 'AUTH_OTP_LOCKED':
        return 'Too many attempts. Please sign in again.';
      case 'AUTH_OTP_RESEND_EXCEEDED':
        return 'Resend limit reached. Please sign in again.';
      default:
        break;
    }
    switch (status) {
      case 400:
        return 'Invalid request.';
      case 401:
        return 'Authentication required.';
      case 403:
        return 'You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 409:
        return 'Conflict with the current state of the resource.';
      case 429:
        return 'Too many requests. Please try again shortly.';
      default:
        return status >= 500 ? 'Internal server error' : 'Request failed.';
    }
  }

  private mapHttpStatusToCode(status: number): AppErrorCode | string {
    switch (status) {
      case 400:
        return 'VALIDATION_ERROR';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 429:
        return 'RATE_LIMITED';
      case 503:
        return 'DEPENDENCY_UNAVAILABLE';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`;
    }
  }

  private serializeError(exception: unknown): Record<string, unknown> {
    if (exception instanceof Error) {
      return {
        name: exception.name,
        message: exception.message,
        stack: this.config.isProduction ? undefined : exception.stack,
      };
    }
    return { value: String(exception) };
  }
}
