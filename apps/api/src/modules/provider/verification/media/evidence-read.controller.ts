import { Controller, Get, Inject, Logger, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';

import {
  RESTRICTED_OBJECT_STORAGE,
  RestrictedObjectStoragePort,
} from '../../../../infrastructure/storage/restricted-object-storage.port';
import { AppError } from '../../../../shared/errors/app-error';
import { CurrentUser } from '../../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../iam/authentication/types/authenticated-user';
import { PermissionResolverService } from '../../../iam/authorization/services/permission-resolver.service';
import { EvidenceReadService } from './evidence-read.service';

// Sprint 9B — THE only route that serves restricted identity evidence.
//
// docs/adr/0009-restricted-identity-media.md §3
//
// Deliberately NOT under /v1/media. That router is public-media territory: its
// GET is @Public() and sets `Cache-Control: public, immutable`. Putting this
// beside it invites someone to "unify" the two routes one day, which is the
// merge that ends with a passport on a CDN.
//
// The response is streamed through the API rather than redirecting to a signed
// object-store URL. A signed URL is a bearer credential that outlives the
// request, lands in browser history and referrers, and cannot be revoked once
// issued. Streaming costs bandwidth and buys revocability, a real audit point,
// and no credential on the wire at all.

/** The dedicated permission. Narrower than "is an admin" on purpose — see the
 *  seed comment: every admin being able to open every passport makes the
 *  access audit meaningless. */
const EVIDENCE_VIEW_PERMISSION = 'verification:evidence:view';

@UseGuards(JwtAuthGuard)
@Controller({ path: 'verification/documents', version: '1' })
export class EvidenceReadController {
  private readonly log = new Logger(EvidenceReadController.name);

  constructor(
    private readonly reads: EvidenceReadService,
    private readonly permissions: PermissionResolverService,
    // Sprint 9B.3 — the CONFIGURED restricted backend, not the local adapter.
    // 9A injected LocalDiskStorageAdapter and called absolutePathForKey(),
    // which has no meaning when STORAGE_DRIVER=s3: restricted reads were
    // broken in every production configuration. An architecture test now
    // fails if a restricted file imports the local adapter again.
    @Inject(RESTRICTED_OBJECT_STORAGE)
    private readonly objects: RestrictedObjectStoragePort,
  ) {}

  @Get(':documentId/content')
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Resolved per request, never cached across requests. A reviewer whose
    // permission was revoked a second ago must not still be able to open a
    // document — the same reasoning that forbids caching the capability set
    // (ADR 0006).
    const granted = await this.permissions.resolveForRoles(user.roles ?? []);

    const grant = await this.reads.authorizeRead({
      documentId,
      actorUserId: user.id,
      actorHasEvidenceViewPermission: granted.has(EVIDENCE_VIEW_PERMISSION),
      ipPrefix: truncateIp(req.ip ?? null),
      userAgentHash: hashUserAgent(req.headers['user-agent'] ?? null),
    });

    // ── headers ────────────────────────────────────────────────────────────
    //
    // `no-store` and `private` so no shared cache, proxy or CDN retains a copy.
    // This is the exact opposite of the public media route's
    // `public, max-age=31536000, immutable`, and the contrast is the point.
    res.setHeader('Cache-Control', 'no-store, private, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    // Never let a browser sniff its way to a different type than the bytes
    // actually are; the type below is the DETECTED one.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Attachment, not inline: a document is downloaded and inspected, not
    // rendered in a tab where an active-content payload would execute in our
    // origin. Combined with the PDF/JPEG/PNG allowlist this is belt and braces.
    res.setHeader('Content-Disposition', contentDisposition(grant.displayFilename));
    res.setHeader('Content-Type', grant.detectedMimeType);
    res.setHeader('Referrer-Policy', 'no-referrer');

    let stream;
    try {
      stream = await this.objects.openReadStream(grant.storageKey);
    } catch {
      // An unresolvable or missing object is a data problem, not a client one.
      // The caller gets the same 404 every other denial gets — no signal about
      // whether the document, the case or the object exists.
      this.log.error({ msg: 'evidence.read.object_unavailable', documentId });
      throw new AppError('NOT_FOUND', 'Document not found.', 404);
    }

    stream.on('error', (err) => {
      // Headers are already sent by the time a stream error surfaces, so the
      // only honest thing left is to destroy the response rather than emit a
      // truncated file that looks complete.
      this.log.error({ msg: 'evidence.read.stream_failed', documentId, err: err.message });
      res.destroy();
    });
    stream.pipe(res);
  }
}

/** Coarsen an IP to a /24-equivalent prefix. Enough to correlate an incident,
 *  not enough to be a per-user tracking identifier in an audit table that is
 *  retained for a long time. */
function truncateIp(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  const parts = v4.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  // IPv6: keep the first three hextets.
  const hextets = v4.split(':').filter(Boolean);
  return hextets.length >= 3 ? `${hextets.slice(0, 3).join(':')}::` : null;
}

/** Hashed, never stored raw: a full user-agent string is a fingerprint. */
function hashUserAgent(ua: string | string[] | null): string | null {
  if (!ua) return null;
  const value = Array.isArray(ua) ? ua.join(' ') : ua;
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/** Build a safe Content-Disposition.
 *
 *  The filename was already sanitised on the way IN, but it is re-escaped here
 *  because this header has its own injection surface: a quote or CRLF in a
 *  filename splits the header. Defence at the point of use, not only at the
 *  point of storage. */
function contentDisposition(filename: string | null): string {
  if (!filename) return 'attachment';
  const safe = filename.replace(/[^\w.\- ]/g, '_').slice(0, 100);
  return `attachment; filename="${safe}"`;
}
