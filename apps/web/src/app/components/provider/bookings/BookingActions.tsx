import { useRef, useState } from 'react';
import type { BookingStatus } from '@homeservicemarketplace/contracts';
import { CheckCircle2, Loader2, Play, X } from 'lucide-react';

import { useLang } from '../../../i18n/LanguageContext';
import {
  useCancelProviderBooking,
  useCompleteProviderBooking,
  useStartProviderBooking,
} from '../../../hooks/provider/useProviderBookings';
import { ProviderButton, ProviderConfirmDialog } from '../../../features/provider-ui';
import {
  BOOKING_COPY,
  classifyActionError,
  type BookingAction,
  type ProviderActionError,
} from './booking-copy';

// R17-E (E-4) — Start / Complete / Cancel for one booking.
//
// The buttons a status offers are presentation of the server's state machine
// (SCHEDULED → IN_PROGRESS → COMPLETED, SCHEDULED → CANCELLED), and the server
// re-decides every transition (conditional update, 409 on a stale state). So
// this component does three things only:
//
//   - asks for confirmation before a cancellation, because it cannot be undone;
//   - says what happened: "Starting…" while in flight, "Job started" only once
//     the server confirmed it, and a specific reason when it did not;
//   - lets the settled mutation refetch the booking (useProviderBookings), so a
//     conflict or a lost response shows the server's current state, not the
//     state the button assumed.
//
// It never retries: a repeated start is answered 409, which is then explained.

type Outcome =
  | { action: BookingAction; kind: 'done' }
  | { action: BookingAction; kind: 'failed'; error: ProviderActionError };

export function BookingActions({
  bookingId,
  status,
}: {
  bookingId: string;
  status: BookingStatus;
}) {
  const { lang, dir } = useLang();
  const copy = BOOKING_COPY[lang === 'ar' ? 'ar' : 'en'];
  const start = useStartProviderBooking();
  const complete = useCompleteProviderBooking();
  const cancel = useCancelProviderBooking();
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const cancelTrigger = useRef<HTMLButtonElement>(null);

  const pending: BookingAction | null = start.isPending
    ? 'start'
    : complete.isPending
      ? 'complete'
      : cancel.isPending
        ? 'cancel'
        : null;

  const run = (action: BookingAction) => {
    if (pending) return;
    setOutcome(null);
    const mutation = action === 'start' ? start : action === 'complete' ? complete : cancel;
    mutation.mutate(bookingId, {
      onSuccess: () => setOutcome({ action, kind: 'done' }),
      onError: (error) => setOutcome({ action, kind: 'failed', error: classifyActionError(error) }),
    });
  };

  // A finished booking offers nothing; render nothing unless there is an
  // outcome to report (for example "Booking cancelled." just now).
  if ((status === 'COMPLETED' || status === 'CANCELLED') && !outcome) return null;

  const label = (action: BookingAction) =>
    pending === action ? copy.pending[action] : copy.action[action];
  const icon = (action: BookingAction, Idle: typeof Play) =>
    pending === action ? (
      <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
    ) : (
      <Idle size={16} aria-hidden="true" />
    );

  return (
    <div className="flex flex-col gap-2" data-testid={`provider-booking-actions-${bookingId}`}>
      {status === 'SCHEDULED' && (
        <>
          <ProviderButton
            size="block"
            onClick={() => run('start')}
            disabled={pending !== null}
            aria-busy={pending === 'start'}
            data-testid={`provider-booking-start-${bookingId}`}
          >
            {icon('start', Play)}
            {label('start')}
          </ProviderButton>
          <ProviderButton
            ref={cancelTrigger}
            tone="ghost"
            size="block"
            className="!text-pv-danger"
            onClick={() => setConfirming(true)}
            disabled={pending !== null}
            aria-busy={pending === 'cancel'}
            data-testid={`provider-booking-cancel-${bookingId}`}
          >
            {icon('cancel', X)}
            {label('cancel')}
          </ProviderButton>
        </>
      )}
      {status === 'IN_PROGRESS' && (
        <ProviderButton
          size="block"
          onClick={() => run('complete')}
          disabled={pending !== null}
          aria-busy={pending === 'complete'}
          data-testid={`provider-booking-complete-${bookingId}`}
        >
          {icon('complete', CheckCircle2)}
          {label('complete')}
        </ProviderButton>
      )}

      {/* One live region per booking: success is polite, failure is an alert. */}
      {outcome?.kind === 'done' && (
        <p
          role="status"
          aria-live="polite"
          className="text-pv-label font-semibold text-pv-done"
          data-testid={`provider-booking-action-done-${bookingId}`}
          data-action={outcome.action}
        >
          {copy.done[outcome.action]}
        </p>
      )}
      {outcome?.kind === 'failed' && (
        <p
          role="alert"
          className="text-pv-label font-semibold text-pv-danger"
          data-testid={`provider-booking-action-error-${bookingId}`}
          data-action={outcome.action}
          data-error={outcome.error}
        >
          {copy.errors[outcome.error]}
        </p>
      )}

      <ProviderConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={copy.confirm.title}
        description={copy.confirm.body}
        keepLabel={copy.confirm.keep}
        confirmLabel={copy.confirm.confirm}
        onConfirm={() => run('cancel')}
        dir={dir === 'rtl' ? 'rtl' : 'ltr'}
        testId={`provider-booking-cancel-dialog-${bookingId}`}
        returnFocusRef={cancelTrigger}
      />
    </div>
  );
}
