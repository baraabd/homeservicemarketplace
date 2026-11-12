import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { SIGNUP_CONSENT_COPY } from '../../features/legal/signup-consent';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { CheckEmailPage, LoginPage, SignUpPage } from '../../pages/AuthPages';

// End-to-end-ish coverage of the combined email-OTP + session flow.
// Mocks the HTTP boundary only — every hook, reducer, router guard, and
// React Query observer is real. Each test clicks through the UI and
// asserts the network contract plus the final rendered state.

let mock: MockAdapter;
let qc: QueryClient;

function typeInto(el: HTMLInputElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

function renderAuth(path: '/login' | '/signup', app?: 'seeker' | 'provider' | 'admin') {
  return render(
    <AuthProvider client={qc}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[app ? { pathname: path, state: { app } } : path]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route
              path="/check-email"
              element={
                <div data-testid="check-email-page">
                  <CheckEmailPage />
                </div>
              }
            />
            <Route path="/forgot-password" element={<div data-testid="forgot-password-page" />} />
            <Route path="/home" element={<div data-testid="home-ok">home</div>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
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

async function submitLoginCredentials(emailValue = 'ada@example.com') {
  // Login form puts the email + password fields and the submit button on
  // screen after /me resolves. The TextField renders native <input>s.
  const email = document.querySelector('input[type="email"]') as HTMLInputElement;
  const password = document.querySelector('input[type="password"]') as HTMLInputElement;
  await act(async () => {
    typeInto(email, emailValue);
    typeInto(password, 'a-reasonable-passphrase');
  });
  const loginBtn = screen
    .getAllByRole('button')
    .find((b) => /^(log ?in|sign ?in|دخول)$/i.test(b.textContent ?? ''))!;
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

  it('login 401 with leaky "Unauthorized Exception" message → UI renders friendly copy, never the raw server text', async () => {
    // Regression: the real server used to emit this exact payload because
    // NestJS auto-derived HttpException.message from the class name when
    // IAM threw with only `{ code }`. Users saw "Unauthorized Exception" on
    // the login form. The UI now maps from the stable code and ignores
    // response.data.error.message entirely.
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/login').reply(401, {
      success: false,
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Unauthorized Exception' },
    });

    renderAuth('/login');
    await submitLoginCredentials();

    // The raw framework text MUST NOT appear.
    await waitFor(() => expect(mock.history.post.length).toBeGreaterThan(0));
    expect(screen.queryByText(/Unauthorized Exception/i)).toBeNull();
    expect(screen.queryByText(/Exception$/)).toBeNull();
    // A friendly message takes its place.
    expect(screen.getByText(/incorrect email or password/i)).toBeInTheDocument();
  });

  it('login 401 AUTH_ACCOUNT_LOCKED — UI prompts the user to wait or reset (covers post-lockout path)', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/login').reply(401, {
      success: false,
      error: { code: 'AUTH_ACCOUNT_LOCKED', message: 'Unauthorized Exception' },
    });

    renderAuth('/login');
    await submitLoginCredentials();

    await waitFor(() => expect(screen.getByText(/locked/i)).toBeInTheDocument());
    expect(screen.queryByText(/Unauthorized Exception/i)).toBeNull();
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
    // Acknowledgement is not proof of external mailbox delivery. Preserve the
    // non-enumerating request notice and the exact resend endpoint assertions.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Request received. Check your inbox and use the most recent code.',
      ),
    );
  });
});

describe.each(['en', 'ar'] as const)('Login verification recovery (%s)', (lang) => {
  const recoveryLabel = lang === 'ar' ? 'طلب رابط للتحقق من البريد' : 'Request email verification';
  const loginLabel = lang === 'ar' ? 'دخول' : 'Log In';

  beforeEach(() => {
    localStorage.setItem('hsm.lang', lang);
    mock.onGet('/v1/auth/me').reply(401, {});
  });

  it.each(['seeker', 'provider', 'admin'] as const)(
    '%s opens verification recovery only after the server reports an unverified account',
    async (app) => {
      mock.onPost('/v1/auth/login').reply(403, {
        error: { code: 'AUTH_ACCOUNT_UNVERIFIED', message: 'synthetic-private-server-detail' },
      });
      renderAuth('/login', app);
      expect(screen.queryByRole('button', { name: recoveryLabel })).toBeNull();

      await submitLoginCredentials('  ada@example.com  ');
      fireEvent.click(await screen.findByRole('button', { name: recoveryLabel }));

      await screen.findByTestId('check-email-page');
      expect(screen.getByTestId(`auth-page-${app}`)).toBeInTheDocument();
      expect(document.querySelector('input[type="email"]')).toHaveValue('ada@example.com');
      expect(screen.queryByText('synthetic-private-server-detail')).toBeNull();
      // Navigation prepares recovery; only the explicit resend action sends mail.
      expect(mock.history.post.map((request) => request.url)).toEqual(['/v1/auth/login']);
    },
  );

  it.each([
    [
      'wrong credentials',
      401,
      'AUTH_INVALID_CREDENTIALS',
      'Incorrect email or password.',
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    ],
    [
      'locked account',
      401,
      'AUTH_ACCOUNT_LOCKED',
      'Account temporarily locked due to too many failed attempts. Try again later or reset your password.',
      'تم قفل الحساب مؤقتًا لكثرة المحاولات غير الناجحة. حاول لاحقًا أو أعد تعيين كلمة المرور.',
    ],
    [
      'suspended account',
      403,
      'AUTH_ACCOUNT_SUSPENDED',
      'This account has been suspended. Contact support.',
      'تم تعليق هذا الحساب. تواصل مع الدعم.',
    ],
    [
      'rate limit',
      429,
      'RATE_LIMITED',
      'Too many attempts. Please wait a moment and try again.',
      'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.',
    ],
    [
      'validation',
      400,
      'VALIDATION_ERROR',
      'Please check your email and password and try again.',
      'تحقق من البريد الإلكتروني وكلمة المرور ثم حاول مجددًا.',
    ],
    [
      'server unavailable',
      503,
      'DEPENDENCY_UNAVAILABLE',
      "We couldn't reach the server. Please try again.",
      'تعذّر الاتصال بالخادم. حاول مجددًا.',
    ],
    [
      'network failure',
      null,
      null,
      "Couldn't sign in. Please try again.",
      'تعذّر تسجيل الدخول. حاول مجددًا.',
    ],
    [
      'unrecognized refusal',
      403,
      'UNRECOGNIZED',
      'Incorrect email or password.',
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    ],
  ] as const)(
    '%s does not suggest email verification and preserves password recovery',
    async (_label, status, code, message, arabicMessage) => {
      if (status === null) mock.onPost('/v1/auth/login').networkError();
      else {
        mock.onPost('/v1/auth/login').reply(status, {
          error: { code, message: 'synthetic-private-server-detail' },
        });
      }
      renderAuth('/login');
      await submitLoginCredentials();

      expect(await screen.findByText(lang === 'ar' ? arabicMessage : message)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: recoveryLabel })).toBeNull();
      expect(screen.queryByText('synthetic-private-server-detail')).toBeNull();
      expect(screen.queryByTestId('otp-input')).toBeNull();
      fireEvent.click(
        screen.getByRole('button', {
          name: lang === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot Password?',
        }),
      );
      await screen.findByTestId('forgot-password-page');
    },
  );

  it.each(['email', 'password'] as const)(
    '%s edits clear the previous verification action',
    async (field) => {
      mock.onPost('/v1/auth/login').reply(403, { error: { code: 'AUTH_ACCOUNT_UNVERIFIED' } });
      renderAuth('/login');
      await submitLoginCredentials();
      await screen.findByRole('button', { name: recoveryLabel });

      const input = document.querySelector(`input[type="${field}"]`) as HTMLInputElement;
      const previous = input.value;
      fireEvent.change(input, {
        target: { value: field === 'email' ? 'other@example.com' : 'changed-passphrase' },
      });
      expect(screen.queryByRole('button', { name: recoveryLabel })).toBeNull();
      expect(screen.queryByText('Please verify your email before signing in.')).toBeNull();
      fireEvent.change(input, { target: { value: previous } });
      expect(screen.queryByRole('button', { name: recoveryLabel })).toBeNull();
    },
  );

  it('clears recovery while retrying, entering OTP, and returning to credentials', async () => {
    mock.onPost('/v1/auth/login').replyOnce(403, { error: { code: 'AUTH_ACCOUNT_UNVERIFIED' } });
    let finish!: (reply: [number, unknown]) => void;
    const pending = new Promise<[number, unknown]>((resolve) => {
      finish = resolve;
    });
    mock.onPost('/v1/auth/login').reply(() => pending);
    renderAuth('/login');
    await submitLoginCredentials();
    await screen.findByRole('button', { name: recoveryLabel });

    fireEvent.click(screen.getByRole('button', { name: loginLabel }));
    expect(screen.queryByRole('button', { name: recoveryLabel })).toBeNull();
    await waitFor(() => expect(mock.history.post).toHaveLength(2));
    await act(async () => {
      finish([200, OTP_CHALLENGE]);
    });
    await screen.findByTestId('otp-input');
    expect(screen.queryByRole('button', { name: recoveryLabel })).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: lang === 'ar' ? 'بدء تسجيل الدخول مجدداً' : 'Start sign-in again',
      }),
    );
    expect(document.querySelector('input[type="password"]')).toHaveValue('');
    expect(document.querySelector('input[type="email"]')).toHaveValue('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: loginLabel }));
    expect(screen.queryByRole('button', { name: recoveryLabel })).toBeNull();
    expect(mock.history.post).toHaveLength(2);
  });

  it.each([403, 200])(
    'ignores an earlier %s reply after editing credentials and allows a fresh attempt',
    async (status) => {
      let finish!: (reply: [number, unknown]) => void;
      const pending = new Promise<[number, unknown]>((resolve) => {
        finish = resolve;
      });
      mock.onPost('/v1/auth/login').replyOnce(() => pending);
      mock.onPost('/v1/auth/login').reply(200, OTP_CHALLENGE);
      renderAuth('/login');
      await submitLoginCredentials();
      await waitFor(() => expect(mock.history.post).toHaveLength(1));
      fireEvent.change(document.querySelector('input[type="email"]')!, {
        target: { value: 'other@example.com' },
      });

      await act(async () => {
        finish([
          status,
          status === 200 ? OTP_CHALLENGE : { error: { code: 'AUTH_ACCOUNT_UNVERIFIED' } },
        ]);
      });
      expect(screen.queryByRole('button', { name: recoveryLabel })).toBeNull();
      expect(screen.queryByText('Please verify your email before signing in.')).toBeNull();
      expect(screen.queryByTestId('otp-input')).toBeNull();
      expect(screen.getByRole('button', { name: loginLabel })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: loginLabel }));
      await screen.findByTestId('otp-input');
      expect(mock.history.post).toHaveLength(2);
      expect(JSON.parse(mock.history.post[1]!.data).email).toBe('other@example.com');
    },
  );
});

it('switches the verification action language without losing the entered credentials', async () => {
  mock.onGet('/v1/auth/me').reply(401, {});
  mock.onPost('/v1/auth/login').reply(403, { error: { code: 'AUTH_ACCOUNT_UNVERIFIED' } });
  renderAuth('/login');
  await submitLoginCredentials();
  await screen.findByRole('button', { name: 'Request email verification' });

  fireEvent.click(screen.getByTestId('lang-toggle'));
  expect(screen.getByRole('button', { name: 'طلب رابط للتحقق من البريد' })).toBeInTheDocument();
  expect(screen.getByText('يرجى التحقق من بريدك الإلكتروني قبل تسجيل الدخول.')).toBeVisible();
  expect(screen.queryByText('Please verify your email before signing in.')).toBeNull();
  expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  expect(document.querySelector('input[type="email"]')).toHaveValue('ada@example.com');
  expect(document.querySelector('input[type="password"]')).toHaveValue('a-reasonable-passphrase');
  expect(mock.history.post).toHaveLength(1);

  fireEvent.click(screen.getByTestId('lang-toggle'));
  expect(screen.getByText('Please verify your email before signing in.')).toBeVisible();
  expect(mock.history.post).toHaveLength(1);
});

it.each(['seeker', 'provider', 'admin'] as const)(
  '%s sends the same credential request exactly once and does not refresh a login refusal',
  async (app) => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/login').reply(401, { error: { code: 'AUTH_INVALID_CREDENTIALS' } });
    mock.onPost('/v1/auth/refresh').reply(200, {});
    renderAuth('/login', app);
    await waitFor(() => expect(qc.getQueryData(['auth', 'me'])).toBeNull());
    document.cookie = 'hsm_csrf=synthetic-csrf';
    mock.resetHistory();

    await submitLoginCredentials('  ada@example.com  ');
    await screen.findByText('Incorrect email or password.');
    expect(screen.getByTestId(`auth-hero-${app}`)).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(1);
    const request = mock.history.post[0]!;
    expect(request.url).toBe('/v1/auth/login');
    expect(request.baseURL).toBe(api.defaults.baseURL);
    expect(JSON.parse(request.data)).toEqual({
      email: 'ada@example.com',
      password: 'a-reasonable-passphrase',
    });
    expect(screen.queryByTestId('otp-input')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request email verification' })).toBeNull();
  },
);

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
    mock.onGet('/v1/legal/documents').reply(200, {
      documents: Object.values(CURRENT_LEGAL_DOCUMENTS),
      acceptanceOpen: true,
    });

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
    // K02 — a real checkbox, enabled once the server's versions load.
    const consent = (await screen.findByRole('checkbox', {
      name: SIGNUP_CONSENT_COPY.en.statement,
    })) as HTMLInputElement;
    await waitFor(() => expect(consent.disabled).toBe(false));
    await act(async () => {
      consent.click();
    });
    expect(consent.checked).toBe(true);
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
    const reg = mock.history.post.find((r) => r.url === '/v1/auth/register');
    expect(JSON.parse(reg!.data).legalAcceptance).toEqual({
      termsVersion: CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version,
      privacyVersion: CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version,
      locale: 'en',
    });
  });
});

// These exercise the real page, shared panel, request client and recovery
// navigation. Only HTTP is mocked; no real accounts or email are involved.
describe.each(['en', 'ar'] as const)('OTP challenge recovery (%s)', (lang) => {
  const resendLabel = lang === 'ar' ? 'إعادة طلب الرمز' : 'Resend code';
  const confirmLabel = lang === 'ar' ? 'تأكيد' : 'Confirm';
  const restartLabel = lang === 'ar' ? 'بدء تسجيل الدخول مجدداً' : 'Start sign-in again';

  async function openOtp(path: '/login' | '/signup' = '/login') {
    localStorage.setItem('hsm.lang', lang);
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/login').reply(200, OTP_CHALLENGE);
    mock.onPost('/v1/auth/register').reply(202, OTP_CHALLENGE);
    mock.onGet('/v1/legal/documents').reply(200, {
      documents: Object.values(CURRENT_LEGAL_DOCUMENTS),
      acceptanceOpen: true,
    });
    renderAuth(path);
    if (path === '/login') await submitLoginCredentials();
    else {
      fireEvent.change(document.querySelectorAll('input')[0]!, {
        target: { value: 'Ada Lovelace' },
      });
      fireEvent.click(screen.getByRole('button', { name: lang === 'ar' ? 'التالي' : 'Next' }));
      fireEvent.change(document.querySelector('input[type="email"]')!, {
        target: { value: 'ada@example.com' },
      });
      fireEvent.change(document.querySelector('input[type="password"]')!, {
        target: { value: 'a-reasonable-passphrase' },
      });
      const consent = await screen.findByRole('checkbox', {
        name: SIGNUP_CONSENT_COPY[lang].statement,
      });
      await waitFor(() => expect(consent).toBeEnabled());
      fireEvent.click(consent);
      fireEvent.click(
        screen.getByRole('button', { name: lang === 'ar' ? 'إنشاء الحساب' : 'Create Account' }),
      );
    }
    await screen.findByTestId('otp-input');
    await waitFor(() => expect(qc.getQueryState(['auth', 'me'])?.fetchStatus).toBe('idle'));
  }

  it.each([
    [400, 'AUTH_OTP_EXPIRED'],
    [400, 'AUTH_OTP_INVALID'],
    [403, 'AUTH_OTP_LOCKED'],
  ] as const)(
    'stops repeat resend after %s %s and restarts sign-in without an extra request',
    async (status, code) => {
      mock
        .onPost('/v1/auth/resend-otp')
        .reply(status, { error: { code, message: 'private-server-detail' } });
      await openOtp();
      const requestsBefore = mock.history.post.map((request) => request.url);
      fireEvent.click(screen.getByRole('button', { name: resendLabel }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(lang === 'ar' ? 'خيار الاستعادة' : 'recovery option');
      expect(alert).not.toHaveTextContent('private-server-detail');
      expect(screen.getByRole('button', { name: resendLabel })).toBeDisabled();
      expect(screen.getByRole('button', { name: confirmLabel })).toBeDisabled();
      expect(screen.getByTestId('otp-input')).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: resendLabel }));
      expect(
        mock.history.post.filter((request) => request.url === '/v1/auth/resend-otp'),
      ).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: restartLabel }));
      expect(screen.queryByTestId('otp-input')).not.toBeInTheDocument();
      expect(document.querySelector('input[type="email"]')).toHaveValue('ada@example.com');
      expect(document.querySelector('input[type="password"]')).toHaveValue('');
      expect(mock.history.post.map((request) => request.url)).toEqual([
        ...requestsBefore,
        '/v1/auth/resend-otp',
      ]);
    },
  );

  it('recovers an expired signup challenge through the existing verification-link page', async () => {
    mock.onPost('/v1/auth/resend-otp').reply(400, { error: { code: 'AUTH_OTP_EXPIRED' } });
    await openOtp('/signup');
    const requestsBefore = mock.history.post.map((request) => request.url);
    fireEvent.click(screen.getByRole('button', { name: resendLabel }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      lang === 'ar' ? 'خيار الاستعادة' : 'recovery option',
    );
    expect(screen.getByRole('button', { name: resendLabel })).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', {
        name: lang === 'ar' ? 'طلب رابط تحقق بدلاً من الرمز' : 'Use a verification link instead',
      }),
    );
    await screen.findByTestId('check-email-page');
    expect(document.querySelector('input[type="email"]')).toHaveValue('ada@example.com');
    expect(mock.history.post.map((request) => request.url)).toEqual([
      ...requestsBefore,
      '/v1/auth/resend-otp',
    ]);
  });

  it('retains verification after the resend limit, including after a wrong-code attempt', async () => {
    mock.onPost('/v1/auth/resend-otp').reply(403, { error: { code: 'AUTH_OTP_RESEND_EXCEEDED' } });
    mock.onPost('/v1/auth/verify-otp').reply(400, { error: { code: 'AUTH_OTP_INVALID' } });
    await openOtp();
    fireEvent.click(screen.getByRole('button', { name: resendLabel }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      lang === 'ar' ? 'أحدث رمز' : 'most recent code',
    );
    expect(screen.getByRole('button', { name: resendLabel })).toBeDisabled();
    expect(screen.getByTestId('otp-input')).toBeEnabled();
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        lang === 'ar' ? 'الرمز غير صحيح' : 'Incorrect code',
      ),
    );
    expect(screen.getByRole('button', { name: resendLabel })).toBeDisabled();
    expect(screen.getByRole('button', { name: confirmLabel })).toBeEnabled();
    expect(
      mock.history.post.filter((request) => request.url === '/v1/auth/verify-otp'),
    ).toHaveLength(1);
  });

  it.each([
    [400, 'AUTH_OTP_EXPIRED'],
    [403, 'AUTH_OTP_LOCKED'],
  ] as const)(
    'recovers a terminal verification response %s %s instead of sending the same code again',
    async (status, code) => {
      mock.onPost('/v1/auth/verify-otp').reply(status, { error: { code } });
      await openOtp();
      fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        lang === 'ar' ? 'خيار الاستعادة' : 'recovery option',
      );
      expect(screen.getByRole('button', { name: confirmLabel })).toBeDisabled();
      expect(screen.getByRole('button', { name: resendLabel })).toBeDisabled();
      fireEvent.keyDown(screen.getByTestId('otp-input'), { key: 'Enter' });
      expect(
        mock.history.post.filter((request) => request.url === '/v1/auth/verify-otp'),
      ).toHaveLength(1);
      expect(screen.getByRole('button', { name: restartLabel })).toBeEnabled();
    },
  );

  it('keeps localized recovery and entered digits on a language switch, then resets for a new challenge', async () => {
    mock.onPost('/v1/auth/resend-otp').reply(400, { error: { code: 'AUTH_OTP_EXPIRED' } });
    await openOtp();
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: resendLabel }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByTestId('lang-toggle'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      lang === 'en' ? 'خيار الاستعادة' : 'recovery option',
    );
    expect(screen.getByTestId('otp-input')).toHaveValue('123456');
    expect(screen.getByTestId('otp-input')).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', {
        name: lang === 'en' ? 'بدء تسجيل الدخول مجدداً' : 'Start sign-in again',
      }),
    );
    const nextChallenge = 'synthetic-fresh-login-challenge';
    mock.onPost('/v1/auth/login').reply(200, { ...OTP_CHALLENGE, challengeId: nextChallenge });
    mock.onPost('/v1/auth/resend-otp').reply(202, { success: true, expiresInSeconds: 300 });
    await submitLoginCredentials();
    expect(await screen.findByTestId('otp-input')).toBeEnabled();
    expect(screen.getByTestId('otp-input')).toHaveValue('');
    const resend = screen.getByRole('button', {
      name: lang === 'en' ? 'إعادة طلب الرمز' : 'Resend code',
    });
    expect(resend).toBeEnabled();
    fireEvent.click(resend);
    await waitFor(() => {
      const requests = mock.history.post.filter((request) => request.url === '/v1/auth/resend-otp');
      expect(requests).toHaveLength(2);
      expect(JSON.parse(requests[1]!.data)).toEqual({ challengeId: nextChallenge });
    });
  });

  it('allows retrying a wrong verification code and resending a still-live challenge', async () => {
    mock.onPost('/v1/auth/verify-otp').reply(400, { error: { code: 'AUTH_OTP_INVALID' } });
    mock.onPost('/v1/auth/resend-otp').reply(202, { success: true, expiresInSeconds: 300 });
    await openOtp();
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      lang === 'ar' ? 'الرمز غير صحيح' : 'Incorrect code',
    );
    expect(screen.getByRole('button', { name: confirmLabel })).toBeEnabled();
    expect(screen.getByRole('button', { name: resendLabel })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: resendLabel }));
    await waitFor(() =>
      expect(
        mock.history.post.filter((request) => request.url === '/v1/auth/resend-otp'),
      ).toHaveLength(1),
    );
  });

  it.each([429, 503, null] as const)(
    'keeps %s resend failures retryable with localized copy',
    async (status) => {
      if (status === null) mock.onPost('/v1/auth/resend-otp').networkError();
      else
        mock.onPost('/v1/auth/resend-otp').reply(status, {
          error: {
            code: status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
            message: 'private-server-detail',
          },
        });
      await openOtp();
      fireEvent.click(screen.getByRole('button', { name: resendLabel }));
      const alert = await screen.findByRole('alert');
      expect(alert).not.toHaveTextContent('private-server-detail');
      if (lang === 'ar') expect(alert.textContent).not.toMatch(/[A-Za-z]/);
      expect(screen.getByRole('button', { name: resendLabel })).toBeEnabled();
      expect(screen.getByTestId('otp-input')).toBeEnabled();
    },
  );
});
