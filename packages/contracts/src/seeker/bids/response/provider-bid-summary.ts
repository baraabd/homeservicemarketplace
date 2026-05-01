// Provider read-model attached to each bid the Seeker sees. We
// deliberately do NOT expose Provider userId, contact info, or any
// PII — the Seeker only needs the public reputation signals to
// choose between bids. When the chat / booking slices ship, dedicated
// endpoints will surface contact-able provider details after a bid
// is accepted, not from this read-only summary.
export interface ProviderBidSummary {
  id: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  ratingAvg: number;
  reviewCount: number;
  completedJobs: number;
  verified: boolean;
  topPro: boolean;
}
