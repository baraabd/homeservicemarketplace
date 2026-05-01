// Frontend-safe mirror of the Prisma `ProviderAvailability` enum
// (Sprint 5 slice 5.1). New providers default to `OFFLINE`; the
// availability toggle on the Provider profile screen flips between
// `ONLINE` and `OFFLINE`. `PAUSED` is reserved for "I'm a provider but
// temporarily not accepting work" — surfaced in a later slice.
export const ProviderAvailability = {
  Online: 'ONLINE',
  Offline: 'OFFLINE',
  Paused: 'PAUSED',
} as const;
export type ProviderAvailability = (typeof ProviderAvailability)[keyof typeof ProviderAvailability];
