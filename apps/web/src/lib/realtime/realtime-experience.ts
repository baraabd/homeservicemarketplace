// Sprint 7.12 — UI-experience bridge for the realtime side-effects
// dispatcher.
//
// Single Toaster mounts at Root; the same dispatcher fires toasts
// for both Seeker and Provider users. The toast THEME — orange/amber
// for Seeker, light-blue for Provider — must reflect the screen the
// user is currently on. The Router (and `useLocation()`) only works
// inside the router context, but the side-effects dispatcher is
// mounted ABOVE the Router by AuthProvider. Same shape as
// realtime-i18n / realtime-navigator: RootInner sits inside the
// Router and pushes the current experience into this module-level
// holder via a useEffect; the dispatcher reads with a pure function.
//
// Default is 'seeker' so the first paint (before the bridge effect
// runs) gets the brand colour of the more common entry path.

import type { NotificationExperience } from './notification-target';

let current: NotificationExperience = 'seeker';

export function setRealtimeExperience(experience: NotificationExperience): void {
  current = experience;
}

export function getRealtimeExperience(): NotificationExperience {
  return current;
}

// Test-only reset hook so tests can guarantee a known starting state.
export function __resetRealtimeExperienceForTests(): void {
  current = 'seeker';
}
