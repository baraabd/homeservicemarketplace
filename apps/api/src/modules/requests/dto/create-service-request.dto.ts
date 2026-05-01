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
import type { CreateServiceRequestRequest } from '@homeservicemarketplace/contracts';
import { ScheduleType } from '@homeservicemarketplace/database';

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
