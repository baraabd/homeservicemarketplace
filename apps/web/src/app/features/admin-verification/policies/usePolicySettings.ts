import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListVerificationPoliciesResponse,
  PublishVerificationPolicyRequest,
  VerificationPolicyMutationResponse,
  VerificationPolicyOptionsResponse,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';

const POLICY_KEY = ['admin', 'verification', 'policies'] as const;
const OPTIONS_KEY = [...POLICY_KEY, 'options'] as const;
const POLICY_URL = '/v1/admin/verification/policies';

export function usePolicySettings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: POLICY_KEY,
    queryFn: async () => (await api.get<ListVerificationPoliciesResponse>(POLICY_URL)).data,
  });
  const options = useQuery({
    queryKey: OPTIONS_KEY,
    queryFn: async () =>
      (await api.get<VerificationPolicyOptionsResponse>(`${POLICY_URL}/options`)).data,
    enabled: query.isSuccess,
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: POLICY_KEY });
  const publish = useMutation({
    mutationFn: async (body: PublishVerificationPolicyRequest) =>
      (await api.post<VerificationPolicyMutationResponse>(POLICY_URL, body)).data,
    onSuccess: invalidate,
  });
  const retire = useMutation({
    mutationFn: async (version: string) =>
      (
        await api.post<VerificationPolicyMutationResponse>(
          `${POLICY_URL}/${encodeURIComponent(version)}/retire`,
        )
      ).data,
    onSuccess: invalidate,
  });
  return { query, options, publish, retire };
}
