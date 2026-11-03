import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  LEGAL_LOCALES,
  type LegalAcceptanceInput,
  type LegalLocale,
  type RegisterRequest,
} from '@homeservicemarketplace/contracts';

// K02 — the exact versions the user ticked the consent box for. Whether a
// version is current, and whether acceptance is open, is decided by
// LegalAcceptanceService; this DTO checks shape only.
export class LegalAcceptanceDto implements LegalAcceptanceInput {
  @IsString()
  @Length(1, 64)
  termsVersion!: string;

  @IsString()
  @Length(1, 64)
  privacyVersion!: string;

  @IsIn(LEGAL_LOCALES)
  locale!: LegalLocale;
}

export class RegisterDto implements RegisterRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Upper bound prevents argon2 DoS; lower bound is a baseline entropy floor.
  @IsString()
  @Length(12, 128)
  password!: string;

  @IsString()
  @Length(1, 80)
  firstName!: string;

  @IsString()
  @Length(1, 80)
  lastName!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => LegalAcceptanceDto)
  legalAcceptance!: LegalAcceptanceDto;
}
