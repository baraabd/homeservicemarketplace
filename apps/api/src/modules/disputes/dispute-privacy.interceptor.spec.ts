import { lastValueFrom, throwError } from 'rxjs';
import { BadRequestException, type ExecutionContext } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error';
import { DisputePrivacyInterceptor, safeDisputeError } from './dispute-privacy.interceptor';

it.each(['P2002', 'P2003', 'P2014', 'P2034'])('retains safe conflict semantics without exposing %s driver arguments', (code) => {
  const error = safeDisputeError(Object.assign(new Error('PRIVATE_STATEMENT'), { code }));
  expect(error.status).toBe(409);
  expect(String(error)).not.toContain('PRIVATE_STATEMENT');
  expect(JSON.stringify(error)).not.toContain('PRIVATE_STATEMENT');
});
it('retains a missing resource without leaking the driver message', () => {
  expect(safeDisputeError({ code: 'P2025', message: 'PRIVATE_STATEMENT' })).toMatchObject({ status: 404 });
});
it('preserves authored errors but never carries raw attached details or causes', () => {
  const input = new AppError('CONFLICT', 'Reload before retrying.', 409, { private: 'PRIVATE_STATEMENT' });
  const result = safeDisputeError(input);
  expect(result).toMatchObject({ status: 409, code: 'CONFLICT', message: 'Reload before retrying.' });
  expect(result.details).toBeUndefined();
});
it('replaces unknown exceptions before the shared HTTP logger can serialize them', async () => {
  const result = new DisputePrivacyInterceptor().intercept({} as ExecutionContext, {
    handle: () => throwError(() => new Error('PRIVATE_STATEMENT')),
  });
  await expect(lastValueFrom(result)).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
  const safe = safeDisputeError(new Error('PRIVATE_STATEMENT'));
  expect(safe.stack).not.toContain('PRIVATE_STATEMENT');
  expect(JSON.stringify(safe)).not.toContain('PRIVATE_STATEMENT');
});

it('keeps validation failures as 400 without echoing invalid field values', () => {
  const safe = safeDisputeError(new BadRequestException('PRIVATE_STATEMENT'));
  expect(safe.status).toBe(400);
  expect(String(safe)).not.toContain('PRIVATE_STATEMENT');
});
