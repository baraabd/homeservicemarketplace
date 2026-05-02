// GET /v1/me/provider/jobs/available
//
// Provider-side, authenticated. Lists open service requests across all
// seekers that the provider may bid on. The server scopes the result to
// the calling provider's perspective — there is no providerId or
// providerUserId filter on the wire because the only legal value is
// the caller's own.
//
// `limit` is clamped server-side to a safe max. `cursor` is the id of
// the last row from the previous page (cursor-by-id is stable; the
// underlying ordering uses [createdAt DESC, id DESC] so two rows
// sharing a createdAt never get skipped or duplicated).
//
// Optional filters:
//   `categoryId` — only list requests in a specific service category.
//                  When omitted, the server uses the provider's own
//                  configured `serviceCategories` to scope results;
//                  a provider with no configured skills sees every
//                  open request.
//   `city`       — filter by addressSnapshot.city (exact match,
//                  case-insensitive). When omitted the feed is global.
export interface ListAvailableJobsQuery {
  categoryId?: string;
  city?: string;
  limit?: number;
  cursor?: string;
}
