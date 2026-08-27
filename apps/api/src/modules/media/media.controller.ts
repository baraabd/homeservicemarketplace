import { AppConfigService } from '../../config/app-config.service';
import { portfolioOwnerRef } from '../provider/portfolio/portfolio-policy';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { LocalDiskStorageAdapter } from '../../infrastructure/storage/local-disk-storage.adapter';
import {
  STORAGE_PORT,
  StoragePort,
  PresignedUpload,
} from '../../infrastructure/storage/storage.port';
import {
  ALLOWED_CONTENT_TYPES,
  ContentType,
  extensionForContentType,
} from '../../infrastructure/storage/content-type';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { Public } from '../iam/authentication/decorators/public.decorator';
import { AppError } from '../../shared/errors/app-error';
import { PresignUploadRequestDto } from './dto/presign-upload.dto';
import { isRestrictedKey } from '../provider/verification/media/evidence-keys';

// Sprint 7.x — media upload pipeline.
//
// Three routes, three jobs:
//
//   POST /v1/media/presigned-url  (auth required)
//     The frontend calls this BEFORE the binary upload. The body lists
//     each file's content type + size. We synthesise a server-side key
//     for each, ask the StoragePort to presign a PUT URL, and return
//     `{ uploadUrl, fileUrl, expiresAt }` per item. The frontend then
//     PUTs each File directly to its uploadUrl in parallel.
//
//   PUT  /v1/media/uploads/:key  (signature-required, no JWT)
//     ONLY used by the local-disk backend. The presigned URL carries
//     an HMAC-signed `?sig=...&exp=...&ct=...&sz=...` query string
//     that this route validates before writing the binary to disk. JWT
//     auth is intentionally NOT required — the presigned URL IS the
//     auth, exactly like S3. (When STORAGE_DRIVER=s3 the browser PUTs
//     hit S3 directly and never reach this route.)
//
//   GET  /v1/media/files/:key  (public)
//     Public read of the uploaded blob. ServiceRequest.mediaUrls[]
//     stores fileUrl values that resolve here for the local backend.
//     S3 URLs resolve to S3 directly. Both backends produce URLs the
//     provider's UI can drop into an <img> tag without any extra
//     header / token handshake.
//
// Size cap + content-type whitelist come from
// apps/api/src/infrastructure/storage/content-type.ts (single source
// of truth; the DTO's @IsIn + @Max wire to those constants).

@Controller({ path: 'media', version: '1' })
export class MediaController {
  private readonly log = new Logger(MediaController.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly local: LocalDiskStorageAdapter,
    private readonly config: AppConfigService,
  ) {}

  // ─── Presign batch ───────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  async presignUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PresignUploadRequestDto,
  ): Promise<{ items: PresignedUpload[] }> {
    // Synthesise a server-side key per item. We never use the
    // caller's filename — the extension is derived from the
    // validated contentType. Path layout: `requests/<userId>/<uuid>.<ext>`
    // so a future cleanup job can scope by user.
    const items = await Promise.all(
      body.items.map((item) => {
        const ext = extensionForContentType(item.contentType as ContentType);
        // Sprint 9B.10 — namespace by purpose, from a WHITELIST. Portfolio
        // media is public and permanent; request media is public and tied to a
        // job. Separate prefixes let a cleanup job, a bucket policy and a CDN
        // rule scope to one without parsing anything, and let the portfolio
        // route refuse a key that did not come from its own namespace.
        //
        // Note what is NOT here: the caller's filename, and any caller-supplied
        // prefix. The purpose selects between two server-owned constants.
        // Portfolio keys carry an OPAQUE owner ref, because a portfolio image
        // URL is public: it is handed to every customer who views the gallery,
        // and a raw user id in that URL publishes an internal identifier that
        // correlates the provider across every other surface.
        //
        // Request media keeps the existing layout — those URLs are shown only
        // to the seeker and the bidding providers, and changing the scheme
        // would orphan every URL already stored in ServiceRequest.mediaUrls[].
        if (body.purpose === 'portfolio') {
          const ref = portfolioOwnerRef(user.id, String(this.config.get('JWT_ACCESS_SECRET')));
          return this.storage.presignUpload({
            key: `portfolio/${ref}/${randomUUID()}.${ext}`,
            contentType: item.contentType as ContentType,
            sizeBytes: item.sizeBytes,
          });
        }
        const key = `requests/${user.id}/${randomUUID()}.${ext}`;
        return this.storage.presignUpload({
          key,
          contentType: item.contentType as ContentType,
          sizeBytes: item.sizeBytes,
        });
      }),
    );
    this.log.log({ msg: 'media.presigned', userId: user.id, count: items.length });
    return { items };
  }

  // ─── Local-disk PUT acceptor ────────────────────────────────────────────
  //
  // @Public — JWT auth is not required; the presigned URL's HMAC
  // signature IS the auth (mirrors S3). The CsrfGuard is also off
  // for the same reason: presigned PUT is its own auth model.
  //
  // express.raw() is wired on this route in main.ts so `req.body` is
  // a Buffer of the request bytes regardless of Content-Type.

  @Public()
  @Put('uploads/*')
  @HttpCode(HttpStatus.NO_CONTENT)
  async acceptUpload(
    @Req() req: Request,
    @Headers('content-type') actualContentType: string | undefined,
    @Query('sig') sig: string,
    @Query('exp') exp: string,
    @Query('ct') ct: string,
    @Query('sz') sz: string,
  ): Promise<void> {
    // Recover the key from the request URL — Nest's wildcard `*`
    // matching is unreliable across versions, so we slice the prefix
    // off req.path manually. Decoded segments preserve the original
    // synthesised key.
    const prefix = '/v1/media/uploads/';
    const idx = req.path.indexOf(prefix);
    const rawKey = idx >= 0 ? req.path.slice(idx + prefix.length) : '';
    const key = decodeURIComponent(rawKey);

    // Sprint 9B — the write half of the same boundary (docs/adr/0009 §3).
    //
    // This route's auth IS the HMAC signature, so a key that the presign
    // endpoint would never mint cannot normally appear here. Refusing anyway
    // means an attacker who ever obtains a signing capability still cannot
    // write INTO the restricted namespace and have a reviewer read it as
    // evidence — which would be evidence forgery, not just a file upload.
    if (isRestrictedKey(key)) {
      this.log.warn({ msg: 'media.public.restricted_key_write_refused' });
      throw new AppError('VALIDATION_ERROR', 'Upload rejected.', 400);
    }

    if (!sig || !exp || !ct || !sz) {
      throw new AppError('VALIDATION_ERROR', 'Missing presign parameters.', 400);
    }
    if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(ct)) {
      throw new AppError('VALIDATION_ERROR', 'Disallowed content type.', 400);
    }
    const sizeBytes = Number.parseInt(sz, 10);
    const expSeconds = Number.parseInt(exp, 10);
    if (!Number.isFinite(sizeBytes) || !Number.isFinite(expSeconds)) {
      throw new AppError('VALIDATION_ERROR', 'Invalid presign parameters.', 400);
    }

    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body)) {
      throw new AppError('VALIDATION_ERROR', 'Upload body missing.', 400);
    }

    try {
      await this.local.acceptUpload({
        key,
        sig,
        exp: expSeconds,
        contentType: ct,
        sizeBytes,
        body,
        actualContentType: actualContentType ?? null,
      });
    } catch (err) {
      const reason = (err as Error).message;
      // Map adapter signals to safe HTTP shapes. Internals never reach
      // the wire.
      if (reason === 'expired' || reason === 'signature-mismatch') {
        throw new AppError('UNAUTHORIZED', 'Upload URL invalid or expired.', 401);
      }
      if (
        reason === 'content-type-mismatch' ||
        reason === 'size-mismatch' ||
        reason === 'invalid-key' ||
        reason === 'path-escape'
      ) {
        throw new AppError('VALIDATION_ERROR', 'Upload rejected.', 400);
      }
      this.log.error({ msg: 'media.upload.failed', key, err: reason });
      throw new AppError('INTERNAL_ERROR', 'Could not store upload.', 500);
    }
  }

  // ─── Local-disk GET serve ───────────────────────────────────────────────

  @Public()
  @Get('files/*')
  async serveFile(@Req() req: Request, @Res() res: Response): Promise<void> {
    const prefix = '/v1/media/files/';
    const idx = req.path.indexOf(prefix);
    const rawKey = idx >= 0 ? req.path.slice(idx + prefix.length) : '';
    const key = decodeURIComponent(rawKey);

    // Sprint 9B — this route is @Public(), unauthenticated, and sets
    // `Cache-Control: public, immutable`. Identity evidence must therefore be
    // unreachable from it (docs/adr/0009 §3).
    //
    // Restricted objects already live in a separate bucket/root, so in a
    // correctly configured deployment this branch is unreachable. It exists
    // for the deployment that is NOT correctly configured — a shared root, a
    // copied env file — where configuration alone would silently serve a
    // passport to the internet with a one-year cache header.
    //
    // 404, not 403: a distinguishable response would confirm to an
    // unauthenticated prober that a given case id exists.
    if (isRestrictedKey(key)) {
      this.log.warn({ msg: 'media.public.restricted_key_refused' });
      throw new AppError('NOT_FOUND', 'File not found.', 404);
    }

    let absPath: string;
    try {
      absPath = this.local.absolutePathForKey(key);
    } catch {
      throw new AppError('NOT_FOUND', 'File not found.', 404);
    }
    const exists = await this.local.fileExists(key);
    if (!exists) throw new AppError('NOT_FOUND', 'File not found.', 404);

    // Stream the file. Cache-Control is conservative: media bytes are
    // immutable (object keys are random UUIDs) so we set a long max-age
    // + immutable so CDN / browser caches can hold them indefinitely.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    createReadStream(absPath).pipe(res);
  }
}
