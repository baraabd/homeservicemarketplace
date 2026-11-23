import type { Request } from 'express';
import { BadRequestException } from '@nestjs/common';
import { resolveAccessToken } from './jwt.strategy';

function request(cookies: Record<string, string>, bearer?: string): Request {
  return { cookies, header: () => bearer } as unknown as Request;
}

describe('access cookie namespace', () => {
  it('selects only the configured namespace and preserves the default', () => {
    const cookies = { hsm_at: 'production', hsm_staging_at: 'staging' };
    const stagingRequest = request(cookies);
    expect(resolveAccessToken(stagingRequest, 'hsm_staging_at')).toBe('staging');
    expect(stagingRequest.authTransport).toBe('cookie');
    expect(resolveAccessToken(request(cookies))).toBe('production');
    expect(resolveAccessToken(request({ hsm_at: 'production' }), 'hsm_staging_at')).toBeNull();
  });

  it('still rejects ambiguous configured-cookie and bearer transports', () => {
    expect(() =>
      resolveAccessToken(request({ hsm_staging_at: 'staging' }, 'Bearer mobile'), 'hsm_staging_at'),
    ).toThrow(BadRequestException);
    expect(
      resolveAccessToken(
        request({ hsm_at: 'other-environment' }, 'Bearer mobile'),
        'hsm_staging_at',
      ),
    ).toBe('mobile');
  });
});
