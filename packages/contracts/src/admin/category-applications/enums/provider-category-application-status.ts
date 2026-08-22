// The canonical declaration lives with the provider contracts, because the row
// it describes is a PROVIDER's application for a skill — the admin surface
// moderates that lifecycle rather than owning it. Re-exported here so the
// admin barrel keeps its existing shape and no consumer import has to move.
export type { ProviderCategoryApplicationStatus } from '../../../provider/profile/enums/provider-category-application-status';
