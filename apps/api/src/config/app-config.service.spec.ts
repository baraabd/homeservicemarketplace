import type { ConfigService } from '@nestjs/config';

import { AppConfigService } from './app-config.service';

function mkNestConfig(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('AppConfigService', () => {
  it('get() delegates to the underlying Nest ConfigService', () => {
    const svc = new AppConfigService(
      mkNestConfig({ NODE_ENV: 'development', PORT: 4000, REDIS_TLS: false }),
    );
    expect(svc.get('NODE_ENV')).toBe('development');
    expect(svc.get('PORT')).toBe(4000);
    expect(svc.get('REDIS_TLS')).toBe(false);
  });

  describe('isProduction', () => {
    it('is true only when NODE_ENV === "production"', () => {
      expect(new AppConfigService(mkNestConfig({ NODE_ENV: 'production' })).isProduction).toBe(
        true,
      );
    });

    it('is false for development / test / staging', () => {
      for (const env of ['development', 'test', 'staging']) {
        expect(new AppConfigService(mkNestConfig({ NODE_ENV: env })).isProduction).toBe(false);
      }
    });
  });

  describe('isTest', () => {
    it('is true only when NODE_ENV === "test"', () => {
      expect(new AppConfigService(mkNestConfig({ NODE_ENV: 'test' })).isTest).toBe(true);
    });

    it('is false for any other NODE_ENV', () => {
      for (const env of ['development', 'staging', 'production']) {
        expect(new AppConfigService(mkNestConfig({ NODE_ENV: env })).isTest).toBe(false);
      }
    });
  });
});
