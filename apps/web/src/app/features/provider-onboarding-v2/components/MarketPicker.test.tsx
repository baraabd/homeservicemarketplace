import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { SupportedMarketView } from '@homeservicemarketplace/contracts';

import { MarketPicker, type MarketPickerProps } from './MarketPicker';
import { MARKET_COPY } from '../copy/market-copy';

const ALLOWED_ZONES = ['America/Vancouver', 'America/Toronto'];

function market(allowedIds: readonly string[] = ALLOWED_ZONES): SupportedMarketView {
  return {
    countryCode: 'CA',
    displayNameKey: 'CA',
    radius: { minKm: 1, maxKm: 100, defaultKm: 5 },
    timezone: { kind: 'ASK', allowedIds },
  };
}

function props(overrides: Partial<MarketPickerProps> = {}): MarketPickerProps {
  const selected = market();
  return {
    prompt: { kind: 'CONFIRM_TIMEZONE', market: selected },
    markets: [selected],
    lang: 'en',
    editable: true,
    pending: false,
    onChoose: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('market timezone confirmation', () => {
  it('offers only the server-permitted zones in server order, without choosing one', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue([
      'Asia/Riyadh',
      'America/Toronto',
      'America/Vancouver',
    ]);
    const options = props();
    render(<MarketPicker {...options} />);

    const select = screen.getByTestId('market-timezone-select');
    const zones = within(select)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);
    expect(zones).toEqual(ALLOWED_ZONES);
    expect(select).toHaveValue('');
    expect(options.onChoose).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: 'America/Toronto' } });
    expect(options.onChoose).toHaveBeenCalledExactlyOnceWith('America/Toronto');
  });

  it('still offers server choices when the browser has no timezone database', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new Error('unsupported');
    });
    render(<MarketPicker {...props()} />);

    expect(screen.getByRole('option', { name: 'America/Vancouver' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'America/Toronto' })).toBeInTheDocument();
  });

  it.each([
    ['an older API omits choices', { kind: 'ASK' }],
    ['the operator has not declared zones', { kind: 'ASK', allowedIds: [] }],
    ['the response has malformed choices', { kind: 'ASK', allowedIds: 'America/Toronto' }],
  ])('offers a retry with no invented choices when %s', (_name, timezone) => {
    const selected = { ...market(), timezone } as SupportedMarketView;
    const options = props({ prompt: { kind: 'CONFIRM_TIMEZONE', market: selected } });
    render(<MarketPicker {...options} />);

    expect(screen.queryByTestId('market-timezone-select')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.click(screen.getByTestId('market-retry'));
    expect(options.onRetry).toHaveBeenCalledOnce();
    expect(options.onChoose).not.toHaveBeenCalled();
  });

  it.each([
    { editable: false, pending: false },
    { editable: true, pending: true },
  ])('disables choices while editable=$editable and pending=$pending', (state) => {
    render(<MarketPicker {...props(state)} />);
    expect(screen.getByTestId('market-timezone-select')).toBeDisabled();
  });

  it.each(['en', 'ar'] as const)('recovers with labelled choices after retry in %s', (lang) => {
    const options = props({
      lang,
      prompt: { kind: 'CONFIRM_TIMEZONE', market: market([]) },
    });
    const { rerender } = render(<MarketPicker {...options} />);
    expect(screen.getByText(MARKET_COPY[lang].timezoneUnavailableTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: MARKET_COPY[lang].retry }));
    expect(options.onRetry).toHaveBeenCalledOnce();

    rerender(<MarketPicker {...options} prompt={{ kind: 'CONFIRM_TIMEZONE', market: market() }} />);
    const select = screen.getByRole('combobox', { name: MARKET_COPY[lang].timezoneLabel });
    expect(select).toHaveValue('');
    expect(
      screen.getByRole('option', { name: MARKET_COPY[lang].timezonePlaceholder }),
    ).toBeDisabled();
    expect(options.onChoose).not.toHaveBeenCalled();
  });

  it('does not retain a timezone selection after the market changes', () => {
    const options = props();
    const { rerender } = render(<MarketPicker {...options} />);
    fireEvent.change(screen.getByTestId('market-timezone-select'), {
      target: { value: 'America/Toronto' },
    });
    const next = { ...market(['America/New_York', 'America/Los_Angeles']), countryCode: 'US' };
    rerender(<MarketPicker {...options} prompt={{ kind: 'CONFIRM_TIMEZONE', market: next }} />);

    expect(screen.getByTestId('market-timezone-select')).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'America/Toronto' })).toBeNull();
    expect(options.onChoose).toHaveBeenCalledTimes(1);
  });

  it('shows no choices when the market service is unavailable', () => {
    const options = props({ prompt: { kind: 'UNAVAILABLE' } });
    render(<MarketPicker {...options} />);

    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByTestId('market-retry'));
    expect(options.onRetry).toHaveBeenCalledOnce();
    expect(options.onChoose).not.toHaveBeenCalled();
  });
});
