import {
  ProviderCapability,
  type ProviderCapabilitiesResponse,
} from '@homeservicemarketplace/contracts';

// Submitted application with good standing. Viewing/withdrawing the application
// and supplying evidence remain possible; no working destination is authorised.
// This is the SUBMITTED response, not DOCUMENTS_REQUIRED (which may offer preview).
const SUBMITTED_ALLOWED: ProviderCapabilitiesResponse['allowed'] = [
  'VIEW_OWN_PROFILE',
  'EDIT_OWN_PROFILE',
  'MANAGE_VERIFICATION',
  'COMPLETE_ONBOARDING',
];

export const SUBMITTED_CAPABILITIES: ProviderCapabilitiesResponse = {
  allowed: SUBMITTED_ALLOWED,
  capabilities: Object.values(ProviderCapability).map((capability) =>
    SUBMITTED_ALLOWED.includes(capability)
      ? { capability, allowed: true }
      : { capability, allowed: false, reason: 'AWAITING_REVIEW' },
  ),
  nextActions: ['WAIT_FOR_REVIEW'],
  primaryReason: 'AWAITING_REVIEW',
};

// Accepted application, but verification is not current. Evidence management
// and the limited preview remain available; live work and earnings are denied.
const VERIFICATION_REQUIRED_ALLOWED: ProviderCapabilitiesResponse['allowed'] = [
  'VIEW_OWN_PROFILE',
  'EDIT_OWN_PROFILE',
  'MANAGE_VERIFICATION',
  'COMPLETE_ONBOARDING',
  'PREVIEW_MARKETPLACE',
];

export const VERIFICATION_REQUIRED_CAPABILITIES: ProviderCapabilitiesResponse = {
  allowed: VERIFICATION_REQUIRED_ALLOWED,
  capabilities: Object.values(ProviderCapability).map((capability) =>
    VERIFICATION_REQUIRED_ALLOWED.includes(capability)
      ? { capability, allowed: true }
      : { capability, allowed: false, reason: 'VERIFICATION_REQUIRED' },
  ),
  nextActions: ['COMPLETE_PROFILE'],
  primaryReason: 'VERIFICATION_REQUIRED',
};

// Accepted and verified, but the working grant is missing or no longer live.
const NO_WORK_ACCESS_ALLOWED: ProviderCapabilitiesResponse['allowed'] = [
  'VIEW_OWN_PROFILE',
  'EDIT_OWN_PROFILE',
  'MANAGE_VERIFICATION',
  'PREVIEW_MARKETPLACE',
];

export const NO_WORK_ACCESS_CAPABILITIES: ProviderCapabilitiesResponse = {
  allowed: NO_WORK_ACCESS_ALLOWED,
  capabilities: Object.values(ProviderCapability).map((capability) =>
    NO_WORK_ACCESS_ALLOWED.includes(capability)
      ? { capability, allowed: true }
      : { capability, allowed: false, reason: 'NO_WORK_ACCESS' },
  ),
  nextActions: ['WAIT_FOR_REVIEW'],
  primaryReason: 'NO_WORK_ACCESS',
};
