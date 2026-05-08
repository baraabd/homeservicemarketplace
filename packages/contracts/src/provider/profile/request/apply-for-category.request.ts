// POST /v1/me/provider/categories/applications body. Provider applies
// to add a ServiceCategory to their approved skill set; admin review
// gates the transition. Either a category id or its slug may be sent
// — the service resolves the slug to the canonical id and rejects
// either form when the category is missing or inactive. Sending both
// is fine; id wins to keep the wire contract idempotent.
//
// userId is intentionally absent — ownership comes from the session.
// status is also absent — the row is always created PENDING; admins
// transition it via the admin review endpoint.
export interface ApplyForCategoryRequest {
  categoryId?: string;
  categorySlug?: string;
}
