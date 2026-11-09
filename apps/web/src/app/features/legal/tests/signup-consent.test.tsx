import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../../lib/auth-provider';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { SignUpPage } from '../../../pages/AuthPages';
import { LEGAL_COPY_VERSIONS } from '../copy/legal-documents.copy';

// K02 — signup consent semantics. The HTTP boundary is mocked; the router,
// providers, dialog and form are real. The real API path is covered by
// apps/api/test/integration/k02-saudi-contracts.integration.spec.ts and the
// browser path by apps/web/e2e/k02-saudi-launch.real-api.spec.ts.

let mock: MockAdapter;
let qc: QueryClient;

const DOCS = {
  documents: [
    { ...CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE },
    { ...CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE },
  ],
  acceptanceOpen: true,
};

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + JSON.stringify(location.state)}</output>;
}

function renderSignup(state: unknown = { returnTo: '/provider/onboarding' }) {
  return render(
    <AuthProvider client={qc}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[{ pathname: '/signup', state }]}>
          <Routes>
            <Route
              path="/signup"
              element={
                <>
                  <SignUpPage />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </AuthProvider>,
  );
}

async function goToStep2() {
  await waitFor(() => expect(document.querySelector('input[type="tel"]')).toBeTruthy());
  const name = document.querySelectorAll('input')[0] as HTMLInputElement;
  await act(async () => {
    fireEvent.change(name, { target: { value: 'Noura Alharbi' } });
  });
  const next = screen.getAllByRole('button').find((b) => /next/i.test(b.textContent ?? ''))!;
  await act(async () => next.click());
  await waitFor(() => expect(document.querySelector('input[type="email"]')).toBeTruthy());
  const email = document.querySelector('input[type="email"]') as HTMLInputElement;
  const password = document.querySelector('input[type="password"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(email, { target: { value: 'noura@example.com' } });
    fireEvent.change(password, { target: { value: 'k02-Correct-Horse-9' } });
  });
  const consent = (await screen.findByRole('checkbox')) as HTMLInputElement;
  await waitFor(() => expect(consent.disabled).toBe(false));
  return { email, password, consent };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
  mock.onGet('/v1/auth/me').reply(401, {});
  mock.onPost('/v1/auth/refresh').reply(401, {});
  mock.onGet('/v1/legal/documents').reply(200, DOCS);
});
afterEach(() => mock.restore());

describe('K02 signup consent', () => {
  it('uses a semantic checkbox whose name is the consent statement only', async () => {
    renderSignup();
    const { consent } = await goToStep2();
    expect(consent).toHaveAccessibleName(
      'I have read and agree to the Terms of Service and the Privacy Notice.',
    );
    expect(consent.checked).toBe(false);
    // The policy links are NOT inside the checkbox's label.
    const label = document.querySelector('label[for="signup-consent"]')!;
    expect(label.querySelector('a')).toBeNull();
  });

  it('requires a fresh choice after a language change, including a switch back', async () => {
    renderSignup();
    const { consent } = await goToStep2();
    fireEvent.click(consent);
    expect(consent).toBeChecked();
    fireEvent.click(screen.getByTestId('lang-toggle'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('lang-toggle'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(mock.history.post.some((request) => request.url === '/v1/auth/register')).toBe(false);
  });

  it('opening a policy by pointer never toggles consent, and closing keeps every value and returnTo', async () => {
    renderSignup();
    const { email, password, consent } = await goToStep2();
    const before = screen.getByTestId('where').textContent;

    const terms = screen.getByRole('link', { name: 'Read the Terms of Service' });
    expect(terms).toHaveAttribute('href', '/legal/terms');
    terms.focus();
    await act(async () => fireEvent.click(terms));
    const dialog = await screen.findByRole('dialog', { name: 'Terms of Service' });
    expect(within(dialog).getByTestId('legal-version')).toHaveTextContent(
      CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version,
    );
    expect(consent.checked).toBe(false);

    await act(async () => fireEvent.keyDown(dialog, { key: 'Escape' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(consent.checked).toBe(false);
    // Focus returns to the link that opened the dialog.
    await waitFor(() => expect(document.activeElement).toBe(terms));
    expect(email.value).toBe('noura@example.com');
    expect(password.value).toBe('k02-Correct-Horse-9');
    expect(screen.getByTestId('where').textContent).toBe(before); // same route, same returnTo state

    // Ticking, then reading the privacy notice, leaves it ticked.
    await act(async () => consent.click());
    expect(consent.checked).toBe(true);
    await act(async () =>
      fireEvent.click(screen.getByRole('link', { name: 'Read the Privacy Notice' })),
    );
    const privacy = await screen.findByRole('dialog', { name: 'Privacy Notice' });
    const closeButtons = within(privacy).getAllByRole('button', { name: 'Close' });
    await act(async () => closeButtons[closeButtons.length - 1]!.click());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(consent.checked).toBe(true);
  });

  it('opening a policy by keyboard never toggles consent', async () => {
    renderSignup();
    const { consent } = await goToStep2();
    const terms = screen.getByRole('link', { name: 'Read the Terms of Service' });
    terms.focus();
    // A native link activates on Enter as a click with detail 0.
    await act(async () => {
      fireEvent.keyDown(terms, { key: 'Enter' });
      fireEvent.click(terms, { detail: 0 });
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(consent.checked).toBe(false);
  });

  it('a modified click is left to the browser (new tab), never toggling consent', async () => {
    renderSignup();
    const { consent } = await goToStep2();
    const terms = screen.getByRole('link', { name: 'Read the Terms of Service' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => {
      terms.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(consent.checked).toBe(false);
  });

  it('sends the exact server versions and locale; never stores the password', async () => {
    mock.onPost('/v1/auth/register').reply(202, {
      otpRequired: true,
      challengeId: 'c1',
      codeLength: 6,
      expiresInSeconds: 300,
    });
    renderSignup();
    const { consent } = await goToStep2();
    expect(window.sessionStorage.getItem('hsm.signup.draft.v1')).not.toContain('Correct-Horse');
    await act(async () => consent.click());
    const create = screen.getAllByRole('button').find((b) => /create/i.test(b.textContent ?? ''))!;
    await act(async () => create.click());
    await waitFor(() =>
      expect(mock.history.post.some((r) => r.url === '/v1/auth/register')).toBe(true),
    );
    const body = JSON.parse(mock.history.post.find((r) => r.url === '/v1/auth/register')!.data);
    expect(body.legalAcceptance).toEqual({
      termsVersion: CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version,
      privacyVersion: CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version,
      locale: 'en',
    });
    expect(Object.keys(body).sort()).toEqual([
      'email',
      'firstName',
      'lastName',
      'legalAcceptance',
      'password',
    ]);
    // Draft cleared after a successful submission.
    expect(window.sessionStorage.getItem('hsm.signup.draft.v1')).toBeNull();
  });

  it('a stale version clears the box and asks the person to read the current one', async () => {
    mock.onPost('/v1/auth/register').reply(409, {
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'changed',
        details: { reason: 'LEGAL_VERSION_STALE', termsVersion: 'n', privacyVersion: 'n' },
      },
    });
    renderSignup();
    const { consent } = await goToStep2();
    await act(async () => consent.click());
    const create = screen.getAllByRole('button').find((b) => /create/i.test(b.textContent ?? ''))!;
    await act(async () => create.click());
    expect(await screen.findByText(/changed while you were signing up/)).toBeInTheDocument();
    expect(consent.checked).toBe(false);
  });

  it('cannot proceed when the server says acceptance is closed (production with draft text)', async () => {
    mock.onGet('/v1/legal/documents').reply(200, { ...DOCS, acceptanceOpen: false });
    renderSignup();
    expect(await screen.findByText(/Sign-up opens once the terms/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: /log in/i })).toBeEnabled();
    expect(mock.history.post.some((req) => req.url === '/v1/auth/register')).toBe(false);
  });

  it('requires the displayed policy versions to match the API before collecting credentials', async () => {
    mock.onGet('/v1/legal/documents').reply(200, {
      ...DOCS,
      documents: DOCS.documents.map((doc) => ({ ...doc, version: 'newer-server-version' })),
    });
    renderSignup();
    expect(await screen.findByRole('button', { name: 'Reload this page' })).toBeEnabled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(mock.history.post.some((req) => req.url === '/v1/auth/register')).toBe(false);
  });

  it('restores the non-secret draft after a reload, without the password or consent', async () => {
    window.sessionStorage.setItem(
      'hsm.signup.draft.v1',
      JSON.stringify({ step: 2, name: 'Noura Alharbi', email: 'noura@example.com' }),
    );
    renderSignup();
    await waitFor(() => expect(document.querySelector('input[type="email"]')).toBeTruthy());
    expect((document.querySelector('input[type="email"]') as HTMLInputElement).value).toBe(
      'noura@example.com',
    );
    expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('');
    expect(((await screen.findByRole('checkbox')) as HTMLInputElement).checked).toBe(false);
  });

  it('names the password visibility control and reports its state', async () => {
    renderSignup();
    await goToStep2();
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await act(async () => toggle.click());
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(
      (document.querySelector('input[autocomplete="new-password"]') as HTMLInputElement).type,
    ).toBe('text');
  });

  it('page copy versions equal the server registry (drift guard)', () => {
    expect(LEGAL_COPY_VERSIONS.terms).toBe(CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version);
    expect(LEGAL_COPY_VERSIONS.privacy).toBe(CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version);
  });
});
