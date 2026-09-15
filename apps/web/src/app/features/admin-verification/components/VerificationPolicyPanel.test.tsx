import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { VerificationPolicyPanel } from './VerificationPolicyPanel';
import { POLICY_COPY } from '../policies/policy-copy';

const URL = '/v1/admin/verification/policies';
let mock: MockAdapter;
const policy = (over: Record<string, unknown> = {}) => ({
  version: '2026.08-sy-v1',
  country: 'SY',
  providerType: null,
  categoryId: null,
  requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
  publishedAt: '2026-08-01T00:00:00.000Z',
  retiredAt: null,
  publishedByUserId: 'admin-1',
  isLive: true,
  state: 'ACTIVE',
  ...over,
});
const options = {
  countries: [
    { countryCode: 'SY', enabled: true },
    { countryCode: 'SE', enabled: false },
  ],
  categories: [
    { id: 'plumbing', labelEn: 'Plumbing', labelAr: 'السباكة', selectable: true },
    { id: 'retired', labelEn: 'Retired trade', labelAr: 'تخصص موقوف', selectable: false },
  ],
};
function renderPanel(lang: 'en' | 'ar' = 'en') {
  window.localStorage.setItem('hsm.lang', lang);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <LanguageProvider>
        <VerificationPolicyPanel />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}
async function openForm() {
  const button = await screen.findByTestId('policy-new-version');
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
beforeEach(() => {
  mock = new MockAdapter(api);
  window.localStorage.clear();
  mock.onGet(URL).reply(200, { policies: [] });
  mock.onGet(`${URL}/options`).reply(200, options);
});
afterEach(() => {
  mock.restore();
  vi.restoreAllMocks();
});

it('preserves immutable history and distinguishes scheduled and stopped versions', async () => {
  mock.onGet(URL).reply(200, {
    policies: [
      policy(),
      policy({
        version: 'scheduled',
        state: 'SCHEDULED',
        isLive: false,
        publishedAt: '2099-01-01T00:00:00Z',
      }),
      policy({
        version: 'old',
        state: 'RETIRED',
        isLive: false,
        retiredAt: '2026-08-01T00:00:00Z',
      }),
    ],
  });
  renderPanel();
  expect(await screen.findByTestId('policy-row-2026.08-sy-v1')).toHaveTextContent('Active');
  expect(screen.getByTestId('policy-row-scheduled')).toHaveTextContent('Scheduled');
  expect(screen.getByTestId('policy-row-old')).toHaveTextContent('Stopped');
  expect(screen.queryByTestId('policy-retire-old')).not.toBeInTheDocument();
  expect(screen.queryByTestId('policy-retire-scheduled')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /edit|update|modify/i })).not.toBeInTheDocument();
  expect(screen.getByTestId('policy-panel')).toHaveTextContent(POLICY_COPY.en.appendOnly);
});

it('requires confirmation before retiring the selected version', async () => {
  mock.onGet(URL).reply(200, { policies: [policy()] });
  mock
    .onPost(`${URL}/2026.08-sy-v1/retire`)
    .reply(200, { policy: policy({ isLive: false, state: 'RETIRED' }) });
  renderPanel();
  fireEvent.click(await screen.findByTestId('policy-retire-2026.08-sy-v1'));
  expect(mock.history.post).toHaveLength(0);
  expect(screen.getByRole('dialog')).toHaveTextContent(POLICY_COPY.en.stopImpact);
  fireEvent.click(screen.getByTestId('policy-confirm'));
  await waitFor(() => expect(mock.history.post).toHaveLength(1));
  expect(mock.history.post[0].url).toBe(`${URL}/2026.08-sy-v1/retire`);
  expect(await screen.findByText(POLICY_COPY.en.stoppedSuccess)).toBeInTheDocument();
});

it('publishes the confirmed country, provider type, catalog specialty and documents', async () => {
  mock.onPost(URL).reply(201, { policy: policy() });
  renderPanel();
  await openForm();
  fireEvent.change(screen.getByTestId('policy-version'), { target: { value: '2026.09-sy-v1' } });
  fireEvent.change(screen.getByTestId('policy-country'), { target: { value: 'SY' } });
  fireEvent.change(screen.getByTestId('policy-provider-type'), { target: { value: 'BUSINESS' } });
  fireEvent.change(screen.getByTestId('policy-category'), { target: { value: 'plumbing' } });
  expect(screen.queryByRole('option', { name: 'Retired trade' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('policy-publish'));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Plumbing');
  expect(dialog).toHaveTextContent('Business');
  expect(mock.history.post).toHaveLength(0);
  fireEvent.click(screen.getByTestId('policy-confirm'));
  await waitFor(() => expect(mock.history.post).toHaveLength(1));
  expect(JSON.parse(mock.history.post[0].data)).toEqual({
    version: '2026.09-sy-v1',
    country: 'SY',
    providerType: 'BUSINESS',
    categoryId: 'plumbing',
    requirements: { documents: ['CATEGORY_LICENSE'], verificationRequired: true },
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('focuses the missing specialty and refuses a licence with no category', async () => {
  renderPanel();
  await openForm();
  fireEvent.change(screen.getByTestId('policy-version'), { target: { value: '2026.09-sy-v1' } });
  fireEvent.click(screen.getByTestId('policy-kind-CATEGORY_LICENSE'));
  fireEvent.click(screen.getByTestId('policy-publish'));
  expect(screen.getByText(POLICY_COPY.en.categoryRequired)).toBeInTheDocument();
  expect(screen.getByTestId('policy-category')).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mock.history.post).toHaveLength(0);
});

it('keeps selections and translates the server conflict without exposing infrastructure text', async () => {
  mock.onPost(URL).reply(409, {
    error: {
      code: 'CONFLICT',
      message: 'DO NOT DISPLAY DATABASE DETAIL',
      details: { reason: 'OVERLAPPING_POLICY' },
    },
  });
  renderPanel('ar');
  await openForm();
  fireEvent.change(screen.getByTestId('policy-version'), { target: { value: '2026.09-sy-v1' } });
  fireEvent.click(screen.getByTestId('policy-publish'));
  fireEvent.click(screen.getByTestId('policy-confirm'));
  expect(await screen.findByTestId('policy-error')).toHaveTextContent(POLICY_COPY.ar.overlap);
  expect(screen.queryByText('DO NOT DISPLAY DATABASE DETAIL')).not.toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: POLICY_COPY.ar.cancel }),
  );
  expect(screen.getByTestId('policy-version')).toHaveValue('2026.09-sy-v1');
});

it('shows retirement failures in the confirmation and keeps the version selected', async () => {
  mock.onGet(URL).reply(200, { policies: [policy()] });
  mock.onPost(/\/retire$/).reply(403, { error: { code: 'FORBIDDEN' } });
  renderPanel();
  fireEvent.click(await screen.findByTestId('policy-retire-2026.08-sy-v1'));
  fireEvent.click(screen.getByTestId('policy-confirm'));
  expect(await screen.findByTestId('policy-error')).toHaveTextContent(
    POLICY_COPY.en.noLongerAllowed,
  );
  expect(screen.getByRole('dialog')).toHaveTextContent('2026.08-sy-v1');
});

it('does not expose controls or load scope choices when policy access is denied', async () => {
  mock.onGet(URL).reply(403, { error: { code: 'FORBIDDEN' } });
  renderPanel();
  expect(await screen.findByTestId('policy-forbidden')).toHaveTextContent(
    POLICY_COPY.en.forbiddenBody,
  );
  expect(screen.queryByTestId('policy-new-version')).not.toBeInTheDocument();
  expect(screen.queryByTestId('policy-publish-form')).not.toBeInTheDocument();
  expect(mock.history.get.some((item) => item.url?.endsWith('/options'))).toBe(false);
});

it('reports a failed policy load instead of presenting an empty history', async () => {
  mock.onGet(URL).reply(500);
  renderPanel();
  expect(await screen.findByRole('alert')).toHaveTextContent(POLICY_COPY.en.loadFailed);
  expect(screen.queryByTestId('policy-empty')).not.toBeInTheDocument();
  expect(screen.queryByTestId('policy-publish-form')).not.toBeInTheDocument();
});

it('keeps new policy creation disabled until catalog choices can load', async () => {
  mock.onGet(`${URL}/options`).reply(500);
  renderPanel();
  expect(await screen.findByText(POLICY_COPY.en.optionsFailed)).toBeInTheDocument();
  expect(screen.getByTestId('policy-new-version')).toBeDisabled();
});

it('uses Arabic direction and meaningful labels with no raw state codes', async () => {
  mock.onGet(URL).reply(200, { policies: [policy()] });
  renderPanel('ar');
  const row = await screen.findByTestId('policy-row-2026.08-sy-v1');
  expect(screen.getByTestId('policy-panel')).toHaveAttribute('dir', 'rtl');
  expect(row).toHaveTextContent('سارية');
  expect(row).not.toHaveTextContent('ACTIVE');
  expect(row).not.toHaveTextContent('تقاعد');
});
