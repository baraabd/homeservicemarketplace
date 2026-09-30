import { useAuth } from '../../../lib/auth-provider';
import { useLang } from '../../i18n/LanguageContext';

/** A failed HTTP logout cannot honestly be presented as server revocation. */
export function AuthSessionNotice() {
  const { logoutState, logout } = useAuth();
  const { lang } = useLang();
  if (logoutState !== 'pending' && logoutState !== 'unconfirmed') return null;
  return (
    <section role="status" className="bg-amber-50 text-amber-950 border-b border-amber-200 px-4 py-3 text-sm" data-testid="auth-logout-notice">
      <p>{lang === 'ar'
        ? (logoutState === 'pending' ? 'تم إخفاء بياناتك على هذا الجهاز. جارٍ طلب إنهاء جلسة الخادم…' : 'تم تسجيل الخروج محلياً، لكن الخادم لم يؤكد إنهاء الجلسة. أعد المحاولة عند عودة الاتصال.')
        : (logoutState === 'pending' ? 'Your local data is hidden. Requesting server sign-out…' : 'Signed out locally. Server sign-out is not confirmed. Retry when the connection is available.')}</p>
      <button type="button" className="underline mt-2 disabled:opacity-50" disabled={logoutState === 'pending'} onClick={() => { void logout(); }}>
        {lang === 'ar' ? 'إعادة محاولة إنهاء الجلسة' : 'Retry server sign-out'}
      </button>
    </section>
  );
}
