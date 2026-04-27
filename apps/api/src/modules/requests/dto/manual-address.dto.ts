import { IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ManualAddressInput } from '@homeservicemarketplace/contracts';

// Nested DTO for a user-typed address attached to a service request.
// Used inside CreateServiceRequestDto / UpdateServiceRequestDto when
// the Seeker doesn't pick a saved address. Length bounds match the
// addresses module's CreateAddressDto so values that pass either path
// are mutually compatible.
export class ManualAddressDto implements ManualAddressInput {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  label?: string | null;

  @IsString()
  @Length(1, 200)
  line1!: string;

  @IsString()
  @Length(1, 80)
  city!: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  country?: string | null;

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
}
