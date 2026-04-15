// Frontend-safe. Mirrors the three seeded system roles.
export const RoleName = {
  Customer: 'customer',
  Provider: 'provider',
  Admin: 'admin',
} as const;
export type RoleName = (typeof RoleName)[keyof typeof RoleName];
