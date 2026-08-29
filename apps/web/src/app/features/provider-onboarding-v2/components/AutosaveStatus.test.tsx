import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AutosaveStatus } from './AutosaveStatus';
import { mergeAutosaveStatus, type AutosaveStatusKind } from '../autosave-status';
import { AUTOSAVE_COPY } from '../copy/autosave-copy';

// Sprint 9B.25 — the one save-status renderer every V2 task now shares.

const EN = AUTOSAVE_COPY.en;

function renderStatus(status: AutosaveStatusKind, lang: 'en' | 'ar' = 'en') {
  render(<AutosaveStatus status={status} lang={lang} testIdPrefix="t" />);
}

describe('it says what actually happened', () => {
  it('renders nothing at all when idle', () => {
    renderStatus({ kind: 'idle' });
    expect(screen.queryByTestId('t-save-status')).not.toBeInTheDocument();
  });

  it('says saving while a write is in flight', () => {
    renderStatus({ kind: 'saving' });
    expect(screen.getByTestId('t-save-status')).toHaveTextContent(EN.saving);
  });

  it('says saved only for the saved state', () => {
    renderStatus({ kind: 'saved', at: 1 });
    expect(screen.getByTestId('t-save-status')).toHaveTextContent(EN.saved);
  });

  it.each([
    ['saving', { kind: 'saving' } as AutosaveStatusKind],
    ['offline', { kind: 'offline' } as AutosaveStatusKind],
    ['conflict', { kind: 'conflict', serverVersion: 2 } as AutosaveStatusKind],
  ])('NEVER says saved in the %s state', (_name, status) => {
    // The false-saved-state guard. "Saved" is the one word a provider acts on
    // — they close the page — so it may appear for exactly one state.
    renderStatus(status);
    expect(screen.getByTestId('t-save-status')).not.toHaveTextContent(EN.saved);
  });

  it('offers a retry only on a failure, and runs it', () => {
    const retry = vi.fn();
    renderStatus({ kind: 'error', message: '500', retry });
    screen.getByTestId('t-save-retry').click();
    expect(retry).toHaveBeenCalled();
  });

  it('offers NO retry on a conflict — retrying would overwrite unseen work', () => {
    renderStatus({ kind: 'conflict', serverVersion: 3 });
    expect(screen.queryByTestId('t-save-retry')).not.toBeInTheDocument();
    expect(screen.getByTestId('t-save-status')).toHaveTextContent(EN.conflict);
  });
});

describe('the offline sentence does not over-promise', () => {
  it('tells the provider to keep the page open', () => {
    // The pending edit lives in memory: it survives a lost connection but not
    // a reload. Saying "we will save this" without that qualification is a
    // durability promise the client cannot keep.
    renderStatus({ kind: 'offline' });
    expect(screen.getByTestId('t-save-status')).toHaveTextContent(EN.offline);
    expect(EN.offline.toLowerCase()).toContain('keep this page open');
  });
});

describe('status is not carried by colour alone', () => {
  it.each([
    ['saving', { kind: 'saving' } as AutosaveStatusKind],
    ['saved', { kind: 'saved', at: 1 } as AutosaveStatusKind],
    ['offline', { kind: 'offline' } as AutosaveStatusKind],
    ['conflict', { kind: 'conflict', serverVersion: 1 } as AutosaveStatusKind],
    ['error', { kind: 'error', message: 'x', retry: () => {} } as AutosaveStatusKind],
  ])('%s carries an icon and a data-status as well as a colour', (name, status) => {
    renderStatus(status);
    const node = screen.getByTestId('t-save-status');
    expect(node).toHaveAttribute('data-status', name);
    expect(node.querySelector('svg')).not.toBeNull();
  });

  it('announces politely rather than interrupting', () => {
    renderStatus({ kind: 'saving' });
    expect(screen.getByTestId('t-save-status')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('Arabic', () => {
  it('renders the Arabic copy', () => {
    renderStatus({ kind: 'conflict', serverVersion: 1 }, 'ar');
    expect(screen.getByTestId('t-save-status')).toHaveTextContent(AUTOSAVE_COPY.ar.conflict);
  });
});

describe('two autosaves, one line', () => {
  const saved: AutosaveStatusKind = { kind: 'saved', at: 1 };
  const saving: AutosaveStatusKind = { kind: 'saving' };
  const offline: AutosaveStatusKind = { kind: 'offline' };
  const conflict: AutosaveStatusKind = { kind: 'conflict', serverVersion: 1 };
  const failed: AutosaveStatusKind = { kind: 'error', message: 'x', retry: () => {} };

  it('a conflict on either side wins over a save on the other', () => {
    // The lie-by-omission case: one step saved, the other lost a conflict, and
    // the screen says "Saved".
    expect(mergeAutosaveStatus(saved, conflict).kind).toBe('conflict');
    expect(mergeAutosaveStatus(conflict, saved).kind).toBe('conflict');
  });

  it('ranks conflict over error over offline over saving over saved', () => {
    expect(mergeAutosaveStatus(failed, conflict).kind).toBe('conflict');
    expect(mergeAutosaveStatus(offline, failed).kind).toBe('error');
    expect(mergeAutosaveStatus(saving, offline).kind).toBe('offline');
    expect(mergeAutosaveStatus(saved, saving).kind).toBe('saving');
  });

  it('reports saved only when BOTH sides are saved', () => {
    expect(mergeAutosaveStatus(saved, saved).kind).toBe('saved');
  });
});
