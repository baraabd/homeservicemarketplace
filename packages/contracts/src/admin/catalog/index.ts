// Sprint 8 — admin catalogue administration.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
//   GET    /v1/admin/catalog/categories        — the whole tree
//   POST   /v1/admin/catalog/categories        — create a group or a leaf
//   PATCH  /v1/admin/catalog/categories/:id    — rename, re-parent, activate
//   GET    /v1/admin/catalog/equipment         — the equipment list
//   POST   /v1/admin/catalog/equipment         — add an item
//   PATCH  /v1/admin/catalog/equipment/:id     — edit an item
//
// The category tree and the equipment list decide what a provider can claim to
// do and what a seeker can search for, so every mutation is audited on the
// same terms as editing a person's standing.
//
// There is NO delete. A category a provider holds cannot be removed without
// silently revoking a competency an admin once approved, and a code a saved
// draft references cannot be removed without breaking that draft. Retiring is
// `isActive: false`, which hides a row from new selections while leaving every
// existing reference intact and explicable.

export interface AdminCategoryNode {
  id: string;
  slug: string;
  labelEn: string;
  labelAr: string;
  icon: string;
  /** Null for a root. */
  parentId: string | null;
  /**
   * Whether a provider may select this category.
   *
   * STORED, never derived from "has no children". Deriving it would make
   * selectability a client inference, and it would flip silently the moment a
   * parent's last child was deactivated — turning an organisational heading
   * into a selectable competency with no admin action and no audit entry.
   */
  isLeaf: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Direct children, in curation order. */
  children: AdminCategoryNode[];
  /** How many providers currently HOLD this category. Shown next to the
   *  isLeaf and isActive toggles because both are safe on an unheld row and
   *  consequential on a held one. */
  providerCount: number;
}

export interface AdminCategoryTreeResponse {
  /** Roots, in curation order. Pre-nested by the server: the client would
   *  otherwise rebuild the tree on every render from a flat list, and two
   *  clients would disagree about where an orphan belongs. */
  roots: AdminCategoryNode[];
}

export interface CreateAdminCategoryRequest {
  slug: string;
  labelEn: string;
  labelAr: string;
  icon?: string;
  /** Omit for a root. */
  parentId?: string | null;
  /** Defaults to true, matching every pre-Sprint-8 row. */
  isLeaf?: boolean;
  sortOrder?: number;
}

export interface UpdateAdminCategoryRequest {
  labelEn?: string;
  labelAr?: string;
  icon?: string;
  /** Re-parent. `null` promotes to a root. Rejected if it would create a
   *  cycle — the server walks the ancestor chain on every change. */
  parentId?: string | null;
  isLeaf?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface AdminCategoryMutationResponse {
  category: AdminCategoryNode;
}

export interface AdminEquipmentItem {
  id: string;
  /** Stable, human-readable, never reused. Clients key i18n off this. */
  code: string;
  labelEn: string;
  labelAr: string;
  /** Null means it applies to every category — a ladder is a ladder. */
  categoryId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface AdminEquipmentListResponse {
  items: AdminEquipmentItem[];
}

export interface CreateAdminEquipmentRequest {
  code: string;
  labelEn: string;
  labelAr: string;
  categoryId?: string | null;
  sortOrder?: number;
}

export interface UpdateAdminEquipmentRequest {
  labelEn?: string;
  labelAr?: string;
  categoryId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface AdminEquipmentMutationResponse {
  item: AdminEquipmentItem;
}
