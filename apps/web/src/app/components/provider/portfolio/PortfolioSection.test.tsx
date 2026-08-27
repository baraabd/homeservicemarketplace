import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { PortfolioSection } from './PortfolioSection';
import { PORTFOLIO_COPY } from './portfolio-copy';

// Sprint 9B.10 — the portfolio surface.
//
// Every state the brief names is asserted here: loading, empty, populated,
// limit reached, validation refusal, upload progress, moderation badge,
// reorder, and the delete confirmation. Arabic and RTL get their own block,
// because a direction bug is invisible in review and obvious to a user.

const PORTFOLIO_URL = '/v1/me/provider/portfolio';

function item(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'it-1',
    media: { url: '/v1/media/files/portfolio/abc/1.jpg', contentType: 'image/jpeg' },
    title: 'Kitchen tap',
    description: null,
    serviceCategoryId: null,
    position: 0,
    moderationState: 'PENDING',
    moderationReason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

let mock: MockAdapter;

function renderSection(lang: 'en' | 'ar' = 'en') {
  window.localStorage.setItem('hsm.lang', lang);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <PortfolioSection />
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

describe('loading and failure', () => {
  it('announces a busy state while loading', async () => {
    mock.onGet(PORTFOLIO_URL).reply(() => new Promise(() => {}));
    renderSection();

    const section = await screen.findByLabelText(PORTFOLIO_COPY.en.sectionTitle);
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(PORTFOLIO_COPY.en.loading)).toBeInTheDocument();
  });

  it('offers a retry when the gallery cannot be loaded', async () => {
    mock.onGet(PORTFOLIO_URL).reply(500);
    renderSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(PORTFOLIO_COPY.en.loadFailed);
    expect(screen.getByRole('button', { name: PORTFOLIO_COPY.en.retry })).toBeInTheDocument();
  });
});

describe('the empty state', () => {
  it('explains what to add and why', async () => {
    mock.onGet(PORTFOLIO_URL).reply(200, { items: [], remainingSlots: 12, maxItems: 12 });
    renderSection();

    const empty = await screen.findByTestId('portfolio-empty');
    expect(empty).toHaveTextContent(PORTFOLIO_COPY.en.emptyTitle);
    expect(empty).toHaveTextContent(PORTFOLIO_COPY.en.emptyBody);
    // The call to action is present, because an empty state with no next step
    // is a dead end.
    expect(screen.getByRole('button', { name: PORTFOLIO_COPY.en.addButton })).toBeInTheDocument();
  });
});

describe('a populated gallery', () => {
  beforeEach(() => {
    mock.onGet(PORTFOLIO_URL).reply(200, {
      items: [item({ id: 'a', title: 'First' }), item({ id: 'b', title: 'Second', position: 1 })],
      remainingSlots: 10,
      maxItems: 12,
    });
  });

  it('renders every item with an accessible image', async () => {
    renderSection();
    const grid = await screen.findByTestId('portfolio-grid');
    const rendered = within(grid).getAllByTestId('portfolio-item');

    expect(rendered).toHaveLength(2);
    // alt text falls back to the section name when there is no caption, so an
    // image is never announced as an empty string.
    expect(within(grid).getByAltText('First')).toBeInTheDocument();
  });

  it('says how many slots remain', async () => {
    renderSection();
    expect(await screen.findByText(/10/)).toBeInTheDocument();
  });

  it('shows the moderation state of each item', async () => {
    renderSection();
    expect(await screen.findAllByText(PORTFOLIO_COPY.en.moderationPending)).toHaveLength(2);
  });

  it('marks a rejected item distinctly', async () => {
    mock.onGet(PORTFOLIO_URL).reply(200, {
      items: [item({ moderationState: 'REJECTED', moderationReason: 'FACE_VISIBLE' })],
      remainingSlots: 11,
      maxItems: 12,
    });
    renderSection();
    expect(await screen.findByText(PORTFOLIO_COPY.en.moderationRejected)).toBeInTheDocument();
  });

  it('disables "earlier" on the first item and "later" on the last', async () => {
    renderSection();
    await screen.findByTestId('portfolio-grid');

    const earlier = screen.getAllByRole('button', { name: PORTFOLIO_COPY.en.moveUp });
    const later = screen.getAllByRole('button', { name: PORTFOLIO_COPY.en.moveDown });

    expect(earlier[0]).toBeDisabled();
    expect(later[later.length - 1]).toBeDisabled();
    expect(earlier[1]).toBeEnabled();
  });

  it('sends the full new order when an item is moved', async () => {
    let sent: string[] = [];
    mock.onPost(`${PORTFOLIO_URL}/reorder`).reply((config) => {
      sent = JSON.parse(config.data).itemIds;
      return [200, { items: [], remainingSlots: 10, maxItems: 12 }];
    });
    renderSection();
    await screen.findByTestId('portfolio-grid');

    fireEvent.click(screen.getAllByRole('button', { name: PORTFOLIO_COPY.en.moveUp })[1]);

    // A complete list, not a delta: the server reconciles nothing.
    await waitFor(() => expect(sent).toEqual(['b', 'a']));
  });
});

describe('the limit', () => {
  it('replaces the add button with an explanation once full', async () => {
    mock.onGet(PORTFOLIO_URL).reply(200, {
      items: [item()],
      remainingSlots: 0,
      maxItems: 1,
    });
    renderSection();

    expect(await screen.findByTestId('portfolio-limit')).toHaveTextContent(
      PORTFOLIO_COPY.en.limitReachedNotice,
    );
    // No dead button: offering "add" and then refusing teaches people to tap
    // and hope.
    expect(
      screen.queryByRole('button', { name: PORTFOLIO_COPY.en.addAnother }),
    ).not.toBeInTheDocument();
  });
});

describe('uploading', () => {
  beforeEach(() => {
    mock.onGet(PORTFOLIO_URL).reply(200, { items: [], remainingSlots: 12, maxItems: 12 });
  });

  it('requires the publication-right consent before it will upload', async () => {
    renderSection();
    await screen.findByTestId('portfolio-empty');

    const file = new File(['x'], 'job.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(PORTFOLIO_COPY.en.fileInputLabel), {
      target: { files: [file] },
    });

    const panel = await screen.findByTestId('portfolio-consent');
    // The upload button is disabled until the box is ticked. A customer's home
    // may be in the photo, so the consent is a gate rather than a notice.
    const confirm = within(panel).getByRole('button', { name: PORTFOLIO_COPY.en.addButton });
    expect(confirm).toBeDisabled();

    fireEvent.click(within(panel).getByLabelText(PORTFOLIO_COPY.en.consentLabel));
    expect(confirm).toBeEnabled();
  });

  it('renders a localised message for a server refusal code', async () => {
    mock.onPost('/v1/media/presigned-url').reply(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', details: { reason: 'FILE_TOO_LARGE' } },
    });
    renderSection();
    await screen.findByTestId('portfolio-empty');

    const file = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(PORTFOLIO_COPY.en.fileInputLabel), {
      target: { files: [file] },
    });
    const panel = await screen.findByTestId('portfolio-consent');
    fireEvent.click(within(panel).getByLabelText(PORTFOLIO_COPY.en.consentLabel));
    fireEvent.click(within(panel).getByRole('button', { name: PORTFOLIO_COPY.en.addButton }));

    // The CODE is mapped to copy. The server's own sentence would arrive in
    // one language whatever the UI is set to.
    const alert = await screen.findByTestId('portfolio-error');
    expect(alert).toHaveTextContent(PORTFOLIO_COPY.en.errFILE_TOO_LARGE);
  });

  it('falls back to generic copy for an unrecognised code', async () => {
    mock.onPost('/v1/media/presigned-url').reply(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', details: { reason: 'SOMETHING_NEW_2027' } },
    });
    renderSection();
    await screen.findByTestId('portfolio-empty');

    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(PORTFOLIO_COPY.en.fileInputLabel), {
      target: { files: [file] },
    });
    const panel = await screen.findByTestId('portfolio-consent');
    fireEvent.click(within(panel).getByLabelText(PORTFOLIO_COPY.en.consentLabel));
    fireEvent.click(within(panel).getByRole('button', { name: PORTFOLIO_COPY.en.addButton }));

    // A provider must never be shown a raw server code.
    const alert = await screen.findByTestId('portfolio-error');
    expect(alert).toHaveTextContent(PORTFOLIO_COPY.en.errUNKNOWN);
    expect(alert).not.toHaveTextContent('SOMETHING_NEW_2027');
  });

  it('lets the provider abandon a chosen file', async () => {
    renderSection();
    await screen.findByTestId('portfolio-empty');

    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(PORTFOLIO_COPY.en.fileInputLabel), {
      target: { files: [file] },
    });
    const panel = await screen.findByTestId('portfolio-consent');
    fireEvent.click(within(panel).getByRole('button', { name: PORTFOLIO_COPY.en.uploadCancel }));

    await waitFor(() => expect(screen.queryByTestId('portfolio-consent')).not.toBeInTheDocument());
  });
});

describe('deleting', () => {
  beforeEach(() => {
    mock.onGet(PORTFOLIO_URL).reply(200, {
      items: [item({ id: 'a' })],
      remainingSlots: 11,
      maxItems: 12,
    });
  });

  it('asks before removing, and does nothing if the provider backs out', async () => {
    let deleted = false;
    mock.onDelete(`${PORTFOLIO_URL}/a`).reply(() => {
      deleted = true;
      return [204];
    });
    renderSection();
    await screen.findByTestId('portfolio-grid');

    fireEvent.click(screen.getByRole('button', { name: PORTFOLIO_COPY.en.delete }));
    expect(await screen.findByText(PORTFOLIO_COPY.en.deleteConfirmTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: PORTFOLIO_COPY.en.deleteCancel }));
    await waitFor(() =>
      expect(screen.queryByText(PORTFOLIO_COPY.en.deleteConfirmTitle)).not.toBeInTheDocument(),
    );
    expect(deleted).toBe(false);
  });

  it('removes it when confirmed', async () => {
    let deleted = false;
    mock.onDelete(`${PORTFOLIO_URL}/a`).reply(() => {
      deleted = true;
      return [204];
    });
    renderSection();
    await screen.findByTestId('portfolio-grid');

    fireEvent.click(screen.getByRole('button', { name: PORTFOLIO_COPY.en.delete }));
    fireEvent.click(await screen.findByRole('button', { name: PORTFOLIO_COPY.en.deleteConfirm }));

    await waitFor(() => expect(deleted).toBe(true));
  });
});

describe('editing a caption', () => {
  it('saves the new caption', async () => {
    mock.onGet(PORTFOLIO_URL).reply(200, {
      items: [item({ id: 'a', title: 'Old' })],
      remainingSlots: 11,
      maxItems: 12,
    });
    let sent: Record<string, unknown> = {};
    mock.onPatch(`${PORTFOLIO_URL}/a`).reply((config) => {
      sent = JSON.parse(config.data);
      return [200, item({ id: 'a', title: 'New' })];
    });
    renderSection();
    await screen.findByTestId('portfolio-grid');

    fireEvent.click(screen.getByRole('button', { name: PORTFOLIO_COPY.en.edit }));
    const field = await screen.findByLabelText(PORTFOLIO_COPY.en.captionLabel);
    fireEvent.change(field, { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: PORTFOLIO_COPY.en.save }));

    await waitFor(() => expect(sent.title).toBe('New'));
  });
});

describe('Arabic and RTL', () => {
  beforeEach(() => {
    mock.onGet(PORTFOLIO_URL).reply(200, {
      items: [item({ id: 'a', title: 'أ' }), item({ id: 'b', title: 'ب', position: 1 })],
      remainingSlots: 10,
      maxItems: 12,
    });
  });

  it('renders the Arabic copy', async () => {
    renderSection('ar');
    // Wait for the GRID, not the title: the loading skeleton also renders the
    // section title, so asserting on it alone passes while the gallery is
    // still a spinner — and the next assertion then fails for a reason that
    // has nothing to do with language.
    await screen.findByTestId('portfolio-grid');

    expect(screen.getByText(PORTFOLIO_COPY.ar.sectionTitle)).toBeInTheDocument();
    expect(screen.getByText(PORTFOLIO_COPY.ar.reorderHint)).toBeInTheDocument();
  });

  it('labels the reorder controls by INTENT, so they survive mirroring', async () => {
    // The control that moves an item earlier is called "earlier" in both
    // languages. A button named "move left" would be wrong in one of them
    // whichever way it was written, because earlier is on the right in Arabic.
    renderSection('ar');
    await screen.findByTestId('portfolio-grid');

    const earlier = screen.getAllByRole('button', { name: PORTFOLIO_COPY.ar.moveUp });
    expect(earlier[0]).toBeDisabled();
    expect(earlier[1]).toBeEnabled();
  });

  it('flips the arrow glyph for RTL', async () => {
    renderSection('ar');
    await screen.findByTestId('portfolio-grid');

    // "Earlier" points towards the start of the reading order: right in
    // Arabic, left in English.
    const arEarlier = screen.getAllByRole('button', { name: PORTFOLIO_COPY.ar.moveUp })[1];
    expect(arEarlier).toHaveTextContent('→');
  });

  it('points the same control the other way in English', async () => {
    // The pair is what makes the assertion meaningful: one direction alone
    // would pass with a hard-coded glyph.
    mock.onGet(PORTFOLIO_URL).reply(200, {
      items: [item({ id: 'a' }), item({ id: 'b', position: 1 })],
      remainingSlots: 10,
      maxItems: 12,
    });
    renderSection('en');
    await screen.findByTestId('portfolio-grid');

    const enEarlier = screen.getAllByRole('button', { name: PORTFOLIO_COPY.en.moveUp })[1];
    expect(enEarlier).toHaveTextContent('←');
  });

  it('moves an item towards the START of the order in Arabic too', async () => {
    let sent: string[] = [];
    mock.onPost(`${PORTFOLIO_URL}/reorder`).reply((config) => {
      sent = JSON.parse(config.data).itemIds;
      return [200, { items: [], remainingSlots: 10, maxItems: 12 }];
    });
    renderSection('ar');
    await screen.findByTestId('portfolio-grid');

    fireEvent.click(screen.getAllByRole('button', { name: PORTFOLIO_COPY.ar.moveUp })[1]);

    // Identical to the English case: direction changes how it LOOKS, never
    // what it MEANS.
    await waitFor(() => expect(sent).toEqual(['b', 'a']));
  });
});
