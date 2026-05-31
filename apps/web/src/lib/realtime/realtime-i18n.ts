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
  | 'realtime.notification.created';

const STRINGS: Record<RealtimeLang, Record<RealtimeStringKey, string>> = {
  en: {
    'realtime.booking.statusChanged': 'Booking status updated',
    'realtime.booking.completed': 'Booking completed',
    'realtime.booking.cancelled': 'Booking cancelled',
    'realtime.booking.started': 'Booking started',
    'realtime.notification.created': 'New notification',
  },
  ar: {
    'realtime.booking.statusChanged': 'تم تحديث حالة الحجز',
    'realtime.booking.completed': 'تم إنجاز الحجز',
    'realtime.booking.cancelled': 'تم إلغاء الحجز',
    'realtime.booking.started': 'بدأ تنفيذ الحجز',
    'realtime.notification.created': 'إشعار جديد',
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
