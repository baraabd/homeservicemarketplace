import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { AdminVerificationQueueQuery } from '@homeservicemarketplace/contracts';
import { useDirectoryLocation } from '../../admin-directory/hooks/useDirectoryLocation';
import './admin-identity-cases.css';
import { useLang } from '../../../i18n/LanguageContext';
import { AdminVerificationCaseWorkspace } from './AdminVerificationCaseWorkspace';

/** Specialist identity lifecycle. Application approval always lives in the full dossier. */
export function AdminIdentityCasesPage() {
  const { lang, dir } = useLang();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const caseId = params.get('case') || null;
  const directory = useDirectoryLocation();
  const filterKeys = ['search', 'state', 'policyVersion', 'submittedFrom', 'submittedTo'] as const;
  const filters = Object.fromEntries(
    filterKeys.flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value]] : [];
    }),
  ) as AdminVerificationQueueQuery;
  return (
    <div className="admin-review ar-stack" dir={dir}>
      <header className="ar-header">
        <div>
          <span className="ar-eyebrow">
            {lang === 'ar' ? 'مراجعة متخصصة' : 'Specialist review'}
          </span>
          <h2 className="ar-title">{lang === 'ar' ? 'قضايا الهوية' : 'Identity cases'}</h2>
          <p className="ar-muted">
            {lang === 'ar'
              ? 'تابع الوثائق وإعادة التوثيق ومنح العمل. راجع طلب التسجيل كاملًا قبل اعتماد المهني.'
              : 'Follow documents, reverification and work grants. Review the full application before approving a provider.'}
          </p>
        </div>
        <Link to="/admin/reviews" className="ar-button">
          {lang === 'ar' ? 'مراجعة طلبات التسجيل' : 'Review applications'}
        </Link>
      </header>
      <AdminVerificationCaseWorkspace
        key={caseId ?? 'queue'}
        selectedCaseId={caseId}
        queueLocationState={{
          filters,
          onFiltersChange: (next) =>
            directory.filter(Object.fromEntries(filterKeys.map((key) => [key, next[key]]))),
          pagination: {
            cursor: directory.cursor,
            hasPrevious: directory.hasPrevious,
            nextPage: directory.nextPage,
            previousPage: directory.previousPage,
            reset: () => undefined,
          },
        }}
        onSelectCase={(id) =>
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              if (id) next.set('case', id);
              else next.delete('case');
              return next;
            },
            { state: location.state },
          )
        }
        onOpenProvider={(id) =>
          navigate(
            `/admin/providers/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(location.pathname + location.search)}`,
            { state: location.state },
          )
        }
      />
    </div>
  );
}
