import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { VerificationPolicyPanel } from './VerificationPolicyPanel';
import { UI } from '../copy/verification-copy';

// Sprint 9B.12 — policy management.
//
// The property that matters most is a NEGATIVE one: there is no edit control
// anywhere, because editing a published version would change what a provider
// was judged against after they were judged. A test that only checked publish
// and retire would pass against a panel that had quietly grown an edit button.

const POLICY_URL = '/v1/admin/verification/policies';

let mock: MockAdapter;

const policy = (over: Record<string, unknown> = {}) => ({
  version: '2026.08-v1',
  country: 'SY',
  providerType: null,
  categoryId: null,
  requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
  publishedAt: '2026-08-01T00:00:00.000Z',
  retiredAt: null,
  publishedByUserId: 'admin-1',
  isLive: true,
  ...over,
});

function renderPanel(lang: 'en' | 'ar' = 'en') {
  window.localStorage.setItem('hsm.lang', lang);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <VerificationPolicyPanel />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mock = new MockAdapter(api);
  window.localStorage.clear();
});

afterEach(() => {
  mock.restore();
  vi.restoreAllMocks();
});

describe('inspecting policy versions', () => {
  it('lists them with their live state', async () => {
    mock.onGet(POLICY_URL).reply(200, {
      policies: [
        policy(),
        policy({ version: '2026.07-v1', isLive: false, retiredAt: '2026-08-01T00:00:00.000Z' }),
      ],
    });
    renderPanel();

    expect(await screen.findByTestId('policy-row-2026.08-v1')).toBeInTheDocument();
    expect(screen.getByTestId('policy-live-2026.08-v1')).toHaveAttribute('data-live', 'true');
    expect(screen.getByTestId('policy-live-2026.07-v1')).toHaveAttribute('data-live', 'false');
  });

  it('says plainly when there are none', async () => {
    mock.onGet(POLICY_URL).reply(200, { policies: [] });
    renderPanel();
    expect(await screen.findByTestId('policy-empty')).toHaveTextContent(UI.en.policyEmpty);
  });

  it('shows which documents a version requires', async () => {
    mock.onGet(POLICY_URL).reply(200, {
      policies: [
        policy({ requirements: { documents: ['CATEGORY_LICENSE'], verificationRequired: true } }),
      ],
    });
    renderPanel();
    expect(await screen.findByTestId('policy-row-2026.08-v1')).toHaveTextContent('Trade licence');
  });
});

describe('policies are append-only', () => {
  it('offers NO edit control anywhere', async () => {
    // Editing a published version would change what a provider was judged
    // against AFTER they were judged. The control is absent, not disabled.
    mock.onGet(POLICY_URL).reply(200, { policies: [policy()] });
    renderPanel();
    await screen.findByTestId('policy-row-2026.08-v1');

    const panel = screen.getByTestId('policy-panel');
    for (const label of [/edit/i, /update/i, /modify/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(panel).toHaveTextContent(UI.en.policyAppendOnly);
  });

  it('offers retire only on a live version', async () => {
    mock.onGet(POLICY_URL).reply(200, {
      policies: [policy(), policy({ version: 'old', isLive: false })],
    });
    renderPanel();
    await screen.findByTestId('policy-row-2026.08-v1');

    expect(screen.getByTestId('policy-retire-2026.08-v1')).toBeInTheDocument();
    expect(screen.queryByTestId('policy-retire-old')).not.toBeInTheDocument();
  });

  it('retires the version that was clicked', async () => {
    let retired: string | null = null;
    mock.onGet(POLICY_URL).reply(200, { policies: [policy()] });
    mock.onPost(/\/policies\/.*\/retire/).reply((config) => {
      retired = decodeURIComponent(config.url?.split('/policies/')[1]?.split('/retire')[0] ?? '');
      return [200, { policy: policy({ isLive: false }) }];
    });
    renderPanel();

    fireEvent.click(await screen.findByTestId('policy-retire-2026.08-v1'));
    await waitFor(() => expect(retired).toBe('2026.08-v1'));
  });
});

describe('publishing a new version', () => {
  it('sends the version, country and chosen documents', async () => {
    let body: Record<string, unknown> = {};
    mock.onGet(POLICY_URL).reply(200, { policies: [] });
    mock.onPost(POLICY_URL).reply((config) => {
      body = JSON.parse(config.data);
      return [200, { policy: policy() }];
    });
    renderPanel();
    await screen.findByTestId('policy-empty');

    fireEvent.change(screen.getByTestId('policy-version'), { target: { value: '2026.09-v1' } });
    fireEvent.change(screen.getByTestId('policy-country'), { target: { value: 'SY' } });
    fireEvent.click(screen.getByTestId('policy-kind-BUSINESS_REGISTRATION'));
    fireEvent.click(screen.getByTestId('policy-publish'));

    await waitFor(() => expect(body.version).toBe('2026.09-v1'));
    expect(body.country).toBe('SY');
    expect(body.requirements).toEqual({
      documents: ['INDIVIDUAL_IDENTITY', 'BUSINESS_REGISTRATION'],
      verificationRequired: true,
    });
  });

  it('will not publish without a version', async () => {
    let called = false;
    mock.onGet(POLICY_URL).reply(200, { policies: [] });
    mock.onPost(POLICY_URL).reply(() => {
      called = true;
      return [200, { policy: policy() }];
    });
    renderPanel();
    await screen.findByTestId('policy-empty');

    fireEvent.click(screen.getByTestId('policy-publish'));
    expect(await screen.findByTestId('policy-error')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('shows the SERVER’s refusal rather than pre-empting it', async () => {
    // Version format and overlap rules live on the server (ADR 0010). A copy
    // of them in React would disagree the first time either changed.
    mock.onGet(POLICY_URL).reply(200, { policies: [] });
    mock.onPost(POLICY_URL).reply(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'A live policy already covers that scope.' },
    });
    renderPanel();
    await screen.findByTestId('policy-empty');

    fireEvent.change(screen.getByTestId('policy-version'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByTestId('policy-publish'));

    expect(await screen.findByTestId('policy-error')).toHaveTextContent(
      'A live policy already covers that scope.',
    );
  });
});

describe('permission and language', () => {
  it('replaces the panel entirely when the reviewer may not manage policy', async () => {
    mock.onGet(POLICY_URL).reply(403, { success: false, error: { code: 'FORBIDDEN' } });
    renderPanel();

    expect(await screen.findByTestId('policy-forbidden')).toHaveTextContent(UI.en.forbiddenBody);
    expect(screen.queryByTestId('policy-publish-form')).not.toBeInTheDocument();
  });

  it('renders Arabic and marks the direction', async () => {
    mock.onGet(POLICY_URL).reply(200, { policies: [] });
    renderPanel('ar');

    const panel = await screen.findByTestId('policy-panel');
    expect(panel).toHaveAttribute('dir', 'rtl');
    expect(panel).toHaveTextContent(UI.ar.policyTitle);
  });
});
