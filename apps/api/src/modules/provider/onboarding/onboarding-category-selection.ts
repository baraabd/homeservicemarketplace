// Sprint 8 — expanding a parent-category selection, without granting anything.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// The wizard lets a provider tick a primary service GROUP ("Plumbing") and
// then choose leaf specialties under it. The obvious convenience — ticking the
// group selects all its leaves — is an authorization bypass wearing a UI hat:
// it would hand a provider a dozen approved competencies that no admin ever
// reviewed, defeating ProviderCategoryApplication entirely.
//
// So this module is deliberately shaped so that the bypass is not expressible.
// It has no way to return an approved competency: `autoApproved` exists, is
// always empty, and is asserted to be empty. Everything a parent expands to
// comes back as something to APPLY for.
//
// Pure. No Prisma, no Nest — the rule is decidable from a parent list and a
// child map, so it is testable without a database and cannot quietly acquire
// the ability to write a grant.

export interface ExpandParentSelectionInput {
  /** Root/primary groups the provider ticked. */
  parentIds: string[];
  /** Selectable leaves under each parent, as the catalogue defines them.
   *  Supplied by the caller (which read them from the database) rather than
   *  fetched here, so this stays pure. */
  leavesByParent: Record<string, string[]>;
  /** Leaves the provider ALREADY holds, approved. Passed so the result can
   *  distinguish "must apply" from "already has it" without re-deriving it. */
  alreadyApprovedLeafIds?: string[];
}

export interface ExpandParentSelectionResult {
  /** Always empty. Present so the shape states the guarantee out loud, and so
   *  a test can assert on it rather than on an absence.
   *
   *  If a future change ever needs to auto-approve, it must add a NEW field
   *  and justify it — it cannot quietly start populating this one, because
   *  the test that pins it to empty would fail. */
  autoApproved: readonly string[];
  /** Leaves the provider must submit a ProviderCategoryApplication for. */
  requiresApplication: string[];
  /** Leaves already granted, echoed back so the UI can render them as done. */
  alreadyApproved: string[];
}

/** Expand ticked parent groups into the leaf specialties beneath them.
 *
 *  Selecting a parent is an expression of INTENT ("I work in plumbing"), never
 *  a grant. Every leaf it expands to is returned as something to apply for. */
export function expandParentSelection(
  input: ExpandParentSelectionInput,
): ExpandParentSelectionResult {
  const held = new Set(input.alreadyApprovedLeafIds ?? []);

  // Deduplicated: a leaf reachable from two ticked parents is still one leaf,
  // and a duplicated id would become a duplicated application.
  const expanded = new Set<string>();
  for (const parentId of input.parentIds) {
    for (const leafId of input.leavesByParent[parentId] ?? []) {
      expanded.add(leafId);
    }
  }

  const requiresApplication: string[] = [];
  const alreadyApproved: string[] = [];
  for (const leafId of expanded) {
    if (held.has(leafId)) alreadyApproved.push(leafId);
    else requiresApplication.push(leafId);
  }

  return {
    // Not a placeholder to fill in later. The empty array IS the rule.
    autoApproved: [],
    requiresApplication,
    alreadyApproved,
  };
}
