import type { AddressType } from '../enums/address-type';

// PATCH /v1/me/addresses/:addressId
//
// All fields optional — patch semantics. `isDefault` is intentionally
// excluded; promote-to-default has its own dedicated endpoint
// (POST /v1/me/addresses/:addressId/default) so the transaction boundary
// stays explicit and the controller can stay thin.
export interface UpdateAddressRequest {
  label?: string;
  type?: AddressType;
  line1?: string;
  city?: string;
  country?: string;
  lat?: number | null;
  lng?: number | null;
}
