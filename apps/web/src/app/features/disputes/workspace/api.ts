import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type {
  DisputeAdminQueue,
  DisputeDraftView,
  DisputeWorkspaceCommand,
  DisputeWorkspaceHistory,
  DisputeWorkspaceReceipt,
  DisputeWorkspaceView,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { disputeKeys } from '../api';
export const workspaceKeys = {
  root: [...disputeKeys.root, 'workspace'] as const,
  detail: (id: string, admin: boolean) =>
    [...disputeKeys.root, 'workspace', admin ? 'admin' : 'participant', id] as const,
};
export const workspacePath = (id: string, admin: boolean) =>
  admin
    ? `/v1/admin/dispute-workspaces/${encodeURIComponent(id)}`
    : `/v1/me/disputes/${encodeURIComponent(id)}/workspace`;
export const draftPath = (bookingId: string) =>
  `/v1/me/disputes/drafts/${encodeURIComponent(bookingId)}`;
const privateQuery = {
  retry: false,
  gcTime: 0,
  staleTime: 0,
  refetchOnWindowFocus: false,
} as const;
export function useWorkspace(id: string, admin = false) {
  return useQuery({
    ...privateQuery,
    queryKey: workspaceKeys.detail(id, admin),
    queryFn: async ({ signal }) =>
      (await api.get<DisputeWorkspaceView>(workspacePath(id, admin), { signal })).data,
  });
}
export function useWorkspaceHistory(id: string, admin: boolean, before: number | undefined) {
  return useInfiniteQuery({
    ...privateQuery,
    enabled: before !== undefined,
    queryKey: [...workspaceKeys.detail(id, admin), 'history', before],
    initialPageParam: before,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<DisputeWorkspaceHistory>(`${workspacePath(id, admin)}/history`, {
          params: { before: pageParam },
          signal,
        })
      ).data,
    getNextPageParam: (last) => last.beforeRevision ?? undefined,
  });
}
export function useAdminDisputeQueue(state: string, mine: boolean) {
  return useInfiniteQuery({
    ...privateQuery,
    queryKey: [...workspaceKeys.root, 'queue', state, mine],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<DisputeAdminQueue>('/v1/admin/dispute-workspaces', {
          params: { state: state || undefined, mine: mine ? 'true' : undefined, cursor: pageParam },
          signal,
        })
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
export function useSavedDraft(bookingId: string, enabled: boolean) {
  return useQuery({
    ...privateQuery,
    enabled,
    queryKey: [...workspaceKeys.root, 'draft', bookingId],
    queryFn: async ({ signal }) =>
      (await api.get<DisputeDraftView>(draftPath(bookingId), { signal })).data,
  });
}
/** A network retry reuses the original revision AND intent. A fresh read never rewrites a pending command. */
export function useWorkspaceCommand(id: string, admin: boolean, revision: number) {
  const qc = useQueryClient();
  const intent = useRef<{ signature: string; request: DisputeWorkspaceCommand } | null>(null);
  const mutation = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (command: DisputeWorkspaceCommand['command']) => {
      const signature = JSON.stringify(command);
      if (intent.current?.signature !== signature)
        intent.current = {
          signature,
          request: { command, expectedRevision: revision, idempotencyKey: crypto.randomUUID() },
        };
      return (
        await api.post<DisputeWorkspaceReceipt>(
          `${workspacePath(id, admin)}/commands`,
          intent.current.request,
        )
      ).data;
    },
    onSuccess: async () => {
      intent.current = null;
      await qc.invalidateQueries({ queryKey: disputeKeys.root });
    },
  });
  return {
    ...mutation,
    reviewFreshVersion: () => {
      intent.current = null;
      mutation.reset();
    },
  };
}
export async function fetchCaseEvidence(
  id: string,
  evidenceId: string,
  admin: boolean,
): Promise<Blob> {
  return (
    await api.get<Blob>(`${workspacePath(id, admin)}/evidence/${encodeURIComponent(evidenceId)}`, {
      responseType: 'blob',
    })
  ).data;
}
export async function uploadCaseEvidence(
  id: string,
  admin: boolean,
  file: File,
  key: string,
  sourceEvidenceId?: string,
) {
  const body = new FormData();
  body.set('file', file);
  body.set('idempotencyKey', key);
  if (sourceEvidenceId) body.set('sourceEvidenceId', sourceEvidenceId);
  return (
    await api.post<{ id: string; state: string }>(`${workspacePath(id, admin)}/evidence`, body)
  ).data;
}
