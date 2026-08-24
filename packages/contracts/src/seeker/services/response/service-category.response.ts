// One row of the service-category catalog as the API serves it.
// Bilingual labels are returned together so the client can switch
// languages without a refetch.
export interface ServiceCategorySummary {
  id: string;
  slug: string;
  labelEn: string;
  labelAr: string;
  icon: string;
  sortOrder: number;

  // ── Sprint 8: the hierarchy ─────────────────────────────────────────────
  // docs/adr/0008-category-hierarchy-and-onboarding-draft.md
  //
  // Additive and backward compatible. Every pre-Sprint-8 row comes back with
  // `parentId: null` and `isLeaf: true` — a selectable competency at the root,
  // exactly what it was before — so a client that ignores both fields behaves
  // as it always did.

  /** Null for a root. */
  parentId: string | null;
  /**
   * Whether a provider may select this category.
   *
   * Read it; do not derive it. "A leaf is a category with no children" is the
   * tempting definition and it is wrong twice: it makes selectability a client
   * inference, and it flips silently the moment a parent's last child is
   * deactivated — turning an organisational heading into a selectable
   * competency with no admin action behind it.
   */
  isLeaf: boolean;
}

// GET /v1/services
export interface ServiceCategoryListResponse {
  items: ServiceCategorySummary[];
}

/** One row of the equipment catalogue.
 *
 *  Sprint 8. Codes rather than free text: van, Van and "small van" are one
 *  capability, and matching cannot work if providers type it. The label is
 *  rendered from the client i18n bundle keyed by `code`, with these bilingual
 *  labels as the catalogue's own answer. */
export interface EquipmentCatalogSummary {
  id: string;
  code: string;
  labelEn: string;
  labelAr: string;
  /** Null means it applies to every category — a ladder is a ladder. */
  categoryId: string | null;
  sortOrder: number;
}

// GET /v1/services/equipment
export interface EquipmentCatalogListResponse {
  items: EquipmentCatalogSummary[];
}
