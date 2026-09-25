import type { DisputeRemedyType } from '@homeservicemarketplace/contracts';

/**
 * Browser-safe mirror of the dispute remedy choices.
 *
 * The contracts package is emitted as CommonJS for the Nest API. Importing a
 * runtime value from that package into Vite can expose dist/index.js directly
 * to the browser and fail named-export detection. Keep browser runtime values
 * local and verify them against the contract source in tests.
 */
export const WEB_DISPUTE_REMEDY_TYPES = [
  'CLARIFICATION',
  'RESCHEDULE',
  'REPERFORM',
  'PARTIAL_REMEDY',
  'CANCELLATION',
  'ESCALATION',
] as const satisfies readonly DisputeRemedyType[];
