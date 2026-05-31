// Sprint 7.x — tiny module-level navigation bridge for the realtime
// side-effects layer.
//
// `dispatchRealtimeSideEffects` is invoked from inside the socket
// hook, which is mounted by `AuthProvider` (above `RouterProvider`
// in Root.tsx). That means the bridge can't call `useNavigate()`
// directly — the hook would throw because the Router context isn't
// in scope at the call site.
//
// The pattern mirrors `realtime-i18n`: a tiny module-level holder
// that a UI component under `RouterProvider` populates via an
// effect at mount time. The read site (toast onClick handler) is a
// plain function call with no React semantics — easy to test, safe
// to invoke from any callsite.
//
// Setting `null` is the safe default: the toast action button stays
// hidden when no navigator is registered (logged-out / pre-render).

export type RealtimeNavigator = (deepLink: string) => void;

let currentNavigator: RealtimeNavigator | null = null;

export function setRealtimeNavigator(navigator: RealtimeNavigator | null): void {
  currentNavigator = navigator;
}

export function getRealtimeNavigator(): RealtimeNavigator | null {
  return currentNavigator;
}

// Test-only reset hook so unit tests start from a clean slate
// between runs. NOT for production use — the RouterProvider-scoped
// bridge component is the only legitimate writer.
export function __resetRealtimeNavigatorForTests(): void {
  currentNavigator = null;
}
