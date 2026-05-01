import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { UpdateProfileRequest } from '@homeservicemarketplace/contracts';

// PATCH /v1/me/profile body DTO.
//
// Only profile-editable fields are declared. The global ValidationPipe
// is configured with `forbidNonWhitelisted: true`, so any payload that
// tries to inject `email`, `userId`, `role`, `status`, `password`, or
// `passwordHash` is rejected with 400 VALIDATION_ERROR before the
// service is called.
//
// Trim transforms run BEFORE validation; an empty string post-trim is
// normalised to `null` so the client doesn't have to distinguish
// "clear this field" from "send empty value".
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

export class UpdateProfileDto implements UpdateProfileRequest {
  @IsOptional()
  @Transform(({ value }) => trimToString(value))
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @Transform(({ value }) => trimToString(value))
  @IsString()
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(40)
  phoneNumber?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @IsOptional()
  @Transform(({ value }) => trimToNullable(value))
  @IsString()
  @MaxLength(500)
  bio?: string | null;
}
