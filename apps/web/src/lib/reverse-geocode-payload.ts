export interface ParsedGeocodeAddress {
  formattedAddress: string;
  city: string;
  country: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Vendor JSON is untrusted; a TypeScript cast cannot validate its shape. */
export function parseGeocodeAddress(payload: unknown): ParsedGeocodeAddress | null {
  if (!object(payload) || payload.error) return null;
  const formattedAddress = text(payload.display_name);
  if (!formattedAddress) return null;
  const address = object(payload.address) ? payload.address : {};
  const localityFields = ['city', 'town', 'village', 'hamlet', 'municipality', 'county', 'state'];
  const city = localityFields.map((key) => text(address[key])).find(Boolean) ?? '';
  return { formattedAddress, city, country: text(address.country) };
}
