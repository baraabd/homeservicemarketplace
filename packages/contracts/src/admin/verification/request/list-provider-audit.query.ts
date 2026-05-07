// GET /v1/admin/providers/:providerProfileId/audit
//
// Cursor-paginated. The path parameter scopes the query; this DTO is
// just for limit/cursor. forbidNonWhitelisted: true blocks any other
// query parameter at the controller layer.
export interface ListProviderAuditEventsQuery {
  limit?: number;
  cursor?: string;
}
