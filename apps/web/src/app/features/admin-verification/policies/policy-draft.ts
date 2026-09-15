import type { PublishVerificationPolicyRequest } from '@homeservicemarketplace/contracts';

export const initialPolicyDraft = (): PublishVerificationPolicyRequest => ({
  version: '',
  country: null,
  providerType: null,
  categoryId: null,
  requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
});
