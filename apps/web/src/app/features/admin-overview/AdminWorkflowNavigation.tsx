import { Link } from 'react-router';
import { ClipboardCheck, Users } from 'lucide-react';
import type { ReviewLanguage } from '../admin-provider-review/copy';
import { ADMIN_OVERVIEW_COPY } from './copy';
import './admin-overview.css';

/** Mobile reviewers must not need to discover the drawer to find approvals. */
export function AdminWorkflowNavigation({ lang, section }: { lang: ReviewLanguage; section?: string }) {
  const t = ADMIN_OVERVIEW_COPY[lang];
  return (
    <nav className="admin-review ao-quick-nav" aria-label={t.navigation}>
      <Link className="ar-button" data-testid="quick-nav-reviews" aria-current={section === 'reviews' ? 'page' : undefined} to="/admin/reviews"><ClipboardCheck size={18} aria-hidden="true" />{t.openQueue}</Link>
      <Link className="ar-button" data-testid="quick-nav-providers" aria-current={section === 'providers' ? 'page' : undefined} to="/admin/providers"><Users size={18} aria-hidden="true" />{t.directory}</Link>
    </nav>
  );
}
