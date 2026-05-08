// Lifecycle of a ProviderCategoryApplication row. Mirrors the Prisma
// enum of the same name (packages/database/prisma/schema.prisma).
//
//   PENDING   — provider has applied, admin has not reviewed yet. The
//               Provider app surfaces these on the profile under
//               `pendingCategories`.
//   APPROVED  — admin approved; service mirrors the row into
//               ProviderProfileServiceCategory so the public profile
//               picks it up. The application row stays as the audit
//               trail.
//   REJECTED  — admin rejected; the row stays so a future re-apply
//               can show prior context, and to keep the audit history
//               linear.
export type ProviderCategoryApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
