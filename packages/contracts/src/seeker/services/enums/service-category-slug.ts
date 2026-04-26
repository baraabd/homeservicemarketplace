// Stable identifiers for the seeded service categories. The DB schema
// allows arbitrary slugs (`String @unique`) so admins can add new
// categories via migration without a code change; this enum is just the
// frontend's strongly-typed convenience for the categories that ship in
// the initial seed (Sprint 1).
export const ServiceCategorySlug = {
  Plumbing: 'plumbing',
  Electrical: 'electrical',
  AcRepair: 'ac-repair',
  Cleaning: 'cleaning',
  Carpentry: 'carpentry',
  Painting: 'painting',
} as const;
export type ServiceCategorySlug = (typeof ServiceCategorySlug)[keyof typeof ServiceCategorySlug];
