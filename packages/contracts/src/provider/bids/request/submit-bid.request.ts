import type { PricingType } from '../../../seeker/bids/enums/pricing-type';

// POST /v1/me/provider/bids
//
// Provider-side, authenticated. Submits a new bid on an open service
// request. The wire deliberately does NOT carry providerId or
// providerUserId — both are derived from the session, never trusted
// from the body. The global ValidationPipe's `forbidNonWhitelisted: true`
// rejects any payload that tries to inject them.
//
// `amount` is in the SAME currency unit the marketplace uses end-to-end
// (cents-equivalent integer in the schema today). Fractional values are
// rejected. `note` is optional free-text; `responseTimeMinutes` is the
// provider's promised ETA in minutes (optional).
export interface SubmitBidRequest {
  requestId: string;
  amount: number;
  pricingType: PricingType;
  note?: string | null;
  responseTimeMinutes?: number | null;
}
