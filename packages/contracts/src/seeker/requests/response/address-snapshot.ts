// Snapshot of an address at the time a service request was created.
// Persisted as JSON on the request row so future edits / soft-deletes
// of the source Address never mutate historical request data.
//
// Field set is the intersection of what the create endpoint accepts
// (manualAddress) and what the addresses module's AddressSummary
// carries — so the frontend can render either source uniformly.
//
// `cityKey` is a denormalised lowercase-trimmed mirror of `city` used
// by the available-requests filter for case-insensitive matching
// against ProviderProfile.serviceAreaCity. Optional on the type so
// legacy snapshots written before the normalisation landed still
// parse; the persistence layer fills it in on every new write and a
// one-shot backfill in the seed populates it for existing rows.
export interface AddressSnapshot {
  label: string | null;
  line1: string;
  city: string;
  cityKey?: string;
  country: string;
  lat: number | null;
  lng: number | null;
}
