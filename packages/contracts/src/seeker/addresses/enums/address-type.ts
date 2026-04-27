// Stable identifiers for the saved-address `type` discriminator. Mirrors
// the Prisma `AddressType` enum (HOME / WORK / CUSTOM) so the wire shape
// is identical to the persisted shape — no mapping needed at the boundary.
export const AddressType = {
  Home: 'HOME',
  Work: 'WORK',
  Custom: 'CUSTOM',
} as const;
export type AddressType = (typeof AddressType)[keyof typeof AddressType];
