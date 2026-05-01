import type { AddressType } from '../enums/address-type';

// POST /v1/me/addresses
//
// `userId` is intentionally not part of the wire contract: the server
// derives it from the authenticated session. Accepting it from the client
// would create an IDOR vector.
//
// `lat`/`lng` are optional because not every saved-address entry will be
// reverse-geocoded at create time (e.g. a label-only entry from manual
// typing). When provided they should be a valid lat/lng pair.
//
// `isDefault` is optional. When true the server promotes this row to
// default in the same transaction as the insert; existing default rows
// for the user are demoted atomically.
export interface CreateAddressRequest {
  label: string;
  type: AddressType;
  line1: string;
  city: string;
  country: string;
  lat?: number | null;
  lng?: number | null;
  isDefault?: boolean;
}
