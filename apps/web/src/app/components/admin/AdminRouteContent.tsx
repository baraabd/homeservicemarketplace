import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useLang } from '../../i18n/LanguageContext';
import { UsersSection } from '../../features/admin-directory/components/UsersSection';
import { ProviderDirectory } from '../../features/admin-directory/components/ProviderDirectory';
import { AdminProviderReviewWorkspace } from '../../features/admin-provider-review/components/AdminProviderReviewWorkspace';
import { AdminIdentityCasesPage } from '../../features/admin-verification/components/AdminIdentityCasesPage';
import { VerificationPolicyPanel } from '../../features/admin-verification/components/VerificationPolicyPanel';
import { AdminDisputeInbox } from '../../features/disputes/workspace/AdminDisputeInbox';
import { DisputeCenterSummary } from '../../features/disputes/workspace/DisputeCenterSummary';
import { WorkspacePanel } from '../../features/disputes/workspace/WorkspacePanel';
import { DashboardOverview } from './DashboardOverview';
import { ApprovalCenter } from '../../features/admin-approvals/ApprovalCenter';
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
  if (route.kind === 'dispute')
    return (
      <div className="ar-stack">
        <Link className="ar-button" to="/admin/disputes">
          {lang === 'ar' ? 'العودة إلى النزاعات' : 'Back to disputes'}
        </Link>
        <WorkspacePanel key={route.caseId} caseId={route.caseId} admin />
      </div>
    );
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
      return (
        <div className="ar-stack">
          <ApprovalCenter />
          {/* The two halves of Admin operations sit together: provider
              applications waiting on a decision, then cases waiting on one. */}
          <DisputeCenterSummary />
          <DashboardOverview lang={lang} />
        </div>
      );
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
      return <AdminDisputeInbox />;
    case 'settings':
      return <SettingsSection lang={lang} />;
    case 'audit':
      return <AuditLogsSection lang={lang} />;
  }
}
