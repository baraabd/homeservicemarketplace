import { Link, useNavigate } from 'react-router';
import { ChevronRight } from 'lucide-react';

import { useLang } from '../../../i18n/LanguageContext';
import { useProviderBookings } from '../../../hooks/provider/useProviderBookings';
import {
  ProviderContainer,
  ProviderEmptyState,
  ProviderErrorState,
  ProviderNotice,
  ProviderPageHeader,
  ProviderSkeleton,
  ProviderStatusBadge,
} from '../../../features/provider-ui';
import {
  BOOKING_COPY,
  BOOKING_STATUS_TONE,
  formatBookingTime,
  formatOffer,
} from '../bookings/booking-copy';

// R17-E (E-5, E-7) — the provider's bookings, reachable on their own.
//
// Before this route the only booking surface was the accepted cards inside
// My Bids, which needs VIEW_MARKETPLACE. A RESTRICTED provider keeps
// MANAGE_BOOKINGS — "bookings already accepted are obligations to a seeker"
// (capability rank 4) — but had no screen that showed them. This list needs
// MANAGE_BOOKINGS only, exactly as GET /v1/provider/bookings does.

const COPY = {
  en: {
    title: 'Bookings',
    subtitle: 'Jobs customers booked with you',
    loading: 'Loading your bookings…',
    failed: 'Couldn’t load your bookings.',
    retry: 'Try again',
    empty: 'No bookings yet',
    emptyBody: 'When a customer accepts one of your bids, the booking appears here.',
    restrictedTitle: 'You can’t take new work right now',
    restrictedBody:
      'Your existing bookings stay available: you can still start, complete or cancel them.',
    status: 'See account status',
    scheduledFor: 'Scheduled',
    asap: 'As soon as possible',
    open: 'Open',
  },
  ar: {
    title: 'الحجوزات',
    subtitle: 'الأعمال التي حجزها العملاء معك',
    loading: 'جارٍ تحميل حجوزاتك…',
    failed: 'تعذّر تحميل حجوزاتك.',
    retry: 'إعادة المحاولة',
    empty: 'لا توجد حجوزات بعد',
    emptyBody: 'عندما يقبل عميل أحد عروضك، يظهر الحجز هنا.',
    restrictedTitle: 'لا يمكنك قبول أعمال جديدة حالياً',
    restrictedBody: 'تبقى حجوزاتك الحالية متاحة: لا يزال بإمكانك بدؤها أو إنهاؤها أو إلغاؤها.',
    status: 'عرض حالة الحساب',
    scheduledFor: 'الموعد',
    asap: 'في أقرب وقت ممكن',
    open: 'فتح',
  },
} as const;

export function ProviderBookingsScreen({ canTakeNewWork }: { canTakeNewWork: boolean }) {
  const { lang } = useLang();
  const language: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en';
  const c = COPY[language];
  const bookingCopy = BOOKING_COPY[language];
  const navigate = useNavigate();
  const query = useProviderBookings();
  const items = query.data?.items ?? [];

  return (
    <div className="absolute inset-0 overflow-y-auto bg-pv-bg" data-testid="provider-bookings">
      <ProviderContainer width="form" className="flex flex-col gap-4 py-5">
        <ProviderPageHeader title={c.title} subtitle={c.subtitle} />
        {!canTakeNewWork && (
          <ProviderNotice
            tone="blocked"
            title={c.restrictedTitle}
            description={c.restrictedBody}
            actionLabel={c.status}
            onAction={() => navigate('/provider/status')}
            data-testid="provider-bookings-restricted"
          />
        )}
        {query.isPending ? (
          <ProviderSkeleton rows={3} label={c.loading} />
        ) : query.isError && !query.data ? (
          <ProviderErrorState
            title={c.failed}
            retryLabel={c.retry}
            onRetry={() => void query.refetch()}
            testId="provider-bookings-error"
          />
        ) : items.length === 0 ? (
          <ProviderEmptyState title={c.empty} description={c.emptyBody} />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((b) => {
              const service =
                (language === 'ar' ? b.service.categoryLabelAr : b.service.categoryLabelEn) ??
                b.service.customServiceText ??
                '';
              const offer = formatOffer(b.priceAmount, b.currency, b.pricingType, language);
              return (
                <li key={b.id}>
                  <Link
                    to={`/provider/bookings/${b.id}`}
                    data-testid={`provider-booking-row-${b.id}`}
                    data-status={b.status}
                    className="flex min-h-[44px] items-start gap-3 rounded-xl border border-pv-border bg-pv-surface p-4 text-start transition-colors hover:border-pv-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-pv-heading font-semibold text-pv-text">
                        {service}
                      </p>
                      <p className="mt-0.5 break-words text-pv-label text-pv-muted">
                        {b.seeker.firstName} · {b.seeker.city}
                      </p>
                      <p className="mt-1 text-pv-label text-pv-text">
                        <bdi dir="ltr">{offer.value}</bdi> {offer.basis}
                      </p>
                      <p className="mt-0.5 text-pv-help text-pv-muted">
                        {c.scheduledFor}:{' '}
                        {b.scheduledAt ? formatBookingTime(b.scheduledAt, language) : c.asap}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-2">
                      <ProviderStatusBadge
                        tone={BOOKING_STATUS_TONE[b.status]}
                        label={bookingCopy.status[b.status]}
                      />
                      <span className="inline-flex items-center gap-1 text-pv-label font-semibold text-pv-accent">
                        {c.open}
                        <ChevronRight size={16} aria-hidden="true" className="rtl:rotate-180" />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ProviderContainer>
    </div>
  );
}
