import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import type { LoginRequest } from '@homeservicemarketplace/contracts';

export class LoginDto implements LoginRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(1, 128)
  password!: string;
}
