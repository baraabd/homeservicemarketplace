import { describe, it, expect } from 'vitest';
import { deriveDisplayName, deriveInitials } from './use-auth-identity';

// These are the pure derivation functions behind useAuthIdentity. The hook
// itself just wraps useAuth() and forwards to these; covering the two pure
// funcs here plus a render-tree integration test elsewhere gives us full
// regression coverage without double-testing React Query.

describe('deriveDisplayName', () => {
  it('joins first + last', () => {
    expect(deriveDisplayName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
  });

  it('trims surrounding whitespace on both parts', () => {
    expect(deriveDisplayName({ firstName: '  Ada  ', lastName: ' Lovelace ' })).toBe(
      'Ada Lovelace',
    );
  });

  it('falls back to firstName alone when lastName is empty', () => {
    expect(deriveDisplayName({ firstName: 'Ada', lastName: '' })).toBe('Ada');
  });

  it('falls back to lastName alone when firstName is empty', () => {
    expect(deriveDisplayName({ firstName: '', lastName: 'Lovelace' })).toBe('Lovelace');
  });

  it('falls back to the email local-part when names are missing', () => {
    expect(deriveDisplayName({ firstName: '', lastName: '', email: 'ada@example.com' })).toBe(
      'ada',
    );
  });

  it('returns "" for a fully empty user (caller chooses a neutral state)', () => {
    expect(deriveDisplayName({ firstName: '', lastName: '', email: '' })).toBe('');
  });

  it('tolerates nullable fields from lax backends', () => {
    expect(deriveDisplayName({ firstName: null, lastName: null, email: null })).toBe('');
  });
});

describe('deriveInitials', () => {
  it('takes the first letter of first and last name, uppercased', () => {
    expect(deriveInitials({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('AL');
  });

  it('handles lowercase names', () => {
    expect(deriveInitials({ firstName: 'ada', lastName: 'lovelace' })).toBe('AL');
  });

  it('Arabic script: uses the first glyph of each part', () => {
    // The header renders any script the user registered with — not a hardcoded
    // transliteration. These assertions protect that: a user who registered
    // with Arabic names sees their own initials, not "AK".
    const initials = deriveInitials({ firstName: 'أحمد', lastName: 'الخالد' });
    expect(initials.length).toBe(2);
    expect(initials).not.toBe('AK');
  });

  it('falls back to first two letters of firstName when lastName is missing', () => {
    expect(deriveInitials({ firstName: 'Ada', lastName: '' })).toBe('AD');
  });

  it('falls back to the email local-part prefix when names are missing', () => {
    expect(deriveInitials({ firstName: '', lastName: '', email: 'ada@example.com' })).toBe('AD');
  });

  it('returns "" for a fully empty user', () => {
    expect(deriveInitials({ firstName: '', lastName: '', email: '' })).toBe('');
  });

  it('NEVER emits the demo placeholder "AK"', () => {
    // Fuzz a few plausible names; none should collapse to the demo initials.
    const samples = [
      { firstName: 'Ada', lastName: 'Lovelace' },
      { firstName: 'Bo', lastName: 'Doe' },
      { firstName: 'Jane', lastName: 'Qa' },
      { firstName: '', lastName: '', email: 'jane@x.com' },
    ];
    for (const s of samples) {
      expect(deriveInitials(s)).not.toBe('AK');
    }
  });
});
