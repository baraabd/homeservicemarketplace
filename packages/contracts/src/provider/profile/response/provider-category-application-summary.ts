import type { ProviderCategoryApplicationStatus } from '../enums/provider-category-application-status';
import type { ProviderServiceCategoryRef } from './provider-profile-summary';

// A provider's own view of one category application.
//
// Deliberately narrower than the admin's PendingCategorySummary: it carries no
// providerProfileId and no provider display name, because a provider reading
// their own applications already knows who they are, and a response that
// echoes identifiers a client never needs is a response that leaks them the
// day an endpoint is mis-scoped.
//
// The embedded category ref is the same shape the profile's skill chips use,
// so the Provider app renders a pending skill and an approved skill through
// one component instead of two that can drift apart.
export interface ProviderCategoryApplicationSummary {
  id: string;
  status: ProviderCategoryApplicationStatus;
  category: ProviderServiceCategoryRef;
  // When the provider applied, and when it last changed state (an admin
  // decision, or being superseded).
  createdAt: string;
  updatedAt: string;
  // Set when an identical earlier application displaced this one. Such a row
  // is still PENDING — no admin ever decided it — but it is not live: it does
  // not hold the provider's queue slot and does not appear in
  // `pendingCategories`. Surfaced so the Provider app can explain a duplicate
  // rather than showing two identical pending chips.
  supersededAt: string | null;
}
