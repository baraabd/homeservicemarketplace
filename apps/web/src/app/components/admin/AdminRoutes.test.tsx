import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { AdminRouteContent } from './AdminRouteContent';
import { directoryReturn, resolveAdminRoute } from './admin-routes';

vi.mock('../../features/admin-directory/components/ProviderDirectory', () => ({
  ProviderDirectory: ({ reviewQueue }: { reviewQueue?: boolean }) => (
    <>
      <h2>{reviewQueue ? 'Review requests' : 'Provider directory'}</h2>
      <Link to="/admin/providers/p-1?returnTo=%2Fadmin%2Freviews%3Fquery%3DAda%26cursor%3Dpage2">
        Open Ada
      </Link>
    </>
  ),
}));
vi.mock('../../features/admin-provider-review/components/AdminProviderReviewWorkspace', () => ({
  AdminProviderReviewWorkspace: ({ onBack }: { onBack: () => void }) => (
    <button onClick={onBack}>Back to results</button>
  ),
}));
vi.mock('../../features/admin-verification/components/VerificationPolicyPanel', () => ({
  VerificationPolicyPanel: () => <h2>Policy settings</h2>,
}));
vi.mock('../../features/admin-verification/components/AdminIdentityCasesPage', () => ({
  AdminIdentityCasesPage: () => <h2>Specialist cases</h2>,
}));

function Harness() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{location.pathname + location.search}</output>
      <AdminRouteContent route={resolveAdminRoute(location.pathname)} />
    </>
  );
}
function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <Harness />
      </LanguageProvider>
    </MemoryRouter>,
  );
}
describe('Admin entry points and preserved review context', () => {
  it('an existing verification bookmark reaches application review without legacy policy or case panels', async () => {
    open('/admin/verification?query=Ada');
    expect(await screen.findByRole('heading', { name: 'Review requests' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/reviews?query=Ada');
    expect(screen.queryByText('Policy settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Specialist cases')).not.toBeInTheDocument();
  });
  it('opening and returning from a dossier restores the exact filtered result page', async () => {
    open('/admin/reviews?query=Ada&cursor=page2');
    fireEvent.click(screen.getByRole('link', { name: 'Open Ada' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to results' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/admin/reviews?query=Ada&cursor=page2',
    );
  });
  it('policies are an explicit settings destination with a return link', () => {
    open('/admin/settings/verification-policies');
    expect(screen.getByText('Policy settings')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/settings');
    expect(screen.queryByText('Review requests')).not.toBeInTheDocument();
  });
  it('an unknown settings descendant does not mount policy management', () => {
    open('/admin/settings/not-a-page');
    expect(screen.queryByText('Policy settings')).not.toBeInTheDocument();
    expect(screen.getByText(/Page not found|الصفحة غير موجودة/)).toBeInTheDocument();
  });
  it.each([
    'https://example.com',
    '//example.com',
    '/admin/settings/verification-policies',
    '/admin/providers/another',
    '/admin/reviews#unexpected',
  ])('rejects an unrelated dossier return destination %s', (target) => {
    expect(directoryReturn('?returnTo=' + encodeURIComponent(target))).toBe('/admin/reviews');
  });
  it('supports returning to a specific identity case while preserving filters', () => {
    expect(
      directoryReturn(
        '?returnTo=' + encodeURIComponent('/admin/identity-cases?state=IN_REVIEW&case=c1'),
      ),
    ).toBe('/admin/identity-cases?state=IN_REVIEW&case=c1');
  });
});
