import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type { CreateAddressRequest } from '@homeservicemarketplace/contracts';

const trim = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  return typeof value === 'string' ? value.trim() : value;
};

const trimOrNull = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export class CreateAddressDto implements CreateAddressRequest {
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(80)
  label?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  street!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(120)
  state?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(20)
  zipCode?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  country!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
