import { useNavigate } from 'react-router';
import { Clock, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import type { ProviderProfileStatus } from '@homeservicemarketplace/contracts';
import { useLang } from '../../i18n/LanguageContext';
import { useAuth } from '../../../lib/auth-provider';

// Sprint 5.1.2 — non-ACTIVE provider state surface.
//
// Rendered by <ProviderApp> when the authenticated user has the
// `provider` role + a ProviderProfile but the profile is not yet ACTIVE
// (DRAFT, PENDING_REVIEW, SUSPENDED, REJECTED). The live shell (map +
// bids + wallet) is intentionally NOT mounted in these states so the
// user cannot accidentally bid before approval.
//
// In local/dev the upgrade flow stamps ACTIVE, so this surface only
// renders in production once admin moderation lands or after an admin
// suspends/rejects an account. The visual tokens reuse the Provider
// theme (blue/indigo/purple gradient hero) so the user stays in the
// same identity they signed up under.

interface CopyBlock {
  title: string;
  body: string;
  ctaLabel: string;
  // Whether the primary CTA should be enabled. DRAFT lets the user
  // re-enter the upgrade flow (defensive — should be unreachable in
  // practice because /upgrade is idempotent and would already have
  // promoted them to PENDING_REVIEW). The other states are pure
  // information surfaces; the CTA goes to /select.
  primaryCta: 'select' | 'upgrade';
  Icon: typeof Clock;
  // Tailwind classes for the icon halo. We stay inside the Provider
  // palette except for SUSPENDED/REJECTED, which use red so the
  // operator-applied lock state reads as "blocked, not pending".
  haloBg: string;
  haloText: string;
}

function copyFor(status: ProviderProfileStatus, lang: 'en' | 'ar'): CopyBlock {
  const en = (s: { title: string; body: string; ctaLabel: string }) => s;
  const ar = (s: { title: string; body: string; ctaLabel: string }) => s;
  switch (status) {
    case 'DRAFT': {
      const t =
        lang === 'ar'
          ? ar({
              title: 'أكمل بياناتك',
              body: 'ملفك جاهز ولكن يحتاج لاستكمال بعض البيانات قبل أن يصل لمرحلة المراجعة.',
              ctaLabel: 'إكمال الملف',
            })
          : en({
              title: 'Finish your provider profile',
              body: 'Your provider profile is created but missing details. Complete onboarding to submit it for review.',
              ctaLabel: 'Continue onboarding',
            });
      return {
        ...t,
        primaryCta: 'upgrade',
        Icon: ShieldCheck,
        haloBg: 'bg-blue-100',
        haloText: 'text-blue-700',
      };
    }
    case 'PENDING_REVIEW': {
      const t =
        lang === 'ar'
          ? ar({
              title: 'قيد المراجعة',
              body: 'تم استلام طلبك ويُراجع من قبل فريقنا. سنخبرك بمجرد تفعيل حسابك.',
              ctaLabel: 'العودة إلى التطبيقات',
            })
          : en({
              title: 'Pending review',
              body: 'Your provider application has been received and is being reviewed. We will notify you once your account is activated.',
              ctaLabel: 'Back to apps',
            });
      return {
        ...t,
        primaryCta: 'select',
        Icon: Clock,
        haloBg: 'bg-amber-100',
        haloText: 'text-amber-700',
      };
    }
    case 'SUSPENDED': {
      const t =
        lang === 'ar'
          ? ar({
              title: 'الحساب موقوف',
              body: 'تم إيقاف حسابك مؤقتاً. للاستفسار، تواصل مع الدعم عبر القنوات الرسمية.',
              ctaLabel: 'العودة إلى التطبيقات',
            })
          : en({
              title: 'Account suspended',
              body: 'Your provider account has been temporarily suspended. Please contact support through the official channels for details.',
              ctaLabel: 'Back to apps',
            });
      return {
        ...t,
        primaryCta: 'select',
        Icon: ShieldAlert,
        haloBg: 'bg-red-100',
        haloText: 'text-red-700',
      };
    }
    case 'REJECTED': {
      const t =
        lang === 'ar'
          ? ar({
              title: 'تم رفض الطلب',
              body: 'لم تتم الموافقة على طلب التسجيل كمزوّد خدمة. للاستفسار، تواصل مع الدعم.',
              ctaLabel: 'العودة إلى التطبيقات',
            })
          : en({
              title: 'Application not approved',
              body: 'Your provider application was not approved at this time. Please contact support for more information.',
              ctaLabel: 'Back to apps',
            });
      return {
        ...t,
        primaryCta: 'select',
        Icon: ShieldX,
        haloBg: 'bg-red-100',
        haloText: 'text-red-700',
      };
    }
    case 'ACTIVE':
    default: {
      // Should be unreachable — caller branches on status before
      // mounting this component. Defensive fallback so a future
      // status enum addition does not crash the render.
      const t =
        lang === 'ar'
          ? ar({
              title: 'الحساب نشط',
              body: 'يمكنك الآن استخدام التطبيق.',
              ctaLabel: 'فتح التطبيق',
            })
          : en({
              title: 'Account active',
              body: 'You can now use the Provider app.',
              ctaLabel: 'Open app',
            });
      return {
        ...t,
        primaryCta: 'select',
        Icon: ShieldCheck,
        haloBg: 'bg-green-100',
        haloText: 'text-green-700',
      };
    }
  }
}

export interface ProviderStatusStateProps {
  status: ProviderProfileStatus;
  // The Provider profile screen owns the upgrade mutation and its
  // pending state — when the caller's primary CTA is "upgrade", we
  // delegate to it via this prop. Optional because PENDING / SUSPENDED
  // / REJECTED do not invoke an upgrade.
  onContinueOnboarding?: () => void;
}

export function ProviderStatusState({ status, onContinueOnboarding }: ProviderStatusStateProps) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { lang, dir, darkMode } = useLang();
  const localized = lang === 'ar' ? 'ar' : 'en';
  const copy = copyFor(status, localized);
  const Icon = copy.Icon;

  const fontFamily = lang === 'ar' ? "'Cairo', 'Inter', sans-serif" : "'Inter', sans-serif";

  const handlePrimary = () => {
    if (copy.primaryCta === 'upgrade' && onContinueOnboarding) {
      onContinueOnboarding();
      return;
    }
    navigate('/select');
  };

  return (
    <div
      className={`flex flex-col items-center justify-center px-6 ${darkMode ? 'dark bg-slate-900' : 'bg-white'}`}
      style={{ minHeight: '100svh', fontFamily, direction: dir }}
      dir={dir}
      data-testid={`provider-status-${status.toLowerCase()}`}
    >
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-3xl px-6 py-7 mb-5 w-full max-w-sm relative overflow-hidden">
        <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
        <div className="relative flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-2xl ${copy.haloBg} flex items-center justify-center flex-shrink-0`}
          >
            <Icon size={24} className={copy.haloText} />
          </div>
          <div>
            <p className="text-white" style={{ fontSize: '18px', fontWeight: 800 }}>
              {copy.title}
            </p>
            <p className="text-white/75 mt-1.5" style={{ fontSize: '13px', lineHeight: '1.55' }}>
              {copy.body}
            </p>
          </div>
        </div>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-3">
        <button
          data-testid="provider-status-primary"
          onClick={handlePrimary}
          className="w-full py-3.5 rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-none active:scale-95 transition-all"
          style={{ fontSize: '14px', fontWeight: 800 }}
        >
          {copy.ctaLabel}
        </button>
        <button
          data-testid="provider-status-logout"
          onClick={async () => {
            try {
              await logout();
            } finally {
              navigate('/login', { replace: true, state: { app: 'provider' } });
            }
          }}
          className="w-full py-3.5 rounded-2xl border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition-all"
          style={{ fontSize: '14px', fontWeight: 700 }}
        >
          {lang === 'ar' ? 'تسجيل الخروج' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
