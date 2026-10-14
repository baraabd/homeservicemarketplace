import { Logger, Module } from '@nestjs/common';
import { createRequire } from 'node:module';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { AppConfigService } from '../../config/app-config.service';
import { ConfigModule } from '../../config/config.module';
import { buildPinoHttpOptions } from './pino-http-options';

// Resolve a module to its absolute entry path, or return null if it isn't
// installed. pino's transport loader runs in a worker thread and uses
// pino's OWN require context — under pnpm's strict isolation, a bare
// `target: 'pino-pretty'` string fails to resolve even when pino-pretty is
// a direct dependency of the consuming app (it lives outside pino's
// module resolution root). Passing the fully resolved absolute path
// bypasses that issue and matches the recommended pnpm workaround.
function tryResolve(moduleId: string): string | null {
  try {
    if (typeof require !== 'undefined' && typeof require.resolve === 'function') {
      return require.resolve(moduleId);
    }
    const req = createRequire(__filename);
    return req.resolve(moduleId);
  } catch {
    return null;
  }
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const isProd = config.isProduction;

        // Production ships plain JSON logs (no transport). Non-prod tries
        // to use pino-pretty, but DOES NOT abort boot if it's unresolvable
        // — a dev-only convenience should never take the whole API down.
        //
        // Pass the RESOLVED absolute path (not the bare module id) so pino's
        // worker-thread transport loader can find it under pnpm's strict
        // node_modules isolation. See pinojs/pino#1617.
        let transport: { target: string; options: Record<string, unknown> } | undefined;
        if (!isProd) {
          const resolvedPath = tryResolve('pino-pretty');
          if (resolvedPath) {
            transport = {
              target: resolvedPath,
              options: { colorize: true, singleLine: true, translateTime: 'SYS:standard' },
            };
          } else {
            new Logger('LoggerModule').warn(
              'pino-pretty is not resolvable; falling back to plain JSON logs. ' +
                'Run `pnpm install` to restore pretty dev logging. Prod behavior is unchanged.',
            );
          }
        }

        return { pinoHttp: { ...buildPinoHttpOptions(config.get('LOG_LEVEL')), transport } };
      },
    }),
  ],
})
export class LoggerModule {}
