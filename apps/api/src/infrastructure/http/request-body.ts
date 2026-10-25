import express from 'express';
import { HttpException } from '@nestjs/common';

// One parser boundary for the real bootstrap and its HTTP regression tests.
// Raw signed uploads/feedback must retain their exact bytes before JSON parsing.
export function buildRequestBodyParser(): express.Router {
  const router = express.Router();
  router.post(
    '/v1/money/webhooks/stripe',
    express.raw({ type: 'application/json', limit: 65_536, inflate: false }),
  );
  router.use('/v1/mail/feedback', express.raw({ type: '*/*', limit: '256kb' }));
  router.use('/v1/media/uploads', express.raw({ type: '*/*', limit: '10mb' }));
  router.use(express.json({ limit: '1mb' }));
  // Normalize BEFORE Nest maps a SyntaxError to BadRequestException(message).
  // JSON parser messages can contain submitted passwords/tokens, even in prod.
  router.use(
    (error: unknown, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const bodyError = error as { type?: unknown; status?: unknown } | null;
      const type = bodyError?.type;
      const status = bodyError?.status;
      if ((type === 'entity.too.large' || type === 'parameters.too.many') && status === 413) {
        next(
          new HttpException(
            { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
            413,
          ),
        );
      } else if (
        (type === 'entity.parse.failed' ||
          type === 'request.size.invalid' ||
          type === 'request.aborted') &&
        status === 400
      ) {
        next(
          new HttpException({ code: 'VALIDATION_ERROR', message: 'Invalid request body.' }, 400),
        );
      } else if (
        (type === 'encoding.unsupported' || type === 'charset.unsupported') &&
        status === 415
      ) {
        next(
          new HttpException(
            { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported request encoding.' },
            415,
          ),
        );
      } else {
        next(error);
      }
    },
  );
  return router;
}
