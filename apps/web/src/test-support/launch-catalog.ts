import type { ServiceCategorySummary } from '@homeservicemarketplace/contracts';
import {
  SERVICE_GROUPS,
  SERVICE_SPECIALTIES,
} from '../../../../packages/database/src/service-catalog-data';

// Stand-ins for API-generated IDs. A UI sending a slug, heading ID or label
// instead of the chosen specialty's ID must fail the selection assertions.
export const launchCatalog: ServiceCategorySummary[] = [
  ...SERVICE_GROUPS.map((group) => ({
    ...group,
    id: 'group-' + group.slug,
    isLeaf: false,
    parentId: null,
  })),
  ...SERVICE_SPECIALTIES.map(({ parentSlug, ...leaf }) => ({
    ...leaf,
    id: 'category-' + leaf.slug,
    isLeaf: true,
    parentId: 'group-' + parentSlug,
  })),
];
