import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateNested,
} from 'class-validator';
import type { CreateServiceRequestRequest } from '@homeservicemarketplace/contracts';
import { ScheduleType } from '@homeservicemarketplace/database';

import { MAX_FILES_PER_REQUEST } from '../../../infrastructure/storage/content-type';
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

  // Sprint 7.x — pre-uploaded media URLs. Defence-in-depth alongside
  // the storage-port whitelist: the wire here only accepts up to
  // MAX_FILES_PER_REQUEST URLs, each one a real-looking URL string.
  // require_tld:false so localhost URLs work in dev (LocalDiskStorage
  // adapter returns http://localhost:4000/v1/media/files/... in
  // dev shells). The fileUrls themselves come from a server-issued
  // presign response; a hostile client substituting an attacker-
  // controlled URL is the realistic risk here, but the provider's
  // available-requests feed renders these as <img src> on the seeker's
  // dime — accepted as wire shape and revisited if the threat model
  // tightens.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILES_PER_REQUEST)
  @IsUrl({ require_tld: false }, { each: true })
  mediaUrls?: string[];

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
