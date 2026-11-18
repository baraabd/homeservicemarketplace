import { IsEmail, IsOptional, Matches, IsString, Length, MaxLength } from 'class-validator';
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

  @IsString()
  @Length(1, 128)
  password!: string;
}
