import { type IntendedApp, INTENDED_APP_PATHS, getIntendedApp } from './intended-app';
import { sanitizeAuthReturnTo } from './auth-return-to';

/** Routing is shared by the eager guards and lazy auth pages. Keep their
 * destination policy independent of the auth forms' visual theme data. */
export interface ResolveDestinationInput {
  /** Sanitised deep-link target; takes precedence over every other hint. */
  returnTo?: string | null | undefined;
  /** Explicit launcher intent, otherwise read the current tab's saved intent. */
  intentApp?: IntendedApp | null | undefined;
  /** Preserve the auth experience the user saw if its stored intent was cleared. */
  experienceId?: IntendedApp | null | undefined;
  /** Used only when no return target, intent or experience is available. */
  userRoles?: readonly string[] | null | undefined;
}

export const SELECT_PATH = '/select';

function isIntendedApp(value: unknown): value is IntendedApp {
  return value === 'seeker' || value === 'provider' || value === 'admin';
}

// These are navigation hints, not authorization. The route and API guards
// still enforce the roles required by the selected destination.
export function resolvePostAuthDestination(input: ResolveDestinationInput): string {
  const returnTo = sanitizeAuthReturnTo(input.returnTo);
  if (returnTo) return returnTo;
  const intent = isIntendedApp(input.intentApp) ? input.intentApp : getIntendedApp();
  if (intent) return INTENDED_APP_PATHS[intent];

  if (isIntendedApp(input.experienceId)) {
    return INTENDED_APP_PATHS[input.experienceId];
  }

  const roles = input.userRoles ?? [];
  const hasProvider = roles.includes('provider');
  const hasAdmin = roles.includes('admin');
  if (hasProvider && hasAdmin) return SELECT_PATH;
  if (hasProvider) return INTENDED_APP_PATHS.provider;
  if (hasAdmin) return INTENDED_APP_PATHS.admin;
  return INTENDED_APP_PATHS.seeker;
}
