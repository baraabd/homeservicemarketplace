import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import type { CreateAddressRequest } from '@homeservicemarketplace/contracts';
import { AddressType } from '@homeservicemarketplace/database';

// Bounds chosen to fit a typical international address while staying
// well below Postgres's TEXT limits and our `class-validator`
// `forbidNonWhitelisted: true` global pipe — the pipe drops unknown
// keys; these `Length` constraints reject pathologically long values
// before they ever reach Prisma.
export class CreateAddressDto implements CreateAddressRequest {
  @IsString()
  @Length(1, 80)
  label!: string;

  @IsEnum(AddressType)
  type!: AddressType;

  @IsString()
  @Length(1, 200)
  line1!: string;

  @IsString()
  @Length(1, 80)
  city!: string;

  @IsString()
  @Length(2, 80)
  country!: string;

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

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
