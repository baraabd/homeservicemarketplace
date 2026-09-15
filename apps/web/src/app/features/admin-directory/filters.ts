export const DIRECTORY_STATUSES = [
  'ALL',
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED',
] as const;
export const IDENTITY_STATES = [
  'UNVERIFIED',
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
] as const;
export const PORTFOLIO_STATES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const SORT_OPTIONS = ['SUBMITTED_OLDEST', 'UPDATED_NEWEST'] as const;
export const ASSIGNMENT_OPTIONS = ['ALL', 'UNASSIGNED', 'MINE'] as const;
