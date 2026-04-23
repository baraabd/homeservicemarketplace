import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes } from 'react-router';
import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { LoginPage, SignUpPage } from '../../pages/AuthPages';

// End-to-end-ish coverage of the combined email-OTP + session flow.
// Mocks the HTTP boundary only — every hook, reducer, router guard, and
// React Query observer is real. Each test clicks through the UI and
// asserts the network contract plus the final rendered state.

let mock: MockAdapter;

function typeInto(el: HTMLInputElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

function renderAuth(path: '/login' | '/signup') {
  return render(
    <AuthProvider>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/home" element={<div data-testid="home-ok">home</div>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  mock = new MockAdapter(api);
  queryClient.clear();
});

afterEach(() => {
  mock.restore();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

const OTP_CHALLENGE = {
  otpRequired: true,
  challengeId: 'chal-login-xyz',
  codeLength: 6,
  expiresInSeconds: 300,
};

async function submitLoginCredentials() {
  // Login form puts the email + password fields and the submit button on
  // screen after /me resolves. The TextField renders native <input>s.
  const email = document.querySelector('input[type="email"]') as HTMLInputElement;
  const password = document.querySelector('input[type="password"]') as HTMLInputElement;
  await act(async () => {
    typeInto(email, 'ada@example.com');
    typeInto(password, 'a-reasonable-passphrase');
  });
  const loginBtn = screen
    .getAllByRole('button')
    .find((b) => /log ?in|sign ?in/i.test(b.textContent ?? ''))!;
  await act(async () => {
    loginBtn.click();
  });
}

async function enterOtp(code: string) {
  await waitFor(() => {
    expect(screen.getByTestId('otp-input')).toBeInTheDocument();
  });
  const input = screen.getByTestId('otp-input') as HTMLInputElement;
  await act(async () => {
    typeInto(input, code);
  });
  const confirmBtn = screen
    .getAllByRole('button')
    .find((b) => /confirm|verifying/i.test(b.textContent ?? ''))!;
  await act(async () => {
    confirmBtn.click();
  });
}

describe('Login → OTP → authenticated', () => {
  it('valid credentials reveal the OTP panel; no session before OTP success', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/login').reply(200, OTP_CHALLENGE);

    renderAuth('/login');
    await submitLoginCredentials();

    // OTP boxes replace the credentials form.
    await waitFor(() => expect(screen.getByTestId('otp-box-0')).toBeInTheDocument());
    // Session endpoint has NOT been called yet — otp was not submitted.
    expect(mock.history.post.filter((r) => r.url === '/v1/auth/verify-otp')).toHaveLength(0);
    expect(screen.queryByTestId('home-ok')).toBeNull();
  });

  it('tapping the visual OTP boxes focuses the (sr-only) input so mobile keyboards appear', async () => {
    // Regression: before the fix, the 6 boxes were plain <div>s with no
    // click handler and the real <input> was sr-only. Users could not tap
    // the boxes to bring up the numeric keyboard on mobile. The fix wires
    // an onClick on the boxes' container that calls input.focus().
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/login').reply(200, OTP_CHALLENGE);

    renderAuth('/login');
    await submitLoginCredentials();
    await waitFor(() => expect(screen.getByTestId('otp-input')).toBeInTheDocument());

    const input = screen.getByTestId('otp-input') as HTMLInputElement;
    const box3 = screen.getByTestId('otp-box-3');

    // Move focus off the input so we can observe the re-focus from a box tap.
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    expect(document.activeElement).not.toBe(input);

    // Tap box 3 — the container's onClick must route focus back to the input.
    await act(async () => {
      box3.click();
    });
    expect(document.activeElement).toBe(input);

    // Typing now types into the real input (proves the focus is functional,
    // not just asserting activeElement).
    await act(async () => {
      fireEvent.change(input, { target: { value: '123456' } });
    });
    expect(input.value).toBe('123456');
  });

  it('correct OTP → POST /verify-otp → /me resolves → home rendered', async () => {
    let meCalls = 0;
    mock.onGet('/v1/auth/me').reply(() => {
      meCalls++;
      if (meCalls === 1) return [401, {}];
      return [
        200,
        {
          id: 'u1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'L',
          status: 'ACTIVE',
          emailVerifiedAt: '2026-04-20T00:00:00.000Z',
          mfaEnabled: false,
          roles: ['customer'],
        },
      ];
    });
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/login').reply(200, OTP_CHALLENGE);
    mock.onPost('/v1/auth/verify-otp').reply(200, {});

    renderAuth('/login');
    await submitLoginCredentials();
    await enterOtp('123456');

    await waitFor(() => expect(screen.getByTestId('home-ok')).toBeInTheDocument(), {
      timeout: 3000,
    });

    const post = mock.history.post.find((r) => r.url === '/v1/auth/verify-otp');
    expect(post).toBeDefined();
    expect(JSON.parse(post!.data)).toEqual({ challengeId: 'chal-login-xyz', code: '123456' });
  });

  it('wrong OTP → renders "Incorrect code" without revealing the home page', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/login').reply(200, OTP_CHALLENGE);
    mock.onPost('/v1/auth/verify-otp').reply(400, {
      error: { code: 'AUTH_OTP_INVALID', message: 'Invalid code' },
    });

    renderAuth('/login');
    await submitLoginCredentials();
    await enterOtp('000000');

    await waitFor(() => expect(screen.getByText(/Incorrect code/i)).toBeInTheDocument());
    expect(screen.queryByTestId('home-ok')).toBeNull();
  });

  it('resend triggers POST /resend-otp and surfaces a notice', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/login').reply(200, OTP_CHALLENGE);
    mock.onPost('/v1/auth/resend-otp').reply(202, { success: true, expiresInSeconds: 300 });

    renderAuth('/login');
    await submitLoginCredentials();
    await waitFor(() => expect(screen.getByTestId('otp-input')).toBeInTheDocument());

    const resendBtn = screen.getByText(/Resend code/i);
    await act(async () => {
      resendBtn.click();
    });

    await waitFor(() => {
      const posts = mock.history.post.filter((r) => r.url === '/v1/auth/resend-otp');
      expect(posts).toHaveLength(1);
      expect(JSON.parse(posts[0]!.data)).toEqual({ challengeId: 'chal-login-xyz' });
    });
    await waitFor(() => expect(screen.getByText(/A new code has been sent/i)).toBeInTheDocument());
  });
});

describe('Register → OTP → authenticated', () => {
  it('submits credentials, receives challenge, verifies OTP, lands on /home', async () => {
    let meCalls = 0;
    mock.onGet('/v1/auth/me').reply(() => {
      meCalls++;
      if (meCalls === 1) return [401, {}];
      return [
        200,
        {
          id: 'u2',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'L',
          status: 'ACTIVE',
          emailVerifiedAt: '2026-04-20T00:00:00.000Z',
          mfaEnabled: false,
          roles: ['customer'],
        },
      ];
    });
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/register').reply(202, {
      otpRequired: true,
      challengeId: 'chal-reg-42',
      codeLength: 6,
      expiresInSeconds: 300,
    });
    mock.onPost('/v1/auth/verify-otp').reply(200, {});

    renderAuth('/signup');

    // Step 1: name + phone (dial code is preselected from geo fallback).
    await waitFor(() => {
      expect(document.querySelector('input[type="tel"]')).toBeTruthy();
    });
    const name = document.querySelectorAll('input')[0] as HTMLInputElement;
    const phone = document.querySelector('input[type="tel"]') as HTMLInputElement;
    await act(async () => {
      typeInto(name, 'Ada Lovelace');
      typeInto(phone, '5551234567');
    });
    const nextBtn = screen.getAllByRole('button').find((b) => /next/i.test(b.textContent ?? ''))!;
    await act(async () => {
      nextBtn.click();
    });

    // Step 2: email + password + terms.
    await waitFor(() => {
      expect(document.querySelector('input[type="email"]')).toBeTruthy();
    });
    const email = document.querySelector('input[type="email"]') as HTMLInputElement;
    const password = document.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      typeInto(email, 'ada@example.com');
      typeInto(password, 'a-reasonable-passphrase');
    });
    // Click the terms checkbox (label button contains the text).
    const termsBtn = screen
      .getAllByRole('button')
      .find((b) => /privacyPolicy|agreeTerms|I agree/i.test(b.textContent ?? ''));
    if (termsBtn) {
      await act(async () => {
        termsBtn.click();
      });
    }
    const registerBtn = screen
      .getAllByRole('button')
      .find((b) => /register|create/i.test(b.textContent ?? ''))!;
    await act(async () => {
      registerBtn.click();
    });

    // Step 3: OTP panel — same component as Login, different challenge.
    await enterOtp('654321');

    await waitFor(() => expect(screen.getByTestId('home-ok')).toBeInTheDocument(), {
      timeout: 3000,
    });

    const post = mock.history.post.find((r) => r.url === '/v1/auth/verify-otp');
    expect(post).toBeDefined();
    expect(JSON.parse(post!.data)).toEqual({ challengeId: 'chal-reg-42', code: '654321' });
  });
});
