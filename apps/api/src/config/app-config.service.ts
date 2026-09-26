import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnv } from './env.schema';
import { isHardenedRuntime } from './runtime-policy';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  get<K extends keyof AppEnv>(key: K): AppEnv[K] {
    return this.config.get(key, { infer: true }) as AppEnv[K];
  }

  get isProduction(): boolean {
    // Historical property name; staging must not bind mock mail/scanners or expose diagnostics.
    return isHardenedRuntime({ NODE_ENV: this.get('NODE_ENV'), APP_ENV: this.get('APP_ENV') });
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }
}
