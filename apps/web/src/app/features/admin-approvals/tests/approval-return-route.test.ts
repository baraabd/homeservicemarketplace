import { describe, expect, it } from 'vitest';
import { directoryReturn } from '../../../components/admin/admin-routes';

describe('Approval dossier return navigation', () => {
  it.each([
    '/admin', '/admin/reviews', '/admin/providers?status=DRAFT',
    '/admin/reviews?query=test&status=PENDING_REVIEW',
  ])('preserves an allowed local destination %s', (path) => {
    expect(directoryReturn(`?returnTo=${encodeURIComponent(path)}`)).toBe(path);
  });
  it.each([
    'https://evil.test', '//evil.test', '/administrator', '/admin/../login',
    '/admin#unsafe', '/admin/providers#unsafe',
  ])('rejects an unapproved destination %s', (path) => {
    expect(directoryReturn(`?returnTo=${encodeURIComponent(path)}`)).toBe('/admin/reviews');
  });
});
