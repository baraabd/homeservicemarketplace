import type { ScheduleType } from '../enums/schedule-type';
import type { ManualAddressInput } from './create-service-request.request';

// PATCH /v1/me/requests/:requestId
//
// Patch semantics — every field optional. Only fields present in the
// payload are updated.
//
// Status changes are NOT patchable here. Cancel / reopen each have
// dedicated endpoints so the transactional boundary (write the new
// status + the matching timeline event in one tx) stays explicit and
// the controller stays thin.
export interface UpdateServiceRequestRequest {
  categoryId?: string | null;
  customServiceText?: string | null;
  description?: string | null;
  scheduleType?: ScheduleType;
  scheduledAt?: string | null;
  addressId?: string | null;
  manualAddress?: ManualAddressInput | null;
}
