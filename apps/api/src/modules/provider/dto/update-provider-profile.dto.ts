import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { UpdateProviderProfileRequest } from '@homeservicemarketplace/contracts';

// PATCH /v1/me/provider/profile body DTO.
//
// Only profile-editable fields are declared. The global ValidationPipe
// is configured with `forbidNonWhitelisted: true`, so any payload that
// tries to inject `userId`, `email`, `role`, `status`, `ratingAvg`,
// `reviewCount`, `completedJobs`, `verified`, `topPro`, or
// `availability` is rejected with 400 VALIDATION_ERROR before the
// service is called. Availability has its own dedicated endpoint.
//
// Trim transforms run BEFORE validation; an empty post-trim string is
// normalised to `null` so the client doesn't have to distinguish
// "clear this field" from "send empty value". Numeric fields use a
// dedicated transform so an empty string becomes `null`.
function trimToNullable(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value as string;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function trimToString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return value as string;
  return value.trim();
}

function emptyStringToNull(value: unknown): unknown {
  if (typeof value === 'string' && value.trim().length === 0) return null;
  return value;
}

export class UpdateProviderProfileDto implements UpdateProviderProfileRequest {
  @IsOptional()
  @Transform(({ value }) => trimToString(value))
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(500)
  bio?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(120)
  headline?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(40)
  phoneNumber?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(80)
  serviceAreaCity?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(80)
  serviceAreaCountry?: string | null;

  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @Type(() => Number)
  @IsLatitude()
  serviceAreaLat?: number | null;

  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @Type(() => Number)
  @IsLongitude()
  serviceAreaLng?: number | null;

  @IsOptional()
  @Transform(({ value }) => emptyStringToNull(value))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  serviceAreaRadiusKm?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  categoryIds?: string[];
}
