import { IsObject } from 'class-validator';
import type { UpdateAdminSettingsRequest } from '@homeservicemarketplace/contracts';

// PATCH /v1/admin/settings — bulk partial update.
//
// The body is `{ values: Record<string, unknown> }`. The DTO only
// validates that `values` is an object; per-key whitelist + type
// validation runs in the service. Wrapping the values in an outer
// object keeps the door open for future top-level wire fields
// (e.g., `comment`, `effectiveAt`) without breaking the contract.
export class UpdateAdminSettingsDto implements UpdateAdminSettingsRequest {
  @IsObject()
  values!: Record<string, unknown>;
}
