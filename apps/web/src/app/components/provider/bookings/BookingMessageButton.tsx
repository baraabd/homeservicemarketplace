import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary } from '@homeservicemarketplace/contracts';
import { Loader2, MessageCircle } from 'lucide-react';

import {
  useOpenBookingConversation,
  type OpenConversationError,
} from '../../../hooks/shared/useOpenBookingConversation';
import { getOrCreateProviderConversation } from '../../../../lib/provider/provider-chat-api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';

// ─── Booking Message action (R12) ─────────────────────────────────────────────
// Opens this booking's conversation as the server resolves it for the
// provider side, then shows it under /provider/messages/:id. The provider
// routes require the provider to be allowed to manage bookings; a refusal is
// shown, not hidden. (Moved from MyBidsScreen in R17-E so the booking detail
// screen uses the same control.)
const openProviderBookingConversation = (bookingId: string) =>
  getOrCreateProviderConversation({ bookingId });

const MESSAGE_COPY = {
  en: {
    message: 'Message customer',
    opening: 'Opening…',
    errors: {
      NETWORK: 'Couldn’t open the conversation. Check your connection and try again.',
      SESSION: 'You can’t message this customer right now.',
      NOT_FOUND: 'This booking’s conversation isn’t available.',
      UNKNOWN: 'Couldn’t open the conversation. Try again.',
    } satisfies Record<OpenConversationError, string>,
  },
  ar: {
    message: 'مراسلة العميل',
    opening: 'جارٍ الفتح…',
    errors: {
      NETWORK: 'تعذّر فتح المحادثة. تحقق من اتصالك وحاول مرة أخرى.',
      SESSION: 'لا يمكنك مراسلة هذا العميل الآن.',
      NOT_FOUND: 'محادثة هذا الحجز غير متاحة.',
      UNKNOWN: 'تعذّر فتح المحادثة. حاول مرة أخرى.',
    } satisfies Record<OpenConversationError, string>,
  },
} as const;

export function BookingMessageButton({
  bookingId,
  lang,
}: {
  bookingId: string;
  lang: 'en' | 'ar';
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const onOpened = useCallback(
    (conversation: ConversationSummary) => {
      void qc.invalidateQueries({ queryKey: providerQueryKeys.chat.conversations() });
      navigate(`/provider/messages/${conversation.id}`);
    },
    [navigate, qc],
  );
  const { state, open } = useOpenBookingConversation(
    bookingId,
    openProviderBookingConversation,
    onOpened,
  );
  const copy = MESSAGE_COPY[lang];
  const opening = state.kind === 'opening';
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void open()}
        disabled={opening}
        aria-busy={opening}
        data-testid={`provider-booking-message-${bookingId}`}
        className="w-full min-h-[44px] py-2.5 rounded-2xl border border-pv-line text-pv-ink flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-60"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        {opening ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : (
          <MessageCircle size={14} aria-hidden="true" />
        )}
        {opening ? copy.opening : copy.message}
      </button>
      {state.kind === 'failed' && (
        <p
          role="alert"
          className="text-red-600 text-center mt-1"
          style={{ fontSize: '12px' }}
          data-testid={`provider-booking-message-error-${bookingId}`}
          data-error={state.error}
        >
          {copy.errors[state.error]}
        </p>
      )}
    </div>
  );
}
