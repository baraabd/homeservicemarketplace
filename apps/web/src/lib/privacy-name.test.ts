import { describe, expect, it } from 'vitest';

import { formatPrivacyDisplayName } from './privacy-name';

describe('formatPrivacyDisplayName', () => {
  it('abbreviates English first name and keeps the last name in full', () => {
    expect(formatPrivacyDisplayName({ firstName: 'Mohab', lastName: 'Alhassan' })).toBe(
      'M. Alhassan',
    );
    expect(formatPrivacyDisplayName({ displayName: 'Provider Provider' })).toBe('P. Provider');
  });

  it('abbreviates Arabic first name and keeps the last name in full', () => {
    expect(formatPrivacyDisplayName({ firstName: 'محمد', lastName: 'الأحمد' })).toBe('م. الأحمد');
    expect(formatPrivacyDisplayName({ displayName: 'أم عيبو' })).toBe('أ. عيبو');
  });

  it('drops middle names', () => {
    expect(formatPrivacyDisplayName({ displayName: 'John Michael Robert Smith' })).toBe('J. Smith');
    expect(formatPrivacyDisplayName({ firstName: 'John Michael', lastName: 'Smith' })).toBe(
      'J. Smith',
    );
  });

  it('shows only an initial for a single name (no family name to reveal)', () => {
    expect(formatPrivacyDisplayName({ displayName: 'Madonna' })).toBe('M.');
    expect(formatPrivacyDisplayName({ firstName: 'Cher' })).toBe('C.');
  });

  it('falls back to the role label (never an email) when no name is present', () => {
    expect(formatPrivacyDisplayName({ displayName: '' }, { roleFallback: 'Provider' })).toBe(
      'Provider',
    );
    expect(formatPrivacyDisplayName(null, { roleFallback: 'Seeker' })).toBe('Seeker');
    expect(
      formatPrivacyDisplayName(
        { firstName: '', lastName: '', displayName: '' },
        { roleFallback: 'مزود' },
      ),
    ).toBe('مزود');
  });

  it('returns empty string when nothing is available and no fallback given', () => {
    expect(formatPrivacyDisplayName(null)).toBe('');
    expect(formatPrivacyDisplayName({ displayName: '   ' })).toBe('');
  });

  it('trims whitespace and collapses extra spaces', () => {
    expect(formatPrivacyDisplayName({ displayName: '  Mohab   Alhassan  ' })).toBe('M. Alhassan');
    expect(formatPrivacyDisplayName({ firstName: '  Mohab ', lastName: ' Alhassan ' })).toBe(
      'M. Alhassan',
    );
  });

  it('never produces a double dot', () => {
    const out = formatPrivacyDisplayName({ firstName: 'A.', lastName: 'Khalid' });
    expect(out).toBe('A. Khalid');
    expect(out).not.toContain('..');
  });

  it('shows a family-only name in full', () => {
    expect(formatPrivacyDisplayName({ lastName: 'Alhassan' })).toBe('Alhassan');
  });

  it('prefers structured first/last over displayName', () => {
    expect(
      formatPrivacyDisplayName({ firstName: 'Mohab', lastName: 'Alhassan', displayName: 'WRONG' }),
    ).toBe('M. Alhassan');
  });
});
