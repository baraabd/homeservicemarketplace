// Sprint 7.14 — in-app notification target handler bridge.
//
// The seeker app routes notification targets through React state
// overlays (setJobDetail / setBidsLead / setChatContact), NOT through
// URL routes — there is no `/home/requests/:id` or `/home/bookings/:id`
// route, so navigating to a resolved deepLink hits the `*` catch-all
// and redirects to `/select` (the app selector). That's why a toast's
// "View" button opened the generic home while the drawer (which calls
// the overlay setters directly) opened the right detail.
//
// This holder lets the in-app overlay router (HomeScreen) register a
// handler that the toast dispatcher invokes with the SAME
// `NotificationTarget` the drawer uses — so both surfaces converge on
// one resolver + one overlay router with zero duplicated routing. When
// no handler is registered (e.g. the surface for this target's
// experience isn't mounted), the toast falls back to URL navigation via
// the realtime-navigator.
//
// Mirrors the realtime-navigator holder pattern: a module-level
// singleton set by a React effect, cleared on unmount.

import type { NotificationTarget } from './notification-target';

// Returns `true` when the target was handled in-app (the toast then
// skips URL navigation); `false`/absent when it could not be handled
// (the toast falls back to navigating the deepLink).
export type NotificationTargetHandler = (target: NotificationTarget) => boolean;

let current: NotificationTargetHandler | null = null;

export function setNotificationTargetHandler(handler: NotificationTargetHandler | null): void {
  current = handler;
}

export function getNotificationTargetHandler(): NotificationTargetHandler | null {
  return current;
}

// Test-only reset so suites start from a clean holder.
export function __resetNotificationTargetHandlerForTests(): void {
  current = null;
}
