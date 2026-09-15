import type { ProviderCapabilitiesResponse } from '@homeservicemarketplace/contracts';

const ALL_CAPABILITIES = [
  'VIEW_OWN_PROFILE',
  'EDIT_OWN_PROFILE',
  'COMPLETE_ONBOARDING',
  'SUBMIT_FOR_REVIEW',
  'VIEW_MARKETPLACE',
  'SUBMIT_BID',
  'MANAGE_BOOKINGS',
  'VIEW_EARNINGS',
  'MANAGE_VERIFICATION',
  'PREVIEW_MARKETPLACE',
  'APPEAL_DECISION',
] as const;

/** Full transport shape from an explicitly chosen test scenario. */
function withDecisions(fixture: ProviderCapabilitiesResponse): ProviderCapabilitiesResponse {
  return {
    ...fixture,
    capabilities: ALL_CAPABILITIES.map((capability) => ({
      capability,
      allowed: fixture.allowed.includes(capability),
      ...(!fixture.allowed.includes(capability) && fixture.primaryReason
        ? { reason: fixture.primaryReason }
        : {}),
    })),
  };
}

// Explicit server-response fixtures, not client-side permission calculation.
export const WORKING_CAPABILITIES: ProviderCapabilitiesResponse = withDecisions({
  allowed: [
    'VIEW_OWN_PROFILE',
    'EDIT_OWN_PROFILE',
    'MANAGE_VERIFICATION',
    'VIEW_MARKETPLACE',
    'SUBMIT_BID',
    'MANAGE_BOOKINGS',
    'VIEW_EARNINGS',
  ],
  capabilities: [],
  nextActions: [],
  primaryReason: null,
});
export const APPLYING_CAPABILITIES: ProviderCapabilitiesResponse = withDecisions({
  allowed: [
    'VIEW_OWN_PROFILE',
    'EDIT_OWN_PROFILE',
    'MANAGE_VERIFICATION',
    'COMPLETE_ONBOARDING',
    'SUBMIT_FOR_REVIEW',
  ],
  capabilities: [],
  nextActions: ['COMPLETE_PROFILE', 'SUBMIT_APPLICATION'],
  primaryReason: 'ONBOARDING_INCOMPLETE',
});
export const SUSPENDED_CAPABILITIES: ProviderCapabilitiesResponse = withDecisions({
  allowed: ['VIEW_OWN_PROFILE', 'APPEAL_DECISION'],
  capabilities: [],
  nextActions: ['APPEAL_DECISION'],
  primaryReason: 'PROVIDER_SUSPENDED',
});

export const SUBMITTED_CAPABILITIES: ProviderCapabilitiesResponse = withDecisions({
  allowed: ['VIEW_OWN_PROFILE', 'EDIT_OWN_PROFILE', 'MANAGE_VERIFICATION', 'COMPLETE_ONBOARDING'],
  capabilities: [],
  nextActions: ['WAIT_FOR_REVIEW'],
  primaryReason: 'AWAITING_REVIEW',
});
