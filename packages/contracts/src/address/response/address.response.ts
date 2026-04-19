export interface AddressDto {
  id: string;
  userId: string;
  label: string | null;
  street: string;
  city: string;
  state: string | null;
  zipCode: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressListResponse {
  items: AddressDto[];
}
