import {
  ADMIN_SETTINGS_SCHEMA,
  type AdminSettingFieldSchema,
} from '@homeservicemarketplace/contracts';

import { AppError } from '../../../shared/errors/app-error';
import { DISPUTE_INTAKE_SETTING, parseIntakePolicy } from '../../disputes/dispute-intake.policy';
import { WORKSPACE_SETTING, workspacePolicy } from '../../disputes/workspace/workspace.policy';
import {
  parseSupportedMarkets,
  SUPPORTED_MARKETS_SETTING,
} from '../../provider/onboarding/market/supported-market';

// R17-D (D-1) — the ONE server-side authority for which platform settings an
// admin may write, and what a valid value is.
//
// Two kinds of entry:
//
//   • scalar — the typed, range-checked fields of ADMIN_SETTINGS_SCHEMA (the
//     Settings screen).
//   • policy — structured operator settings consumed by a domain that already
//     owns a parser for them. The registry validates with THAT parser, so the
//     value an admin writes is the value the consumer accepts. There is no
//     second schema to drift.
//
// A key that is not here fails closed. This is a Map, not an object: a key
// such as `__proto__` or `constructor` is an ordinary missing entry, never a
// property lookup.

type PolicyEntry = {
  kind: 'policy';
  key: string;
  /** True when the consumer's own parser accepts the value. */
  accepts: (value: unknown) => boolean;
};
type ScalarEntry = { kind: 'scalar'; key: string; field: AdminSettingFieldSchema };
export type SettingEntry = ScalarEntry | PolicyEntry;

const acceptsMarkets = (value: unknown): boolean => {
  try {
    parseSupportedMarkets(value);
    return true;
  } catch {
    return false;
  }
};

const REGISTRY: ReadonlyMap<string, SettingEntry> = new Map<string, SettingEntry>([
  ...ADMIN_SETTINGS_SCHEMA.map(
    (field) => [field.key, { kind: 'scalar', key: field.key, field }] as const,
  ),
  [
    DISPUTE_INTAKE_SETTING,
    { kind: 'policy', key: DISPUTE_INTAKE_SETTING, accepts: (v) => parseIntakePolicy(v) !== null },
  ],
  [
    WORKSPACE_SETTING,
    { kind: 'policy', key: WORKSPACE_SETTING, accepts: (v) => workspacePolicy(v) !== null },
  ],
  [
    SUPPORTED_MARKETS_SETTING,
    { kind: 'policy', key: SUPPORTED_MARKETS_SETTING, accepts: acceptsMarkets },
  ],
]);

/** The entry for `key`, or a 400. Never a property lookup on user input. */
export function settingEntry(key: string): SettingEntry {
  const entry = REGISTRY.get(key);
  if (!entry) throw new AppError('VALIDATION_ERROR', 'Unknown setting.', 400);
  return entry;
}

/**
 * A scalar setting that no product code reads (`inEffect: false`) is shown but
 * cannot be changed: writing it would report a change the platform never makes.
 */
export function assertWritable(entry: SettingEntry): void {
  if (entry.kind === 'scalar' && entry.field.inEffect === false)
    throw new AppError(
      'VALIDATION_ERROR',
      'This setting is not used by the platform and cannot be changed.',
      400,
    );
}

/** Validate and normalise a value for `entry`; throws a 400 when it is invalid. */
export function validateSettingValue(entry: SettingEntry, value: unknown): unknown {
  if (entry.kind === 'policy') {
    if (!entry.accepts(value))
      throw new AppError('VALIDATION_ERROR', `\`${entry.key}\` is not a valid policy value.`, 400);
    return value;
  }
  return validateScalar(entry.field, value);
}

/** RFC 5321 caps a forward path at 254 characters. */
const EMAIL_MAX = 254;
const STRING_MAX = 1000;

function validateScalar(field: AdminSettingFieldSchema, value: unknown): unknown {
  switch (field.type) {
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value))
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be an integer.`, 400);
      if (field.min !== undefined && value < field.min)
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be ≥ ${field.min}.`, 400);
      if (field.max !== undefined && value > field.max)
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be ≤ ${field.max}.`, 400);
      return value;
    }
    case 'string': {
      // Length is checked before any other work on the value.
      if (typeof value !== 'string' || value.length > STRING_MAX * 2)
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be a short string.`, 400);
      const trimmed = value.trim();
      if (trimmed.length === 0)
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must not be empty.`, 400);
      if (trimmed.length > STRING_MAX)
        throw new AppError(
          'VALIDATION_ERROR',
          `\`${field.key}\` exceeds ${STRING_MAX} chars.`,
          400,
        );
      return trimmed;
    }
    case 'boolean': {
      if (typeof value !== 'boolean')
        throw new AppError('VALIDATION_ERROR', `\`${field.key}\` must be true or false.`, 400);
      return value;
    }
    case 'email': {
      const normalised = typeof value === 'string' ? normaliseEmail(value) : null;
      if (!normalised)
        throw new AppError(
          'VALIDATION_ERROR',
          `\`${field.key}\` must be a valid email address.`,
          400,
        );
      return normalised;
    }
    case 'currency': {
      if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))
        throw new AppError(
          'VALIDATION_ERROR',
          `\`${field.key}\` must be an ISO-4217 3-letter uppercase code.`,
          400,
        );
      return value;
    }
    default: {
      const _exhaustive: never = field.type;
      void _exhaustive;
      throw new AppError('VALIDATION_ERROR', 'Unsupported setting type.', 400);
    }
  }
}

/**
 * R17-D (D-2) — a linear, bounded e-mail check instead of a backtracking
 * regex. The previous `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` was quadratic on input
 * such as `!@!.!.!.…@` and ran on values of any length.
 *
 * Shape only (one `@`, no whitespace, a dotted domain without empty labels);
 * deliverability is not this function's question.
 */
export function normaliseEmail(raw: string): string | null {
  if (raw.length > EMAIL_MAX * 2) return null;
  const value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > EMAIL_MAX) return null;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    // Reject any whitespace or control character.
    if (c <= 0x20 || c === 0x7f) return null;
  }
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return null;
  const domain = value.slice(at + 1);
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((label) => label.length === 0)) return null;
  return value;
}
