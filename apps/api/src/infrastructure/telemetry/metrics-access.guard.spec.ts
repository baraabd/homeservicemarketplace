import { ExecutionContext, NotFoundException } from '@nestjs/common';

import type { AppConfigService } from '../../config/app-config.service';
import { MetricsAccessGuard } from './metrics-access.guard';

// Sprint 3 — /metrics is no longer world-readable.
//
// The property under test is that the endpoint is closed by DEFAULT in
// production. Every other behaviour here is a convenience around that; if the
// unconfigured production case ever returns true again, the endpoint is open
// to the internet and these tests are the only thing that would say so.

const TOKEN = 'a-metrics-token-at-least-16';

function makeConfig(over: { token?: string; production?: boolean } = {}): AppConfigService {
  return {
    get: (key: string) => (key === 'METRICS_TOKEN' ? over.token : undefined),
    get isProduction() {
      return over.production ?? false;
    },
  } as unknown as AppConfigService;
}

function makeContext(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name.toLowerCase() === 'authorization' ? authorization : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsAccessGuard', () => {
  describe('no token configured', () => {
    it('is OPEN outside production so local runs are unchanged', () => {
      const guard = new MetricsAccessGuard(makeConfig({ production: false }));
      expect(guard.canActivate(makeContext())).toBe(true);
    });

    it('is CLOSED in production — the default must not be "exposed"', () => {
      const guard = new MetricsAccessGuard(makeConfig({ production: true }));
      expect(() => guard.canActivate(makeContext())).toThrow(NotFoundException);
    });

    it('warns once, not once per scrape', () => {
      const guard = new MetricsAccessGuard(makeConfig({ production: true }));
      const warn = jest.spyOn(
        (guard as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      );
      for (let i = 0; i < 5; i += 1) {
        expect(() => guard.canActivate(makeContext())).toThrow(NotFoundException);
      }
      // Prometheus polls on an interval; a per-request warning would drown the
      // log in the one situation an operator most needs to read it.
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('token configured', () => {
    const config = makeConfig({ token: TOKEN, production: true });

    it('admits a correct bearer token', () => {
      const guard = new MetricsAccessGuard(config);
      expect(guard.canActivate(makeContext(`Bearer ${TOKEN}`))).toBe(true);
    });

    it('rejects a missing Authorization header', () => {
      const guard = new MetricsAccessGuard(config);
      expect(() => guard.canActivate(makeContext())).toThrow(NotFoundException);
    });

    it('rejects a wrong token', () => {
      const guard = new MetricsAccessGuard(config);
      expect(() => guard.canActivate(makeContext('Bearer nope-nope-nope-nope'))).toThrow(
        NotFoundException,
      );
    });

    it('rejects a token of the right length but wrong content', () => {
      // Guards against a length-only comparison sneaking in.
      const sameLength = 'X'.repeat(TOKEN.length);
      const guard = new MetricsAccessGuard(config);
      expect(() => guard.canActivate(makeContext(`Bearer ${sameLength}`))).toThrow(
        NotFoundException,
      );
    });

    it('rejects the raw token without the Bearer scheme', () => {
      const guard = new MetricsAccessGuard(config);
      expect(() => guard.canActivate(makeContext(TOKEN))).toThrow(NotFoundException);
    });

    it('answers 404 rather than 401, so a prober learns nothing', () => {
      // A 401 confirms "this endpoint exists and wants a credential", which is
      // an invitation. A 404 makes a wrong token and a nonexistent route
      // indistinguishable from outside.
      const guard = new MetricsAccessGuard(config);
      try {
        guard.canActivate(makeContext('Bearer wrong'));
        throw new Error('expected the guard to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as NotFoundException).getStatus()).toBe(404);
      }
    });
  });
});
