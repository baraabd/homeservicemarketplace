import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import type { CreateServiceRequestRequest } from '@homeservicemarketplace/contracts';
import { ScheduleType } from '@homeservicemarketplace/database';

import { MAX_FILES_PER_REQUEST } from '../../../infrastructure/storage/content-type';
import { MEDIA_ASSET_ID_PATTERN } from '../../media/dto/finalize-request-attachments.dto';
import { ManualAddressDto } from './manual-address.dto';

// Bounds chosen to fit a useful service-request brief while staying
// well below text-column limits. The "at least one of category /
// custom service" and "at least one of addressId / manualAddress"
// invariants are enforced in the service layer, not at the validator
// level — class-validator's cross-field rules are awkward and the
// service must check ownership of the address anyway.
export class CreateServiceRequestDto implements CreateServiceRequestRequest {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  customServiceText?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string | null;

  // R07 — opaque, client-generated replay key. Kept intentionally generic
  // (rather than UUID-only) so native clients may use their own collision-safe
  // format. Bounds prevent accidental payload abuse.
  @IsOptional()
  @IsString()
  @Length(16, 128)
  idempotencyKey?: string;

  // R06 — attachments are referenced by server-issued asset id. Ownership,
  // completeness and single use are decided from the MediaAsset rows inside
  // the creation transaction, not from anything in this body.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILES_PER_REQUEST)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(MEDIA_ASSET_ID_PATTERN, { each: true })
  mediaAssetIds?: string[];

  // R06 — ROLLOUT COMPATIBILITY ONLY. Web bundles built before R06 send this
  // field on every request, as an empty list when nothing was attached. An
  // EMPTY list is therefore tolerated, and ignored, so a cached old bundle can
  // still post a request without media. Any element at all is a 400: a URL is
  // never accepted, stored or resolved. The service does not read this field.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(0)
  mediaUrls?: [];

  @IsEnum(ScheduleType)
  scheduleType!: ScheduleType;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  addressId?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ManualAddressDto)
  manualAddress?: ManualAddressDto | null;
}
