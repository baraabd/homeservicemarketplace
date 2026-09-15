import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useLang } from '../../i18n/LanguageContext';
import { UsersSection } from '../../features/admin-directory/components/UsersSection';
import { ProviderDirectory } from '../../features/admin-directory/components/ProviderDirectory';
import { AdminProviderReviewWorkspace } from '../../features/admin-provider-review/components/AdminProviderReviewWorkspace';
import { AdminIdentityCasesPage } from '../../features/admin-verification/components/AdminIdentityCasesPage';
import { VerificationPolicyPanel } from '../../features/admin-verification/components/VerificationPolicyPanel';
import { DisputeSection } from './DisputesSection';
import { DashboardOverview } from './DashboardOverview';
import { FinancialsSection } from './FinancialsSection';
import { SettingsSection } from './SettingsSection';
import { AuditLogsSection } from './AuditLogsSection';
import { directoryReturn, type AdminRoute } from './admin-routes';

export function AdminRouteContent({ route }: { route: AdminRoute }) {
  const { lang } = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  if (route.kind === 'legacy') {
    return <Navigate to={`/admin/reviews${location.search}`} state={location.state} replace />;
  }
  if (route.kind === 'provider') {
    return (
      <AdminProviderReviewWorkspace
        providerProfileId={route.providerProfileId}
        onBack={() => navigate(directoryReturn(location.search), { state: location.state })}
      />
    );
  }
  if (route.kind === 'policies') {
    return (
      <div className="admin-review ar-stack">
        <div>
          <Link className="ar-button" to="/admin/settings">
            {lang === 'ar' ? 'العودة إلى الإعدادات' : 'Back to settings'}
          </Link>
        </div>
        <VerificationPolicyPanel />
      </div>
    );
  }
  if (route.kind === 'notFound') {
    return (
      <div className="admin-review ar-stack">
        <p role="status">{lang === 'ar' ? 'الصفحة غير موجودة.' : 'Page not found.'}</p>
        <div>
          <Link to="/admin" className="ar-button">
            {lang === 'ar' ? 'لوحة التحكم' : 'Dashboard'}
          </Link>
        </div>
      </div>
    );
  }
  switch (route.section) {
    case 'dashboard':
      return <DashboardOverview lang={lang} />;
    case 'users':
      return <UsersSection lang={lang} />;
    case 'providers':
      return <ProviderDirectory key="providers" />;
    case 'reviews':
      return <ProviderDirectory key="reviews" reviewQueue />;
    case 'identity-cases':
      return <AdminIdentityCasesPage />;
    case 'financials':
      return <FinancialsSection lang={lang} />;
    case 'disputes':
      return <DisputeSection lang={lang} />;
    case 'settings':
      return <SettingsSection lang={lang} />;
    case 'audit':
      return <AuditLogsSection lang={lang} />;
  }
}
