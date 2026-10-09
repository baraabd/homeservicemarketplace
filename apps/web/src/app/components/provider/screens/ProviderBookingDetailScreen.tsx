import { Link, useParams } from 'react-router';
import type {
  BookingStatus,
  ProviderBookingTimelineResponse,
} from '@homeservicemarketplace/contracts';
import { ChevronLeft } from 'lucide-react';

import { useLang } from '../../../i18n/LanguageContext';
import {
  useProviderBookingDetail,
  useProviderBookingTimeline,
} from '../../../hooks/provider/useProviderBookings';
import {
  ProviderCard,
  ProviderContainer,
  ProviderErrorState,
  ProviderPageHeader,
  ProviderSection,
  ProviderSkeleton,
  ProviderStatusBadge,
  ProviderStatusTimeline,
  type TimelineEntry,
} from '../../../features/provider-ui';
import { BookingActions } from '../bookings/BookingActions';
import { BookingMessageButton } from '../bookings/BookingMessageButton';
import {
  BOOKING_COPY,
  BOOKING_STATUS_TONE,
  formatBookingTime,
  formatOffer,
  type BookingCopy,
} from '../bookings/booking-copy';

// R17-E (E-7) — one booking, from the server's records only.
//
// Every field is the provider projection GET /v1/provider/bookings/:id
// returns — service, the customer's first name and city, the agreed offer,
// the schedule and the address the booking was made for — and the history is
// GET …/timeline, the BookingEvent rows written in each transition's
// transaction. Nothing here is derived: no ETA, no live location, no contact
// details the projection does not carry. Coordinates are in the projection
// but are not shown; there is no map on this surface.

const COPY = {
  en: {
    back: 'Bookings',
    loading: 'Loading the booking…',
    failed: 'Couldn’t load this booking.',
    retry: 'Try again',
    notFound: 'This booking isn’t available',
    notFoundBody: 'It may belong to another account, or no longer exist.',
    service: 'Service',
    customer: 'Customer',
    offer: 'Agreed offer',
    note: 'Your note',
    when: 'When',
    asap: 'As soon as possible',
    where: 'Where',
    description: 'Request',
    history: 'History',
    historyFailed: 'Couldn’t load the history.',
    actions: 'Actions',
    reference: 'Reference',
  },
  ar: {
    back: 'الحجوزات',
    loading: 'جارٍ تحميل الحجز…',
    failed: 'تعذّر تحميل هذا الحجز.',
    retry: 'إعادة المحاولة',
    notFound: 'هذا الحجز غير متاح',
    notFoundBody: 'ربما يخص حساباً آخر، أو لم يعد موجوداً.',
    service: 'الخدمة',
    customer: 'العميل',
    offer: 'العرض المتفق عليه',
    note: 'ملاحظتك',
    when: 'الموعد',
    asap: 'في أقرب وقت ممكن',
    where: 'المكان',
    description: 'الطلب',
    history: 'السجل',
    historyFailed: 'تعذّر تحميل السجل.',
    actions: 'الإجراءات',
    reference: 'المرجع',
  },
} as const;

const STATUSES: readonly BookingStatus[] = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

function timelineEntries(
  items: ProviderBookingTimelineResponse['items'],
  copy: BookingCopy,
  lang: 'en' | 'ar',
): TimelineEntry[] {
  return items.map((event, i) => {
    const to = (event.metadata as { to?: unknown } | null)?.to;
    const status = STATUSES.find((s) => s === to);
    const title =
      event.type === 'BOOKING_CREATED'
        ? copy.timeline.BOOKING_CREATED
        : event.type === 'BOOKING_CANCELLED'
          ? copy.timeline.BOOKING_CANCELLED
          : status
            ? copy.status[status]
            : copy.timeline.changed;
    return {
      id: event.id,
      title,
      at: formatBookingTime(event.createdAt, lang),
      tone:
        event.type === 'BOOKING_CANCELLED'
          ? 'blocked'
          : status
            ? BOOKING_STATUS_TONE[status]
            : 'done',
      current: i === items.length - 1,
    };
  });
}

export function ProviderBookingDetailScreen() {
  const { bookingId = '' } = useParams();
  const { lang } = useLang();
  const language: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en';
  const c = COPY[language];
  const bookingCopy = BOOKING_COPY[language];
  const detail = useProviderBookingDetail(bookingId);
  const timeline = useProviderBookingTimeline(bookingId);
  const status = (detail.error as { response?: { status?: number } } | null)?.response?.status;

  const back = (
    <Link
      to="/provider/bookings"
      data-testid="provider-booking-back"
      className="inline-flex min-h-[44px] items-center gap-1 self-start rounded-xl px-2 text-pv-label font-semibold text-pv-accent hover:bg-pv-accent-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-accent"
    >
      <ChevronLeft size={16} aria-hidden="true" className="rtl:rotate-180" />
      {c.back}
    </Link>
  );

  let body: React.ReactNode;
  if (detail.isPending) {
    body = <ProviderSkeleton rows={4} label={c.loading} />;
  } else if (detail.isError && !detail.data) {
    body =
      status === 404 ? (
        <ProviderErrorState
          title={c.notFound}
          description={c.notFoundBody}
          testId="provider-booking-not-found"
        />
      ) : (
        <ProviderErrorState
          title={c.failed}
          retryLabel={c.retry}
          onRetry={() => void detail.refetch()}
          testId="provider-booking-error"
        />
      );
  } else {
    const b = detail.data;
    const service =
      (language === 'ar' ? b.service.categoryLabelAr : b.service.categoryLabelEn) ??
      b.service.customServiceText ??
      '';
    const offer = formatOffer(b.priceAmount, b.currency, b.pricingType, language);
    const place = [b.addressSnapshot?.line1, b.addressSnapshot?.city].filter(Boolean).join(', ');
    body = (
      <>
        <ProviderPageHeader
          title={service}
          subtitle={
            <>
              {c.reference}: <bdi dir="ltr">{b.id}</bdi>
            </>
          }
          actions={
            <span data-testid="provider-booking-status" data-status={b.status}>
              <ProviderStatusBadge
                tone={BOOKING_STATUS_TONE[b.status]}
                label={bookingCopy.status[b.status]}
              />
            </span>
          }
        />

        <ProviderCard className="p-4">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-pv-label text-pv-muted">{c.customer}</dt>
              <dd className="break-words text-pv-body font-semibold text-pv-text">
                {b.seeker.firstName} · {b.seeker.city}
              </dd>
            </div>
            <div>
              <dt className="text-pv-label text-pv-muted">{c.offer}</dt>
              <dd
                className="text-pv-body font-semibold text-pv-text"
                data-testid="provider-booking-offer"
              >
                <bdi dir="ltr">{offer.value}</bdi> {offer.basis}
              </dd>
            </div>
            <div>
              <dt className="text-pv-label text-pv-muted">{c.when}</dt>
              <dd className="text-pv-body text-pv-text">
                {b.scheduledAt ? formatBookingTime(b.scheduledAt, language) : c.asap}
              </dd>
            </div>
            {place && (
              <div>
                <dt className="text-pv-label text-pv-muted">{c.where}</dt>
                <dd className="break-words text-pv-body text-pv-text">{place}</dd>
              </div>
            )}
            {b.description && (
              <div className="sm:col-span-2">
                <dt className="text-pv-label text-pv-muted">{c.description}</dt>
                <dd className="whitespace-pre-line break-words text-pv-body text-pv-text">
                  {b.description}
                </dd>
              </div>
            )}
            {b.bidNote && (
              <div className="sm:col-span-2">
                <dt className="text-pv-label text-pv-muted">{c.note}</dt>
                <dd className="break-words text-pv-body text-pv-text">{b.bidNote}</dd>
              </div>
            )}
          </dl>
        </ProviderCard>

        <ProviderSection title={c.actions}>
          <BookingActions bookingId={b.id} status={b.status} />
          <BookingMessageButton bookingId={b.id} lang={language} />
        </ProviderSection>

        <ProviderSection title={c.history}>
          {timeline.isPending ? (
            <ProviderSkeleton rows={2} />
          ) : timeline.isError && !timeline.data ? (
            <ProviderErrorState
              title={c.historyFailed}
              retryLabel={c.retry}
              onRetry={() => void timeline.refetch()}
              testId="provider-booking-timeline-error"
            />
          ) : (
            <ProviderStatusTimeline
              entries={timelineEntries(timeline.data.items, bookingCopy, language)}
            />
          )}
        </ProviderSection>
      </>
    );
  }

  return (
    <div
      className="absolute inset-0 overflow-y-auto bg-pv-bg"
      data-testid="provider-booking-detail"
    >
      <ProviderContainer width="form" className="flex flex-col gap-4 py-5">
        {back}
        {body}
      </ProviderContainer>
    </div>
  );
}
