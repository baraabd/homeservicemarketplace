import { matchPath } from 'react-router';

export const ADMIN_SECTIONS = [
  'dashboard',
  'users',
  'providers',
  'reviews',
  'identity-cases',
  'financials',
  'disputes',
  'settings',
  'audit',
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** One explicit route inventory. Unknown descendants never render a different page. */
export function resolveAdminRoute(pathname: string) {
  const path = pathname.replace(/\/$/, '') || '/';
  if (path === '/admin/verification') return { kind: 'legacy' } as const;
  if (path === '/admin/settings/verification-policies') {
    return { kind: 'policies', section: 'settings' } as const;
  }
  const provider = matchPath('/admin/providers/:providerProfileId', path);
  if (provider?.params.providerProfileId) {
    return {
      kind: 'provider',
      section: 'providers',
      providerProfileId: provider.params.providerProfileId,
    } as const;
  }
  const section = path === '/admin' ? 'dashboard' : path.slice('/admin/'.length);
  if (
    (path === '/admin' || path.startsWith('/admin/')) &&
    ADMIN_SECTIONS.includes(section as AdminSection)
  ) {
    return { kind: 'section', section: section as AdminSection } as const;
  }
  return { kind: 'notFound' } as const;
}

export type AdminRoute = ReturnType<typeof resolveAdminRoute>;

export function sectionPath(section: AdminSection) {
  return section === 'dashboard' ? '/admin' : `/admin/${section}`;
}

/** Only the Admin home and known lists can be a dossier's return destination. */
export function directoryReturn(search: string) {
  const target = new URLSearchParams(search).get('returnTo');
  return target &&
    (target === '/admin' || /^\/admin\/(providers|reviews|users|identity-cases)(\?[^#]*)?$/.test(target))
    ? target
    : '/admin/reviews';
}
