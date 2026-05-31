// Sprint 7.5.1 — tiny framework-independent localisation helper for
// the realtime side-effects layer.
//
// `useRealtimeSocket` is mounted by `AuthProvider`, which sits ABOVE
// `LanguageProvider` in the tree (Root.tsx). That means the side-
// effects dispatched from inside the socket hook cannot call
// `useLang()` — the hook would throw because the context isn't in
// scope. Two options the sprint allowed: a UI-side bridge mounted
// under LanguageProvider, or a tiny standalone helper. We chose the
// helper because the only string we need to translate is the
// realtime toast copy, and a single-purpose lookup avoids forcing a
// whole subtree re-render every time `lang` flips.
//
// The component that already calls `useLang()` (RootInner) writes
// the current language into the module-level singleton via an
// effect. That makes the read site (toast dispatcher) a pure
// function call without React semantics — easy to unit-test and
// safe to invoke from any callsite.

export type RealtimeLang = 'en' | 'ar';

let currentLang: RealtimeLang = 'en';

// Pushed from the UI side under LanguageProvider so this module
// always knows the active locale. Idempotent — calling with the
// same value is a no-op.
export function setRealtimeLang(lang: RealtimeLang): void {
  currentLang = lang;
}

// Read by the side-effects dispatcher to localise toast / aria copy.
// Returns 'en' as the safe default before the bridge runs (e.g.,
// during the initial render before RootInner's effect fires).
export function getRealtimeLang(): RealtimeLang {
  return currentLang;
}

// Translation table for the realtime toast copy. Kept inline here
// rather than pulling from the app-wide TRANSLATIONS object so the
// realtime layer has zero coupling to the app's translation file —
// the realtime side-effects are loaded by the socket hook in a
// pre-render context and we don't want a circular import.
type RealtimeStringKey =
  | 'realtime.booking.statusChanged'
  | 'realtime.booking.completed'
  | 'realtime.booking.cancelled'
  | 'realtime.booking.started'
  | 'realtime.bid.accepted'
  | 'realtime.action.view'
  | 'realtime.notification.created'
  // Sprint 7.x — type-specific toast copy so the in-app banner says
  // what actually happened instead of a generic "New notification".
  // Keys map 1:1 onto the backend NotificationType enum names so the
  // side-effects dispatcher can do a direct lookup with a tiny
  // prefix-template (`realtime.notif.{type}.title` / `.body`).
  | 'realtime.notif.BID_RECEIVED.title'
  | 'realtime.notif.BID_RECEIVED.body'
  | 'realtime.notif.BID_ACCEPTED.title'
  | 'realtime.notif.BID_ACCEPTED.body'
  | 'realtime.notif.BOOKING_CREATED.title'
  | 'realtime.notif.BOOKING_CREATED.body'
  | 'realtime.notif.BOOKING_IN_PROGRESS.title'
  | 'realtime.notif.BOOKING_IN_PROGRESS.body'
  | 'realtime.notif.BOOKING_CANCELLED.title'
  | 'realtime.notif.BOOKING_CANCELLED.body'
  | 'realtime.notif.BOOKING_CANCELLED.bySeeker.body'
  | 'realtime.notif.BOOKING_CANCELLED.byProvider.body'
  | 'realtime.notif.BOOKING_COMPLETED.title'
  | 'realtime.notif.BOOKING_COMPLETED.body'
  | 'realtime.notif.MESSAGE_RECEIVED.title'
  | 'realtime.notif.MESSAGE_RECEIVED.body'
  | 'realtime.notif.REVIEW_REQUESTED.title'
  | 'realtime.notif.REVIEW_REQUESTED.body'
  | 'realtime.notif.REQUEST_AVAILABLE.title'
  | 'realtime.notif.REQUEST_AVAILABLE.body'
  | 'realtime.notif.SYSTEM.title'
  | 'realtime.notif.SYSTEM.body';

const STRINGS: Record<RealtimeLang, Record<RealtimeStringKey, string>> = {
  en: {
    'realtime.booking.statusChanged': 'Booking status updated',
    'realtime.booking.completed': 'Booking completed',
    'realtime.booking.cancelled': 'Booking cancelled',
    'realtime.booking.started': 'Booking started',
    'realtime.bid.accepted': 'Your bid was accepted',
    'realtime.action.view': 'View',
    'realtime.notification.created': 'New notification',
    // Sprint 7.x type-specific copy.
    'realtime.notif.BID_RECEIVED.title': 'New bid received',
    'realtime.notif.BID_RECEIVED.body': 'A provider sent a bid for your request.',
    'realtime.notif.BID_ACCEPTED.title': 'Bid accepted',
    'realtime.notif.BID_ACCEPTED.body': 'Your bid was accepted.',
    'realtime.notif.BOOKING_CREATED.title': 'Booking confirmed',
    'realtime.notif.BOOKING_CREATED.body': 'You have a new scheduled booking.',
    'realtime.notif.BOOKING_IN_PROGRESS.title': 'Booking started',
    'realtime.notif.BOOKING_IN_PROGRESS.body': 'The provider started your booking.',
    'realtime.notif.BOOKING_CANCELLED.title': 'Booking cancelled',
    'realtime.notif.BOOKING_CANCELLED.body': 'The booking was cancelled.',
    'realtime.notif.BOOKING_CANCELLED.bySeeker.body': 'The seeker cancelled the booking.',
    'realtime.notif.BOOKING_CANCELLED.byProvider.body': 'The provider cancelled the booking.',
    'realtime.notif.BOOKING_COMPLETED.title': 'Booking completed',
    'realtime.notif.BOOKING_COMPLETED.body': 'The service has been marked as completed.',
    'realtime.notif.MESSAGE_RECEIVED.title': 'New message',
    'realtime.notif.MESSAGE_RECEIVED.body': 'You have a new message.',
    'realtime.notif.REVIEW_REQUESTED.title': 'Review requested',
    'realtime.notif.REVIEW_REQUESTED.body': 'Please leave a review.',
    'realtime.notif.REQUEST_AVAILABLE.title': 'New request available',
    'realtime.notif.REQUEST_AVAILABLE.body': 'A new service request matches your profile.',
    'realtime.notif.SYSTEM.title': 'Notification',
    'realtime.notif.SYSTEM.body': '',
  },
  ar: {
    'realtime.booking.statusChanged': 'تم تحديث حالة الحجز',
    'realtime.booking.completed': 'تم إنجاز الحجز',
    'realtime.booking.cancelled': 'تم إلغاء الحجز',
    'realtime.booking.started': 'بدأ تنفيذ الحجز',
    'realtime.bid.accepted': 'تم قبول عرضك',
    'realtime.action.view': 'عرض',
    'realtime.notification.created': 'إشعار جديد',
    'realtime.notif.BID_RECEIVED.title': 'عرض جديد',
    'realtime.notif.BID_RECEIVED.body': 'قدّم مقدم خدمة عرضاً على طلبك.',
    'realtime.notif.BID_ACCEPTED.title': 'تم قبول العرض',
    'realtime.notif.BID_ACCEPTED.body': 'تم قبول عرضك.',
    'realtime.notif.BOOKING_CREATED.title': 'تم تأكيد الحجز',
    'realtime.notif.BOOKING_CREATED.body': 'لديك حجز جديد مجدول.',
    'realtime.notif.BOOKING_IN_PROGRESS.title': 'بدأ تنفيذ الحجز',
    'realtime.notif.BOOKING_IN_PROGRESS.body': 'بدأ مقدم الخدمة تنفيذ حجزك.',
    'realtime.notif.BOOKING_CANCELLED.title': 'تم إلغاء الحجز',
    'realtime.notif.BOOKING_CANCELLED.body': 'تم إلغاء الحجز.',
    'realtime.notif.BOOKING_CANCELLED.bySeeker.body': 'قام العميل بإلغاء الحجز.',
    'realtime.notif.BOOKING_CANCELLED.byProvider.body': 'قام مقدم الخدمة بإلغاء الحجز.',
    'realtime.notif.BOOKING_COMPLETED.title': 'تم إنجاز الحجز',
    'realtime.notif.BOOKING_COMPLETED.body': 'تم تعليم الخدمة كمنجزة.',
    'realtime.notif.MESSAGE_RECEIVED.title': 'رسالة جديدة',
    'realtime.notif.MESSAGE_RECEIVED.body': 'لديك رسالة جديدة.',
    'realtime.notif.REVIEW_REQUESTED.title': 'مطلوب مراجعة',
    'realtime.notif.REVIEW_REQUESTED.body': 'يرجى ترك مراجعة.',
    'realtime.notif.REQUEST_AVAILABLE.title': 'طلب جديد متاح',
    'realtime.notif.REQUEST_AVAILABLE.body': 'يوجد طلب جديد يطابق ملفك الشخصي.',
    'realtime.notif.SYSTEM.title': 'إشعار',
    'realtime.notif.SYSTEM.body': '',
  },
};

export function translateRealtime(key: RealtimeStringKey): string {
  return STRINGS[currentLang][key] ?? STRINGS.en[key] ?? key;
}

// Test-only reset hook so unit tests can guarantee the module starts
// from the documented default between runs. NOT for production use —
// the bridge effect is the only legitimate writer.
export function __resetRealtimeI18nForTests(): void {
  currentLang = 'en';
}
