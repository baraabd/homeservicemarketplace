import type { AdminProviderReviewTaskId } from '@homeservicemarketplace/contracts';

/**
 * Browser-safe mirrors of Admin review runtime constants.
 *
 * The shared contracts package is emitted as CommonJS for the Nest API.
 * Importing runtime values from that package into Vite can make the browser
 * request dist/index.js directly and then fail named-export detection.
 *
 * Keep browser runtime values local and verify them against the shared
 * contracts source in tests.
 */
export const WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS = [
  'BASICS_IDENTITY',
  'SERVICES_EXPERIENCE',
  'WORK_AREA',
  'WORKING_HOURS',
  'PORTFOLIO',
  'REVIEW_SUBMISSION',
] as const satisfies readonly AdminProviderReviewTaskId[];

export const WEB_PROVIDER_REVIEW_CORRECTION_FIELDS = {
  BASICS_IDENTITY: [
    'displayName',
    'phoneNumber',
    'profileImageUrl',
    'verificationDocuments',
    'identityDocument',
    'categoryLicense',
  ],
  SERVICES_EXPERIENCE: [
    'specialties',
    'yearsOfExperience',
    'professionSince',
    'transportModes',
    'categoryLicense',
  ],
  WORK_AREA: ['serviceAreaCity'],
  WORKING_HOURS: ['availability'],
  PORTFOLIO: ['bio', 'portfolio'],
  REVIEW_SUBMISSION: ['consent'],
} as const satisfies Record<AdminProviderReviewTaskId, readonly string[]>;
