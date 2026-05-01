import { IsEnum, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { UpdateAddressRequest } from '@homeservicemarketplace/contracts';
import { AddressType } from '@homeservicemarketplace/database';

// Patch semantics — every field is optional. `isDefault` is intentionally
// not patchable here; promote-to-default has its own dedicated endpoint
// so the transactional boundary stays explicit.
export class UpdateAddressDto implements UpdateAddressRequest {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  label?: string;

  @IsOptional()
  @IsEnum(AddressType)
  type?: AddressType;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  line1?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  country?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number | null;
}
