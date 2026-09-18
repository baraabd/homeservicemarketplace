import { BadRequestException, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';
import { AppError } from '../../shared/errors/app-error';

/** Driver error messages can echo query arguments. Never send them to the shared logger. */
export function safeDisputeError(error: unknown): AppError {
  if (error instanceof AppError) {
    // Intake owns only fixed authored messages, without external details or causes.
    return new AppError(error.code, error.message, error.status);
  }
  if (error instanceof BadRequestException)
    return new AppError('VALIDATION_ERROR', 'The support request contains invalid fields.', 400);
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2025') return new AppError('NOT_FOUND', 'Support case or booking not found.', 404);
  if (['P2002', 'P2003', 'P2014', 'P2034'].includes(String(code)))
    return new AppError('CONFLICT', 'Support data changed. Reload before retrying.', 409);
  // Preserve a failure signal and request correlation, not raw values/stack/cause.
  return new AppError('DEPENDENCY_UNAVAILABLE', 'Support is temporarily unavailable. Try again.', 503);
}

@Injectable()
export class DisputePrivacyInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((error: unknown) => throwError(() => safeDisputeError(error))));
  }
}
