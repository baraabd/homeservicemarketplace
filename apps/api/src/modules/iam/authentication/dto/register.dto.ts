import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import type { RegisterRequest } from '@homeservicemarketplace/contracts';

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
}
