// How the Provider has priced their bid.
//   HOURLY — `amount` is per-hour
//   FIXED  — `amount` is a flat price for the whole job
export const PricingType = {
  Hourly: 'HOURLY',
  Fixed: 'FIXED',
} as const;
export type PricingType = (typeof PricingType)[keyof typeof PricingType];
