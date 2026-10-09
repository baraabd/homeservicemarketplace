import type { BookingStatus, PricingType } from '@homeservicemarketplace/contracts';

import type { ProviderTone } from '../../../features/provider-ui';

// R17-E — one vocabulary for provider booking state, actions and failures.
//
// Every string a booking surface shows lives here, in both languages, so the
// list, the detail screen and the My Bids card cannot describe the same
// server state three ways.

export type BookingAction = 'start' | 'complete' | 'cancel';

/** Why a booking or bid mutation did not land, as far as the client can say. */
export type ProviderActionError =
  /** No answer came back. The server may still have applied it. */
  | 'NETWORK'
  /** The session ended (401). */
  | 'SESSION'
  /** The server says this provider may no longer do this (403). */
  | 'FORBIDDEN'
  /** The booking is not this provider's, or no longer exists (404). */
  | 'NOT_FOUND'
  /** The state changed underneath the screen (409). */
  | 'CONFLICT'
  | 'UNKNOWN';

export function classifyActionError(error: unknown): ProviderActionError {
  const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === undefined) return 'NETWORK';
  if (status === 401) return 'SESSION';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  return 'UNKNOWN';
}

export const BOOKING_STATUS_TONE: Readonly<Record<BookingStatus, ProviderTone>> = Object.freeze({
  SCHEDULED: 'waiting',
  IN_PROGRESS: 'accent',
  COMPLETED: 'done',
  CANCELLED: 'blocked',
});

const en = {
  status: {
    SCHEDULED: 'Scheduled',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  } satisfies Record<BookingStatus, string>,
  // The established labels; real-browser suites (R07, PLATFORM-TX-1) address them.
  action: { start: 'Start Job', complete: 'Mark Complete', cancel: 'Cancel Booking' },
  pending: { start: 'Starting…', complete: 'Completing…', cancel: 'Cancelling…' },
  done: {
    start: 'Job started.',
    complete: 'Job marked complete.',
    cancel: 'Booking cancelled.',
  },
  errors: {
    NETWORK:
      'We couldn’t reach the server. The change may not have been saved — the booking below shows its current state.',
    SESSION: 'Your session has ended. Sign in again to continue.',
    FORBIDDEN: 'Your account can’t make this change right now. Check your account status.',
    NOT_FOUND: 'This booking isn’t available to you any more.',
    CONFLICT: 'This booking changed in the meantime. It now shows its current state.',
    UNKNOWN: 'That didn’t work. Please try again.',
  } satisfies Record<ProviderActionError, string>,
  confirm: {
    title: 'Cancel this booking?',
    body: 'The customer will be told you cancelled. A cancelled booking can’t be restarted.',
    keep: 'Keep booking',
    confirm: 'Yes, cancel booking',
  },
  withdraw: {
    action: 'Withdraw bid',
    pending: 'Withdrawing…',
    done: 'Bid withdrawn.',
    title: 'Withdraw this bid?',
    body: 'The customer will no longer see your offer. You can send a new one while the request is open.',
    keep: 'Keep bid',
    confirm: 'Yes, withdraw',
    conflict: 'This bid can no longer be withdrawn. It now shows its current state.',
  },
  pricing: { HOURLY: 'per hour', FIXED: 'fixed price' } satisfies Record<PricingType, string>,
  timeline: {
    BOOKING_CREATED: 'Booking created',
    BOOKING_CANCELLED: 'Booking cancelled',
    changed: 'Status changed',
  },
};

const ar: typeof en = {
  status: {
    SCHEDULED: 'مجدول',
    IN_PROGRESS: 'قيد التنفيذ',
    COMPLETED: 'مكتمل',
    CANCELLED: 'ملغى',
  },
  action: { start: 'ابدأ العمل', complete: 'إنهاء العمل', cancel: 'إلغاء الحجز' },
  pending: { start: 'جارٍ البدء…', complete: 'جارٍ الإنهاء…', cancel: 'جارٍ الإلغاء…' },
  done: {
    start: 'بدأ العمل.',
    complete: 'تم إنهاء العمل.',
    cancel: 'تم إلغاء الحجز.',
  },
  errors: {
    NETWORK: 'تعذّر الوصول إلى الخادم. ربما لم يُحفظ التغيير — يظهر الحجز أدناه بحالته الحالية.',
    SESSION: 'انتهت جلستك. سجّل الدخول مجدداً للمتابعة.',
    FORBIDDEN: 'لا يمكن لحسابك إجراء هذا التغيير حالياً. راجع حالة حسابك.',
    NOT_FOUND: 'لم يعد هذا الحجز متاحاً لك.',
    CONFLICT: 'تغيّر هذا الحجز في هذه الأثناء. يظهر الآن بحالته الحالية.',
    UNKNOWN: 'لم ينجح ذلك. حاول مرة أخرى.',
  },
  confirm: {
    title: 'إلغاء هذا الحجز؟',
    body: 'سيُبلَّغ العميل بأنك ألغيت الحجز. لا يمكن إعادة تشغيل حجز ملغى.',
    keep: 'الإبقاء على الحجز',
    confirm: 'نعم، ألغِ الحجز',
  },
  withdraw: {
    action: 'سحب العرض',
    pending: 'جارٍ السحب…',
    done: 'تم سحب العرض.',
    title: 'سحب هذا العرض؟',
    body: 'لن يرى العميل عرضك بعد الآن. يمكنك إرسال عرض جديد ما دام الطلب مفتوحاً.',
    keep: 'الإبقاء على العرض',
    confirm: 'نعم، اسحب العرض',
    conflict: 'لم يعد بالإمكان سحب هذا العرض. يظهر الآن بحالته الحالية.',
  },
  pricing: { HOURLY: 'للساعة', FIXED: 'سعر ثابت' },
  timeline: {
    BOOKING_CREATED: 'تم إنشاء الحجز',
    BOOKING_CANCELLED: 'تم إلغاء الحجز',
    changed: 'تغيّرت الحالة',
  },
};

export const BOOKING_COPY = { en, ar } as const;
export type BookingCopy = typeof en;

/**
 * The stored offer, as stored: the integer amount, the record's currency code
 * and its pricing type.
 *
 * Deliberately NOT a currency format. Whether `amount` is whole units or minor
 * units is an open money decision (R16 P8, R17-D decision 5); `Intl` with
 * `style: 'currency'` would pick an answer, and a "$" would assert dollars
 * the platform never chose. This prints exactly what the record holds.
 */
export function formatOffer(
  amount: number,
  currency: string,
  pricingType: PricingType,
  lang: 'en' | 'ar',
): { value: string; basis: string } {
  // Explicit regions, as the V2 provider copy does: a bare `ar` resolves
  // differently in Node and in Chromium.
  const locale = lang === 'ar' ? 'ar-EG' : 'en-US';
  return {
    value: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)} ${currency}`,
    basis: BOOKING_COPY[lang].pricing[pricingType],
  };
}

/** A server timestamp in the reader's language. */
export function formatBookingTime(iso: string, lang: 'en' | 'ar'): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
