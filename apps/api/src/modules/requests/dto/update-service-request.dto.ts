import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import type { UpdateServiceRequestRequest } from '@homeservicemarketplace/contracts';
import { ScheduleType } from '@homeservicemarketplace/database';

import { ManualAddressDto } from './manual-address.dto';

// Patch semantics — every field optional. Status changes are NOT
// patchable here; cancel / reopen each have their own dedicated
// endpoint so the transactional boundary stays explicit.
export class UpdateServiceRequestDto implements UpdateServiceRequestRequest {
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

  @IsOptional()
  @IsEnum(ScheduleType)
  scheduleType?: ScheduleType;

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
