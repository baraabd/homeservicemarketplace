// Editorial badge attached to a bid in the Seeker UI.
//   BEST_MATCH  — algorithmically-chosen "best fit" bid
//   BEST_VALUE  — best price-vs-rating trade-off
//   FASTEST     — lowest responseTimeMinutes
//
// Slice 2.1 stores the badge as a column on the bid for simplicity;
// future slices can replace this with a derived computation if a
// scoring service is introduced.
export const BidBadge = {
  BestMatch: 'BEST_MATCH',
  BestValue: 'BEST_VALUE',
  Fastest: 'FASTEST',
} as const;
export type BidBadge = (typeof BidBadge)[keyof typeof BidBadge];
