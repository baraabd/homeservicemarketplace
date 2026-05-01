import type { AddressType } from '../enums/address-type';

// One saved-address row as the API serves it. Persistence-only fields
// (createdAt, updatedAt, deletedAt) are intentionally omitted — the
// service-layer mapper drops them so the row shape never escapes the
// module boundary.
export interface AddressSummary {
  id: string;
  label: string;
  type: AddressType;
  line1: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
}

// GET /v1/me/addresses
export interface AddressListResponse {
  items: AddressSummary[];
}
