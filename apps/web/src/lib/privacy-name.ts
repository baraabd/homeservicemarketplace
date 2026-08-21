// Sprint 7.13 — privacy-safe display name.
//
// Shows the GIVEN name abbreviated to an initial and the FAMILY name in
// full, for names belonging to OTHER users (a seeker viewing a
// provider, a provider viewing a seeker post-assignment, actor names in
// notifications, etc.):
//
//   "Mohab Alhassan"   → "M. Alhassan"
//   "Provider Provider"→ "P. Provider"
//   "محمد الأحمد"        → "م. الأحمد"
//   "أم عيبو"           → "أ. عيبو"
//
// Display-only — never mutates stored names. Never falls back to an
// email; an absent name resolves to a caller-supplied role label
// ("Seeker" / "Provider" / Arabic equivalents).

export interface PrivacyNameInput {
  firstName?: string | null;
  lastName?: string | null;
  /** Used when structured first/last aren't available (split on space). */
  displayName?: string | null;
}

export interface PrivacyNameOptions {
  /** Shown when no name is available. Never an email. Defaults to ''. */
  roleFallback?: string;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

// First grapheme of a token, as the initial. `Array.from` keeps
// multi-byte scripts (Arabic, emoji) intact rather than slicing a
// surrogate pair.
function initialOf(token: string): string {
  const chars = Array.from(token);
  return chars.length > 0 ? chars[0]! : '';
}

/**
 * Format a name as "<first-initial>. <last name>".
 *
 * - Prefers structured `firstName` / `lastName`.
 * - Else splits `displayName` on whitespace (first token = given name,
 *   last token = family name; middle names are dropped).
 * - Single name → just its initial + dot (no family name to reveal).
 * - No name → `roleFallback` (never an email).
 */
export function formatPrivacyDisplayName(
  input: PrivacyNameInput | null | undefined,
  options: PrivacyNameOptions = {},
): string {
  const fallback = clean(options.roleFallback);

  if (!input) return fallback;

  let first = clean(input.firstName);
  let last = clean(input.lastName);

  // Fall back to splitting the combined display name.
  if (!first && !last) {
    const tokens = clean(input.displayName)
      .split(' ')
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return fallback;
    if (tokens.length === 1) {
      const initial = initialOf(tokens[0]!);
      return initial ? `${initial}.` : fallback;
    }
    first = tokens[0]!;
    last = tokens[tokens.length - 1]!;
  }

  // Structured path: a lone first or last name.
  if (first && !last) {
    const initial = initialOf(first);
    return initial ? `${initial}.` : fallback;
  }
  if (!first && last) {
    // Only a family name on record — show it in full (nothing to mask).
    return last;
  }

  const initial = initialOf(first);
  return initial ? `${initial}. ${last}` : last;
}
