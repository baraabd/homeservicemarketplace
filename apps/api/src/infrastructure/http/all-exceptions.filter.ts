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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly config: AppConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const { status, code, message, details } = this.normalize(exception);
    const headerId = req.header(REQUEST_ID_HEADER);
    const requestId = req.id != null ? String(req.id) : (headerId ?? undefined);

    const body: ErrorBody = {
      success: false,
      error: {
        code,
        message,
        requestId,
        ...(details !== undefined && !this.config.isProduction ? { details } : {}),
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

  private normalize(exception: unknown): {
    status: number;
    code: AppErrorCode | string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
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
        const msg = structured.message ?? exception.message;
        return {
          status,
          code,
          message: Array.isArray(msg) ? msg.join('; ') : msg,
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
