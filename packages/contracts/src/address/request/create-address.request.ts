export interface CreateAddressRequest {
  label?: string | null;
  street: string;
  city: string;
  state?: string | null;
  zipCode?: string | null;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
}
