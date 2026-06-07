import { describe, expect, it } from 'vitest';

import { formatServiceAddressForDisplay } from './address-display';

describe('formatServiceAddressForDisplay', () => {
  // Sprint 7.14 — exact job-posting examples from the bug report.
  it('reduces a full Aleppo geocoder line to the neighbourhood only', () => {
    const out = formatServiceAddressForDisplay({
      line1: 'حي البياضة, حلب, ناحية مركز جبل سمعان, منطقة جبل سمعان, محافظة حلب, سوريا',
      city: 'حلب',
      country: 'سوريا',
    });
    expect(out).toBe('حي البياضة');
    // None of the redundant administrative tiers survive.
    expect(out).not.toMatch(/حلب|ناحية|منطقة|محافظة|سوريا/);
  });

  it('keeps street + neighbourhood from a mixed-script Aleppo line', () => {
    const out = formatServiceAddressForDisplay({
      line1:
        'شارع السجن, Bayadah district, حي قلعة الشريف, حلب, ناحية مركز جبل سمعان, منطقة جبل سمعان, محافظة حلب, سوريا',
      city: 'حلب',
      country: 'سوريا',
    });
    expect(out).toContain('شارع السجن');
    expect(out).not.toMatch(/ناحية|منطقة|محافظة|سوريا/);
    expect(out.length).toBeGreaterThan(0);
  });

  it('shortens a long Arabic geocoder address to local parts only', () => {
    const snapshot = {
      line1:
        'شارع السجن, Bayadah district, حي قلعة الشريف, حلب, ناحية مركز جبل سمعان, منطقة جبل سمعان',
      city: 'محافظة حلب',
      country: 'سوريا',
    };
    const out = formatServiceAddressForDisplay(snapshot);
    // Keeps the useful street + neighbourhood parts...
    expect(out).toContain('شارع السجن');
    expect(out).toContain('Bayadah district');
    // ...drops country / governorate / region / sub-district.
    expect(out).not.toContain('سوريا');
    expect(out).not.toContain('محافظة');
    expect(out).not.toContain('منطقة');
    expect(out).not.toContain('ناحية');
  });

  it('shortens a long English address and drops redundant admin tiers', () => {
    const snapshot = {
      line1: 'King Fahd Rd, Al Olaya, Riyadh, Riyadh Province, Riyadh Region',
      city: 'Riyadh',
      country: 'Saudi Arabia',
    };
    const out = formatServiceAddressForDisplay(snapshot);
    expect(out).toContain('King Fahd Rd');
    expect(out).toContain('Al Olaya');
    expect(out.toLowerCase()).not.toContain('province');
    expect(out.toLowerCase()).not.toContain('region');
    // bare "Riyadh" city token is removed as redundant
    expect(out).not.toMatch(/Riyadh/);
  });

  it('removes the city when it equals the snapshot/profile city', () => {
    const out = formatServiceAddressForDisplay(
      { line1: 'Main Street, Aleppo', city: 'Aleppo', country: 'Syria' },
      { profileCity: 'Aleppo' },
    );
    expect(out).toBe('Main Street');
  });

  it('retains the useful street and neighbourhood parts in order', () => {
    const out = formatServiceAddressForDisplay({
      line1: 'Elm Street, Downtown, Springfield',
      city: 'Springfield',
      country: 'USA',
    });
    expect(out).toBe('Elm Street، Downtown');
  });

  it('falls back to the cleaned city when no local part survives', () => {
    const out = formatServiceAddressForDisplay({
      line1: 'محافظة حلب',
      city: 'محافظة حلب',
      country: 'سوريا',
    });
    expect(out).toBe('حلب');
  });

  it('returns empty string for empty / nullish input', () => {
    expect(formatServiceAddressForDisplay(null)).toBe('');
    expect(formatServiceAddressForDisplay(undefined)).toBe('');
    expect(formatServiceAddressForDisplay('')).toBe('');
    expect(formatServiceAddressForDisplay({ line1: '', city: '', country: '' })).toBe('');
  });

  it('truncates very long results with an ellipsis', () => {
    const longPart = 'A'.repeat(40);
    const out = formatServiceAddressForDisplay(
      { line1: `${longPart}, ${longPart}`, city: 'X', country: 'Y' },
      { maxLength: 30 },
    );
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles a raw freeform string and Arabic separators', () => {
    const out = formatServiceAddressForDisplay('شارع الحمراء، حي الزهور، الرياض', {
      profileCity: 'الرياض',
    });
    expect(out).toContain('شارع الحمراء');
    expect(out).toContain('حي الزهور');
    expect(out).not.toContain('الرياض');
  });

  it('does not mutate the input snapshot', () => {
    const snapshot = {
      line1: 'Main St, Riyadh, Saudi Arabia',
      city: 'Riyadh',
      country: 'Saudi Arabia',
    };
    const clone = { ...snapshot };
    formatServiceAddressForDisplay(snapshot);
    expect(snapshot).toEqual(clone);
  });

  it('dedupes repeated tokens', () => {
    const out = formatServiceAddressForDisplay({
      line1: 'Main St, Main St, Downtown',
      city: 'Town',
      country: 'Country',
    });
    expect(out).toBe('Main St، Downtown');
  });
});
