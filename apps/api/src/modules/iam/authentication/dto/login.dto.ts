import {
  IsEmail,
  IsOptional,
  Matches,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { LoginRequest } from '@homeservicemarketplace/contracts';

export class LoginDto implements LoginRequest {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9][0-9]{6,14}$/)
  phoneNumber?: string;

  // Email sign-in still requires its password. Optional legacy WhatsApp
  // password fields are validated but never used as proof of authentication.
  @ValidateIf((input: LoginDto) => input.email !== undefined || input.password !== undefined)
  @IsString()
  @Length(1, 128)
  password?: string;
}
