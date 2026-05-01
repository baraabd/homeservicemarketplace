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
}

// GET /v1/services
export interface ServiceCategoryListResponse {
  items: ServiceCategorySummary[];
}
