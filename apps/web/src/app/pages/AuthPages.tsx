import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth-provider';
import { LoginScreen, SignUpScreen, ForgotPasswordScreen } from '../components/auth/AuthScreens';

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN PAGE  /login
// ─────────────────────────────────────────────────────────────────────────────
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const state = location.state as { registered?: boolean; returnTo?: string } | null;
  const justRegistered = state?.registered;
  // Guard against open-redirect: only honor in-app paths. Reject absolute URLs
  // and protocol-relative values; reject /login itself (would loop).
  const rawReturnTo = state?.returnTo;
  const returnTo =
    rawReturnTo &&
    rawReturnTo.startsWith('/') &&
    !rawReturnTo.startsWith('//') &&
    rawReturnTo !== '/login'
      ? rawReturnTo
      : '/home';

  return (
    <LoginScreen
      onLogin={async (email: string, password: string) => {
        await login({ email, password });
        navigate(returnTo, { replace: true });
      }}
      onSignUp={() => navigate('/signup')}
      onForgotPassword={() => navigate('/forgot-password')}
      banner={justRegistered ? 'Check your email to verify your account, then sign in.' : undefined}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN-UP PAGE  /signup
// ─────────────────────────────────────────────────────────────────────────────
export function SignUpPage() {
  const navigate = useNavigate();
  const { register: doRegister } = useAuth();

  return (
    <SignUpScreen
      onBack={() => navigate('/login')}
      onSuccess={async (data: { name: string; email: string; password: string }) => {
        const [firstName, ...rest] = data.name.trim().split(' ');
        const lastName = rest.join(' ') || firstName;
        await doRegister({
          email: data.email,
          password: data.password,
          firstName,
          lastName,
        });
        // Register returns 202 for anti-enumeration — do NOT auto-login.
        navigate('/login', { state: { registered: true } });
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT-PASSWORD PAGE  /forgot-password
// ─────────────────────────────────────────────────────────────────────────────
export function ForgotPasswordPage() {
  const navigate = useNavigate();

  return <ForgotPasswordScreen onBack={() => navigate('/login')} />;
}
