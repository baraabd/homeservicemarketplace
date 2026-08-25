import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import type {
  FinalizeEvidenceUploadResponse,
  PrepareEvidenceUploadResponse,
  UploadEvidenceContentResponse,
} from '@homeservicemarketplace/contracts';

import { AppError } from '../../../../shared/errors/app-error';
import { CurrentUser } from '../../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../iam/authentication/types/authenticated-user';
import { EvidenceUploadService } from './evidence-upload.service';

// Sprint 9B.3 — the restricted evidence upload routes.
//
// docs/adr/0009-restricted-identity-media.md
//
// Deliberately NOT under /v1/media, for the same reason the read route is not:
// that router is public-media territory, its GET is @Public() and it sets
// `Cache-Control: public, immutable`. Sharing a prefix invites someone to
// "unify" the two one day, and that merge ends with a passport on a CDN.
//
// The content PUT is authenticated by SESSION, not by a signed URL. A signed
// upload URL is a bearer capability that outlives the check that produced it,
// lands in browser history, and cannot be revoked. Costing a proxied request
// buys revocability and a real audit point — the same trade the read route
// makes.

const DOCUMENT_KINDS = [
  'INDIVIDUAL_IDENTITY',
  'BUSINESS_REGISTRATION',
  'AUTHORIZED_REPRESENTATIVE_IDENTITY',
  'CATEGORY_LICENSE',
] as const;

export class PrepareEvidenceUploadDto {
  @IsIn(DOCUMENT_KINDS)
  kind!: (typeof DOCUMENT_KINDS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  serviceCategoryId?: string | null;

  // Shape only. The allowlist itself lives in file-signature.ts and is applied
  // by the service, so there is one definition of what evidence may be.
  @IsString()
  @MaxLength(128)
  declaredMimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string | null;
}

// Sprint 9B.4 — a tighter budget than the global 100/60s backstop.
//
// Every one of these routes costs far more than an ordinary request: prepare
// reserves a slot, content moves a whole file and then a scanner reads it
// again, finalize creates a document. The number a LEGITIMATE provider needs is
// small and bounded by maxDocumentsPerCase, so an hourly budget in the tens is
// generous for retries and re-uploads while stopping a loop from consuming
// storage and scanner time.
//
// Charged per authenticated caller by the app throttler, and counted in Redis,
// so the budget is aggregate across replicas rather than per-replica.
const EVIDENCE_UPLOAD_THROTTLE = { default: { limit: 30, ttl: 60 * 60 * 1000 } } as const;

@UseGuards(JwtAuthGuard, CsrfGuard)
@Controller({ path: 'me/provider/verification/evidence', version: '1' })
export class EvidenceUploadController {
  constructor(private readonly uploads: EvidenceUploadService) {}

  @Throttle(EVIDENCE_UPLOAD_THROTTLE)
  @Post('prepare')
  @HttpCode(HttpStatus.OK)
  // 200 rather than 201: prepare frequently RETURNS an existing open
  // preparation, and a status alternating with the outcome would invite
  // clients to branch on it. `created` says which happened.
  async prepare(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PrepareEvidenceUploadDto,
  ): Promise<PrepareEvidenceUploadResponse> {
    const prepared = await this.uploads.prepare(user.id, {
      kind: body.kind,
      serviceCategoryId: body.serviceCategoryId ?? null,
      declaredMime: body.declaredMimeType,
      sizeBytes: body.sizeBytes,
      filename: body.filename ?? null,
    });
    return prepared as unknown as PrepareEvidenceUploadResponse;
  }

  @Throttle(EVIDENCE_UPLOAD_THROTTLE)
  @Put(':assetId/content')
  @HttpCode(HttpStatus.OK)
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId') assetId: string,
    @Headers('content-type') contentType: string | undefined,
    @Req() req: Request,
  ): Promise<UploadEvidenceContentResponse> {
    // The body is the binary. express.json() only parses application/json, so
    // for an evidence content type the request arrives here as an unconsumed
    // stream — which is what lets the service enforce its cap while bytes pass
    // rather than buffering a whole file and measuring it afterwards.
    const declared = (contentType ?? '').split(';')[0]!.trim();
    if (declared.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'A Content-Type is required.', 400, {
        reason: 'DISALLOWED_FORMAT',
      });
    }

    const result = await this.uploads.acceptContent(user.id, assetId, req, declared);
    return {
      assetId,
      sizeBytes: result.sizeBytes,
      // The wire name is detectedMimeType; the service speaks detectedMime.
      detectedMimeType: result.detectedMime,
    };
  }

  @Throttle(EVIDENCE_UPLOAD_THROTTLE)
  @Post(':assetId/finalize')
  @HttpCode(HttpStatus.OK)
  // 200 for both the first finalize and the idempotent replay, for the same
  // reason as prepare.
  async finalize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId') assetId: string,
  ): Promise<FinalizeEvidenceUploadResponse> {
    const finalized = await this.uploads.finalize(user.id, assetId);
    return finalized as unknown as FinalizeEvidenceUploadResponse;
  }
}
