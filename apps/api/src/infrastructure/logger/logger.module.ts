import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AppConfigService } from '../../config/app-config.service';
import { ConfigModule } from '../../config/config.module';
import { REQUEST_ID_HEADER } from '../http/request-id.middleware';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.otp',
  'res.headers["set-cookie"]',
];

type WithId = IncomingMessage & { id?: string };

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const isProd = config.isProduction;
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL'),
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const r = req as WithId;
              const headerVal = req.headers[REQUEST_ID_HEADER];
              const fromHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
              const id = r.id || fromHeader || randomUUID();
              r.id = id;
              if (!res.getHeader(REQUEST_ID_HEADER)) res.setHeader(REQUEST_ID_HEADER, id);
              return id;
            },
            customProps: (req: IncomingMessage) => ({ requestId: (req as WithId).id }),
            redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { colorize: true, singleLine: true, translateTime: 'SYS:standard' },
                },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
