import { useNavigate } from 'react-router';
import { LoginScreen, SignUpScreen, ForgotPasswordScreen } from '../components/auth/AuthScreens';

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Mark the session as authenticated and store it in localStorage */
function setAuthed() {
  localStorage.setItem('fixnow_authed', 'true');
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN PAGE  /login
// ─────────────────────────────────────────────────────────────────────────────
export function LoginPage() {
  const navigate = useNavigate();

  return (
    <LoginScreen
      onLogin={() => {
        setAuthed();
        navigate('/home');
      }}
      onSignUp={() => navigate('/signup')}
      onForgotPassword={() => navigate('/forgot-password')}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN-UP PAGE  /signup
// ─────────────────────────────────────────────────────────────────────────────
export function SignUpPage() {
  const navigate = useNavigate();

  return (
    <SignUpScreen
      onBack={() => navigate('/login')}
      onSuccess={() => {
        setAuthed();
        navigate('/home');
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
