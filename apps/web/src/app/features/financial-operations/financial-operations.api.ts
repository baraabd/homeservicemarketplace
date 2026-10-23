import { useQuery } from '@tanstack/react-query';
import type {
  FinancialOperationsSummaryV1,
  FinancialRecordDetailV1,
  FinancialRecordKind,
  FinancialRecordsPageV1,
  FinancialRecordsQueryV1,
  FinancialReconciliationDetailV1,
  FinancialReconciliationPageV1,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';

export type FinancialAudience = 'admin' | 'provider';
const pathFor = (audience: FinancialAudience) =>
  audience === 'admin' ? '/v1/money/operations' : '/v1/money/history';

export const financialOperationsKeys = {
  root: ['money', 'financial-operations'] as const,
  actor: (audience: FinancialAudience, userId: string) =>
    ['money', 'financial-operations', audience, userId] as const,
};
const privateRead = {
  retry: false,
  gcTime: 0,
  staleTime: 15_000,
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
} as const;

export function financialErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) return undefined;
  const response = error.response;
  return response &&
    typeof response === 'object' &&
    'status' in response &&
    typeof response.status === 'number'
    ? response.status
    : undefined;
}

export async function getFinancialSummary(signal?: AbortSignal) {
  return (await api.get<FinancialOperationsSummaryV1>('/v1/money/operations/summary', { signal }))
    .data;
}
export async function getFinancialRecords(
  audience: FinancialAudience,
  query: FinancialRecordsQueryV1,
  signal?: AbortSignal,
) {
  return (
    await api.get<FinancialRecordsPageV1>(pathFor(audience) + '/records', { params: query, signal })
  ).data;
}
export async function getFinancialDetail(
  audience: FinancialAudience,
  kind: FinancialRecordKind,
  id: string,
  signal?: AbortSignal,
) {
  return (
    await api.get<FinancialRecordDetailV1>(
      pathFor(audience) + '/records/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id),
      { signal },
    )
  ).data;
}
export async function getFinancialReconciliation(cursor?: string, signal?: AbortSignal) {
  return (
    await api.get<FinancialReconciliationPageV1>('/v1/money/operations/reconciliation', {
      params: { limit: 20, ...(cursor ? { cursor } : {}) },
      signal,
    })
  ).data;
}
export async function getFinancialException(id: string, signal?: AbortSignal) {
  return (
    await api.get<FinancialReconciliationDetailV1>(
      '/v1/money/operations/reconciliation/exceptions/' + encodeURIComponent(id),
      { signal },
    )
  ).data;
}
export async function exportFinancialPage(query: FinancialRecordsQueryV1, signal?: AbortSignal) {
  const response = await api.get<string>('/v1/money/operations/export', {
    params: query,
    responseType: 'text',
    signal,
  });
  return {
    csv: response.data,
    hasMore: response.headers['x-export-has-more'] === 'true',
  };
}
export function useFinancialSummary(audience: FinancialAudience, userId: string) {
  return useQuery({
    ...privateRead,
    enabled: Boolean(userId) && audience === 'admin',
    queryKey: [...financialOperationsKeys.actor(audience, userId), 'summary'],
    queryFn: ({ signal }) => getFinancialSummary(signal),
  });
}
export function useFinancialRecords(
  audience: FinancialAudience,
  userId: string,
  query: FinancialRecordsQueryV1,
) {
  return useQuery({
    ...privateRead,
    enabled: Boolean(userId),
    queryKey: [...financialOperationsKeys.actor(audience, userId), 'records', query],
    queryFn: ({ signal }) => getFinancialRecords(audience, query, signal),
  });
}
export function useFinancialDetail(
  audience: FinancialAudience,
  userId: string,
  selected: { kind: FinancialRecordKind; id: string } | null,
) {
  return useQuery({
    ...privateRead,
    enabled: Boolean(userId && selected),
    queryKey: [...financialOperationsKeys.actor(audience, userId), 'detail', selected],
    queryFn: ({ signal }) => {
      if (!selected) throw new Error('A financial record is required');
      return getFinancialDetail(audience, selected.kind, selected.id, signal);
    },
  });
}
export function useFinancialReconciliation(userId: string, enabled: boolean, cursor?: string) {
  return useQuery({
    ...privateRead,
    enabled: Boolean(userId && enabled),
    queryKey: [...financialOperationsKeys.actor('admin', userId), 'reconciliation', cursor],
    queryFn: ({ signal }) => getFinancialReconciliation(cursor, signal),
  });
}
export function useFinancialException(userId: string, id: string | null) {
  return useQuery({
    ...privateRead,
    enabled: Boolean(userId && id),
    queryKey: [...financialOperationsKeys.actor('admin', userId), 'exception', id],
    queryFn: ({ signal }) => {
      if (!id) throw new Error('A reconciliation exception is required');
      return getFinancialException(id, signal);
    },
  });
}
