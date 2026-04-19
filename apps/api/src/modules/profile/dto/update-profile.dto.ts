import { IsOptional, IsString, Matches, MaxLength, IsUrl, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import type { UpdateProfileRequest } from '@homeservicemarketplace/contracts';

// PATCH semantics: every field is optional. `null` clears a stored value;
// omitted (undefined) means "leave untouched". `@ValidateIf(o => v !== null)`
// skips the format check when the caller is explicitly clearing the field.

const trimOrPreserveNull = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export class UpdateProfileDto implements UpdateProfileRequest {
  @IsOptional()
  @Transform(trimOrPreserveNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  avatarUrl?: string | null;

  // Loose E.164-ish: leading optional +, digits/spaces/dashes/parens, 7-20 chars.
  // Strict E.164 parsing is better done by libphonenumber if/when we gate
  // on phone verification — which is out of scope for this phase.
  @IsOptional()
  @Transform(trimOrPreserveNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,20}$/, {
    message: 'phoneNumber must be 7–20 chars of digits, spaces, dashes or parentheses',
  })
  phoneNumber?: string | null;

  @IsOptional()
  @Transform(trimOrPreserveNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  bio?: string | null;
}
