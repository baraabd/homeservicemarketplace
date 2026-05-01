import { useNavigate } from 'react-router';
import { ShieldAlert, ArrowLeft, LogOut } from 'lucide-react';
import { useAuth } from '../../../lib/auth-provider';

// Sprint 5.1.1 patch 2.
//
// Surface shown when an authenticated user without the `admin` role
// hits /admin. The dashboard itself is never rendered — that's the
// point of the route guard. We deliberately do NOT silently redirect
// to /home: a user who explicitly clicked the Admin card on /select
// deserves a clear "this needs admin permission" message rather than
// landing somewhere unexpected.
//
// Visual identity matches the slate palette the AdminDashboard uses,
// so the screen reads as part of the Admin experience even though the
// user can't enter it. No design drift — same gradient, same card
// shape, same typography tokens.
export function AdminAccessRequired() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-md w-full p-8 text-center">
        <div className="flex justify-center mb-6">
          <div
            className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 flex items-center justify-center shadow-md"
            data-testid="admin-access-required-icon"
          >
            <ShieldAlert size={36} className="text-white" />
          </div>
        </div>
        <h1
          className="text-slate-900 dark:text-white mb-2"
          style={{ fontSize: '24px', fontWeight: 800 }}
        >
          Admin access required
        </h1>
        <p
          className="text-slate-500 dark:text-slate-400 mb-6"
          style={{ fontSize: '14px', lineHeight: '1.6' }}
        >
          {user?.email
            ? `${user.email} is signed in but does not have admin permissions for this dashboard.`
            : 'Your account does not have admin permissions for this dashboard.'}{' '}
          Switch to a different account or pick another app.
        </p>
        <div className="flex flex-col gap-3">
          <button
            data-testid="admin-access-required-back"
            onClick={() => navigate('/select')}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-700 text-white shadow-md shadow-slate-300 hover:bg-slate-800 active:scale-95 transition-all"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            <ArrowLeft size={16} />
            Back to apps
          </button>
          <button
            data-testid="admin-access-required-logout"
            onClick={async () => {
              try {
                await logout();
              } finally {
                navigate('/login', { replace: true, state: { app: 'admin' } });
              }
            }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-slate-300 text-slate-700 hover:bg-slate-50 active:scale-95 transition-all"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            <LogOut size={16} />
            Sign in as a different user
          </button>
        </div>
      </div>
    </div>
  );
}
