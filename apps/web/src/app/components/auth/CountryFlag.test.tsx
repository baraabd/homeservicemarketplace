import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COUNTRY_DIAL_CODES } from '../../../lib/country-dial-codes';
import { CountryFlag } from './CountryFlag';

afterEach(cleanup);

describe('selected country flags', () => {
  it('has a local SVG for every supported calling-code country', () => {
    const { rerender } = render(<CountryFlag />);
    for (const { iso2 } of COUNTRY_DIAL_CODES) {
      rerender(<CountryFlag iso2={iso2} />);
      const flag = screen.getByTestId('selected-country-flag');
      const image = flag.querySelector('img');
      expect(flag).toHaveAttribute('data-country', iso2);
      expect(flag).toHaveAttribute('aria-hidden', 'true');
      expect(image).not.toBeNull();
      expect(image).toHaveAttribute('alt', '');
      expect(image?.getAttribute('src')).not.toMatch(/^https?:/);
    }
  });

  it('falls back to a flag emoji on a failed image and retries when the country changes', () => {
    const { rerender } = render(<CountryFlag iso2="SA" />);
    fireEvent.error(screen.getByTestId('selected-country-flag').querySelector('img')!);
    expect(screen.getByTestId('selected-country-flag')).toHaveTextContent('🇸🇦');
    rerender(<CountryFlag iso2="SE" />);
    expect(screen.getByTestId('selected-country-flag').querySelector('img')).not.toBeNull();
  });

  it('shows a neutral globe when no country can be identified', () => {
    render(<CountryFlag />);
    const flag = screen.getByTestId('selected-country-flag');
    expect(flag).toHaveAttribute('data-country', '');
    expect(flag.querySelector('img')).toBeNull();
    expect(flag.querySelector('svg')).not.toBeNull();
  });
});
