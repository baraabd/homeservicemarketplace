import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DisputeDraftContent, DisputeDraftView } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { draftPath } from './api';
import { PrivateDraftQueue } from './private-draft-queue';

/** The route keys this form by booking ID. Never hydrate over an actively edited form. */
export function usePrivateDraft(
  bookingId: string,
  initial: DisputeDraftView | undefined,
  content: DisputeDraftContent,
  readOnly: boolean,
) {
  const [queue] = useState(() => {
    const path = draftPath(bookingId);
    return new PrivateDraftQueue(initial, {
      save: async (packet) => (await api.post<DisputeDraftView>(path, packet)).data,
      read: async () => (await api.get<DisputeDraftView>(path)).data,
    });
  });
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const { issueCode, requestedOutcome, statement, step } = content;
  useEffect(() => {
    queue.setActive(true);
    return () => queue.setActive(false);
  }, [queue]);
  useEffect(() => {
    queue.update({ issueCode, requestedOutcome, statement, step }, readOnly);
    // Errors require an explicit retry; conflicts require an explicit fresh-version review.
    if (!readOnly && queue.enabled && queue.getSnapshot().state === 'dirty') {
      const timer = setTimeout(() => void queue.flush(), 600);
      return () => clearTimeout(timer);
    }
  }, [queue, issueCode, requestedOutcome, statement, step, readOnly]);
  return { ...snapshot, enabled: queue.enabled, flush: queue.flush, reload: queue.reload };
}
