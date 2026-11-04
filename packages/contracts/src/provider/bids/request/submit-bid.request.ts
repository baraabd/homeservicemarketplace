import type { PricingType } from '../../../seeker/bids/enums/pricing-type';

// POST /v1/me/provider/bids
//
// Provider-side, authenticated. Submits a new bid on an open service
// request. The wire deliberately does NOT carry providerId or
// providerUserId — both are derived from the session, never trusted
// from the body. The global ValidationPipe's `forbidNonWhitelisted: true`
// rejects any payload that tries to inject them.
//
// K02 (hsm.amount-unit.v1) — the price is a decimal string in MAJOR units
// exactly as the provider typed it ("100.25"), plus the currency the form
// displayed. The server converts it once to integer minor units
// (10025 halalas) with string arithmetic and refuses a currency other than
// the approved launch currency (SAR). The pre-K02 integer `amount` field is
// no longer accepted: an old client gets 400 instead of writing an amount
// whose unit nobody can prove.
//
// `pricingType` FIXED = the whole job's price. HOURLY = a rate per hour;
// an hourly rate is never summed into earnings totals as if it were a
// payable amount.
export interface SubmitBidRequest {
  requestId: string;
  amountDecimal: string;
  currency: string;
  pricingType: PricingType;
  note?: string | null;
  responseTimeMinutes?: number | null;
}
