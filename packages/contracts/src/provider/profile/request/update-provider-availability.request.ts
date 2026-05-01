import type { ProviderAvailability } from '../enums/provider-availability';

// PATCH /v1/me/provider/availability — single-field surface so the
// availability toggle on the Provider profile screen is a one-shot
// call rather than a partial-PATCH against the full profile body.
export interface UpdateProviderAvailabilityRequest {
  availability: ProviderAvailability;
}
