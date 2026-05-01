// Snapshot of an address at the time a service request was created.
// Persisted as JSON on the request row so future edits / soft-deletes
// of the source Address never mutate historical request data.
//
// Field set is the intersection of what the create endpoint accepts
// (manualAddress) and what the addresses module's AddressSummary
// carries — so the frontend can render either source uniformly.
export interface AddressSnapshot {
  label: string | null;
  line1: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
}
