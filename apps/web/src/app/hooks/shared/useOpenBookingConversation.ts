import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ConversationSummary,
  CreateConversationResponse,
} from '@homeservicemarketplace/contracts';

// R12 — the Message action on a booking.
//
// The server decides which conversation a booking has, and who is in it
// (`POST …/conversations { bookingId }`, get-or-create). This hook asks it,
// and hands over the conversation it answers with. It never builds a contact
// out of what the screen happens to show.
//
// What makes it safe to press on a screen that can change under it:
//
//   - one request at a time per booking: pressing again while one is in
//     flight does nothing;
//   - the answer is used only if it is for the booking still on screen, from
//     the latest press, for the same signed-in person, while the screen is
//     still mounted. A late answer for booking A never opens a chat while
//     booking B is shown, and one person's answer never reaches the next;
//   - "opening" and "failed" belong to one booking and are not shown on
//     another.

export type OpenConversationError =
  /** Nothing reached the server, or no answer came back. */
  | 'NETWORK'
  /** The session is gone. */
  | 'SESSION'
  /** The server does not know this booking for this person. */
  | 'NOT_FOUND'
  | 'UNKNOWN';

export type OpenConversationState =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'failed'; error: OpenConversationError };

function classify(error: unknown): OpenConversationError {
  const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === undefined) return 'NETWORK';
  if (status === 401 || status === 403) return 'SESSION';
  if (status === 404) return 'NOT_FOUND';
  return 'UNKNOWN';
}

const signedInUserId = (qc: ReturnType<typeof useQueryClient>): string | null =>
  (qc.getQueryData(['auth', 'me']) as { id?: string } | null | undefined)?.id ?? null;

export function useOpenBookingConversation(
  bookingId: string | null,
  request: (bookingId: string) => Promise<CreateConversationResponse>,
  onOpened: (conversation: ConversationSummary, bookingId: string) => void,
) {
  const qc = useQueryClient();
  const [scoped, setScoped] = useState<{ bookingId: string; state: OpenConversationState } | null>(
    null,
  );
  const current = useRef(bookingId);
  const mounted = useRef(true);
  const attempt = useRef(0);
  const inFlight = useRef<string | null>(null);

  useEffect(() => {
    current.current = bookingId;
  }, [bookingId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const state: OpenConversationState =
    scoped && scoped.bookingId === bookingId ? scoped.state : { kind: 'idle' };

  const open = useCallback(async () => {
    if (!bookingId || inFlight.current === bookingId) return;
    const target = bookingId;
    const mine = (attempt.current += 1);
    const madeBy = signedInUserId(qc);
    inFlight.current = target;
    setScoped({ bookingId: target, state: { kind: 'opening' } });
    const stillWanted = () =>
      mounted.current &&
      attempt.current === mine &&
      current.current === target &&
      signedInUserId(qc) === madeBy;
    // An answer nobody wants any more opens nothing, but the button it
    // belonged to stops saying "opening".
    const settle = () => {
      if (mounted.current && attempt.current === mine) {
        setScoped({ bookingId: target, state: { kind: 'idle' } });
      }
    };
    try {
      const { conversation } = await request(target);
      if (!stillWanted()) return settle();
      setScoped({ bookingId: target, state: { kind: 'idle' } });
      onOpened(conversation, target);
    } catch (error) {
      if (!stillWanted()) return settle();
      setScoped({ bookingId: target, state: { kind: 'failed', error: classify(error) } });
    } finally {
      if (inFlight.current === target) inFlight.current = null;
    }
  }, [bookingId, onOpened, qc, request]);

  return { state, open };
}
