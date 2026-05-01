import { IsEnum } from 'class-validator';
import type { UpdateProviderAvailabilityRequest } from '@homeservicemarketplace/contracts';
import { ProviderAvailability } from '@homeservicemarketplace/contracts';

// PATCH /v1/me/provider/availability — single-field surface so the
// availability toggle on the Provider profile screen is a one-shot
// call. The wire enum is the same string union the Prisma model uses.
export class UpdateProviderAvailabilityDto implements UpdateProviderAvailabilityRequest {
  @IsEnum(ProviderAvailability)
  availability!: ProviderAvailability;
}
