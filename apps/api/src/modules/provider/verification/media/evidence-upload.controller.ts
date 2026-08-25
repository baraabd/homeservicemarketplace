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

@UseGuards(JwtAuthGuard, CsrfGuard)
@Controller({ path: 'me/provider/verification/evidence', version: '1' })
export class EvidenceUploadController {
  constructor(private readonly uploads: EvidenceUploadService) {}

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
