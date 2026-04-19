// PATCH contract. Every field is optional; `null` clears, `undefined` leaves
// unchanged. `isDefault` can be used to promote in the same call — the
// service layer handles the atomic flip of other rows.
export interface UpdateAddressRequest {
  label?: string | null;
  street?: string;
  city?: string;
  state?: string | null;
  zipCode?: string | null;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
}
