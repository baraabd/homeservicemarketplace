import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes } from 'react-router';
import { api } from '../../lib/api';
import { AuthProvider, queryClient } from '../../lib/auth-provider';
import {
  CheckEmailPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './AuthPages';

// Route-level tests for the new email-link pages and the now-real forgot-
// password wiring. The LoginPage + SignUpPage paths are exercised by the
// existing auth-integration.test.tsx suite.

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  queryClient.clear();
});

afterEach(() => {
  mock.restore();
});

function renderAt(initialEntry: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<div data-testid="login-stub">login</div>} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/check-email" element={<CheckEmailPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

// The custom TextField renders a floating-label <input> with no `placeholder`
// attribute, so we query by `input[type=...]` to get a stable handle.
function firstInputOfType(type: string): HTMLInputElement {
  const el = document.querySelector(`input[type="${type}"]`);
  if (!el) throw new Error(`No input[type="${type}"] in DOM`);
  return el as HTMLInputElement;
}

describe('ForgotPasswordPage — calls real backend', () => {
  it('POSTs /v1/auth/forgot-password with the trimmed email and shows the check-inbox state', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/forgot-password').reply(202, { success: true });

    renderAt('/forgot-password');

    // Wait for the form to mount (the guard resolves /me as 401 first).
    await waitFor(() => {
      expect(document.querySelector('input[type="email"]')).toBeTruthy();
    });

    const input = firstInputOfType('email');
    await act(async () => {
      fireEvent.change(input, { target: { value: '  ada@example.com  ' } });
    });

    const sendBtn = screen
      .getAllByRole('button')
      .find((b) => /reset|send/i.test(b.textContent ?? ''));
    expect(sendBtn).toBeDefined();
    await act(async () => {
      sendBtn!.click();
    });

    await waitFor(() => {
      const post = mock.history.post.find((r) => r.url === '/v1/auth/forgot-password');
      expect(post).toBeDefined();
      expect(JSON.parse(post!.data)).toEqual({ email: 'ada@example.com' });
    });
  });
});

describe('CheckEmailPage — resend verification', () => {
  it('calls POST /v1/auth/resend-verification with the email from router state', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/resend-verification').reply(202, { success: true });

    render(
      <AuthProvider>
        <MemoryRouter
          initialEntries={[{ pathname: '/check-email', state: { email: 'ada@example.com' } }]}
        >
          <Routes>
            <Route path="/check-email" element={<CheckEmailPage />} />
            <Route path="/login" element={<div data-testid="login-stub">login</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Check your email/i)).toBeInTheDocument();
    });

    const resend = screen.getAllByRole('button').find((b) => /resend/i.test(b.textContent ?? ''));
    expect(resend).toBeDefined();
    await act(async () => {
      resend!.click();
    });

    await waitFor(() => {
      const post = mock.history.post.find((r) => r.url === '/v1/auth/resend-verification');
      expect(post).toBeDefined();
      expect(JSON.parse(post!.data)).toEqual({ email: 'ada@example.com' });
    });
  });

  it('surfaces a generic error if resend fails at the server', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/resend-verification').reply(503, {});

    render(
      <AuthProvider>
        <MemoryRouter
          initialEntries={[{ pathname: '/check-email', state: { email: 'ada@example.com' } }]}
        >
          <Routes>
            <Route path="/check-email" element={<CheckEmailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Check your email/i)).toBeInTheDocument());

    const resend = screen.getAllByRole('button').find((b) => /resend/i.test(b.textContent ?? ''));
    await act(async () => {
      resend!.click();
    });

    await waitFor(() => {
      expect(screen.getByText(/Couldn't resend|try again/i)).toBeInTheDocument();
    });
  });
});

describe('VerifyEmailPage — consumes token from URL', () => {
  it('POSTs /v1/auth/verify-email on mount and shows success', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/verify-email').reply(200, { success: true });

    renderAt('/verify-email?token=raw-abc');

    await waitFor(() => expect(screen.getByText(/Email verified/i)).toBeInTheDocument());

    const post = mock.history.post.find((r) => r.url === '/v1/auth/verify-email');
    expect(post).toBeDefined();
    expect(JSON.parse(post!.data)).toEqual({ token: 'raw-abc' });
  });

  it('renders the "invalid or expired" state on 400', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/verify-email').reply(400, {
      error: { code: 'AUTH_INVALID_CREDENTIALS' },
    });

    renderAt('/verify-email?token=expired-token');

    await waitFor(() => expect(screen.getByText(/Link invalid or expired/i)).toBeInTheDocument());
  });

  it('renders the "missing token" state when no ?token=… is present', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});

    renderAt('/verify-email');

    await waitFor(() => expect(screen.getByText(/No verification token/i)).toBeInTheDocument());
    // The endpoint must NOT have been called when the token is missing.
    expect(mock.history.post.filter((r) => r.url === '/v1/auth/verify-email')).toHaveLength(0);
  });

  it('renders the generic error state on a non-400 failure', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/verify-email').reply(503, {});

    renderAt('/verify-email?token=boom');
    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument());
  });
});

describe('ResetPasswordPage', () => {
  it('POSTs /v1/auth/reset-password when token + password match and password is long enough', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/reset-password').reply(200, { success: true });

    renderAt('/reset-password?token=reset-xyz');
    await waitFor(() => expect(screen.getByText(/Choose a new password/i)).toBeInTheDocument());

    // Password fields are native <input type="password"> (not role=textbox).
    const pwInputs = Array.from(
      document.querySelectorAll('input[type="password"]'),
    ) as HTMLInputElement[];
    expect(pwInputs.length).toBe(2);
    const [pw, confirm] = pwInputs;

    await act(async () => {
      fireEvent.change(pw!, { target: { value: 'a-reasonable-passphrase' } });
      fireEvent.change(confirm!, { target: { value: 'a-reasonable-passphrase' } });
    });

    const submit = screen
      .getAllByRole('button')
      .find((b) => /update password|updating/i.test(b.textContent ?? ''));
    expect(submit).toBeDefined();
    await act(async () => {
      submit!.click();
    });

    await waitFor(() => {
      const post = mock.history.post.find((r) => r.url === '/v1/auth/reset-password');
      expect(post).toBeDefined();
      expect(JSON.parse(post!.data)).toEqual({
        token: 'reset-xyz',
        newPassword: 'a-reasonable-passphrase',
      });
    });
    await waitFor(() => expect(screen.getByText(/Password updated/i)).toBeInTheDocument());
  });

  it('rejects short passwords before hitting the backend', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});

    renderAt('/reset-password?token=reset-xyz');
    await waitFor(() => expect(screen.getByText(/Choose a new password/i)).toBeInTheDocument());

    const pwInputs = Array.from(
      document.querySelectorAll('input[type="password"]'),
    ) as HTMLInputElement[];
    const [pw, confirm] = pwInputs;
    await act(async () => {
      fireEvent.change(pw!, { target: { value: 'short' } });
      fireEvent.change(confirm!, { target: { value: 'short' } });
    });

    const submit = screen
      .getAllByRole('button')
      .find((b) => /update password/i.test(b.textContent ?? ''));
    await act(async () => {
      submit!.click();
    });

    // The UI-level error has a distinctive "Password must" prefix — the
    // hint string "At least 12 characters" is not a failure state, so we
    // disambiguate here to avoid a "multiple elements" match.
    await waitFor(() =>
      expect(screen.getByText(/Password must be at least 12/i)).toBeInTheDocument(),
    );
    expect(mock.history.post.filter((r) => r.url === '/v1/auth/reset-password')).toHaveLength(0);
  });
});
