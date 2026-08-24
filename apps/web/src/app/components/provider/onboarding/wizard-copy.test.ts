import { describe, it, expect } from 'vitest';
import {
  PROVIDER_ONBOARDING_FIELDS,
  PROVIDER_ONBOARDING_STEPS,
} from '@homeservicemarketplace/contracts';

import {
  DAY_LABELS,
  ISSUE_COPY,
  STEP_HINTS,
  STEP_TITLES,
  TRANSPORT_LABELS,
  UI,
  issueText,
  minuteToTime,
  timeToMinute,
} from './wizard-copy';

// Sprint 8 — translation parity.
//
// This is the only way an untranslated string gets caught before an Arabic
// reader sees an English label. Eyeballing a 200-key map does not work, and
// the failure is silent: the app renders, nothing errors, and half the
// audience reads the wrong language on one screen.

describe('every copy map covers both languages identically', () => {
  it.each([
    ['UI', UI],
    ['STEP_TITLES', STEP_TITLES],
    ['STEP_HINTS', STEP_HINTS],
    ['ISSUE_COPY', ISSUE_COPY],
    ['TRANSPORT_LABELS', TRANSPORT_LABELS],
  ])('%s has the same keys in en and ar', (_name, map) => {
    const en = Object.keys((map as Record<string, object>).en).sort();
    const ar = Object.keys((map as Record<string, object>).ar).sort();
    expect(ar).toEqual(en);
  });

  it.each([
    ['UI', UI],
    ['STEP_TITLES', STEP_TITLES],
    ['STEP_HINTS', STEP_HINTS],
    ['ISSUE_COPY', ISSUE_COPY],
    ['TRANSPORT_LABELS', TRANSPORT_LABELS],
  ])('%s has no empty or placeholder Arabic value', (_name, map) => {
    for (const [key, value] of Object.entries((map as Record<string, Record<string, string>>).ar)) {
      expect(value.trim().length, `ar.${key} is empty`).toBeGreaterThan(0);
      // A value identical to its English counterpart is the usual shape of
      // "translated later" — the developer pasted the English in to make the
      // types happy and never came back.
      const english = (map as Record<string, Record<string, string>>).en[key];
      expect(value, `ar.${key} is still the English string`).not.toBe(english);
    }
  });

  it('names every wizard step in both languages', () => {
    for (const step of PROVIDER_ONBOARDING_STEPS) {
      expect(STEP_TITLES.en[step]).toBeTruthy();
      expect(STEP_TITLES.ar[step]).toBeTruthy();
      expect(STEP_HINTS.en[step]).toBeTruthy();
      expect(STEP_HINTS.ar[step]).toBeTruthy();
    }
  });

  it('has copy for every requirement the server can report', () => {
    // The blockers are the part that matters. Chrome in Arabic with English
    // blockers is the usual half-done translation, and it leaves an Arabic
    // reader unable to work out why Submit is dead.
    const uncovered = PROVIDER_ONBOARDING_FIELDS.filter(
      (field) =>
        !Object.keys(ISSUE_COPY.en).some((key) => key.startsWith(`${field}:`)) ||
        !Object.keys(ISSUE_COPY.ar).some((key) => key.startsWith(`${field}:`)),
    );
    expect(uncovered).toEqual([]);
  });

  it('gives seven day names in each language', () => {
    expect(DAY_LABELS.en).toHaveLength(7);
    expect(DAY_LABELS.ar).toHaveLength(7);
  });
});

describe('issueText', () => {
  it('renders the copy for a known field and code', () => {
    expect(issueText('en', 'bio', 'REQUIRED')).toMatch(/description/i);
    expect(issueText('ar', 'bio', 'REQUIRED')).toMatch(/وصف/);
  });

  it('falls back to a generic line rather than leaking a wire code', () => {
    // A server that adds a rule before the client ships its copy would
    // otherwise show "someNewField:REQUIRED" to a provider — meaningless, and
    // a small leak of internal field names.
    const text = issueText('en', 'bio', 'SOME_FUTURE_CODE');
    expect(text).not.toMatch(/bio:/);
    expect(text).toMatch(/still needs completing/i);
  });

  it('falls back in Arabic too', () => {
    const text = issueText('ar', 'bio', 'SOME_FUTURE_CODE');
    expect(text).toMatch(/تحتاج/);
    expect(text).not.toMatch(/bio/);
  });
});

describe('time conversion', () => {
  it.each([
    [0, '00:00'],
    [540, '09:00'],
    [1439, '23:59'],
    // The end of a window is EXCLUSIVE, so "until 24:00" is the right reading.
    // "00:00" would read as the start of the day it is actually the end of.
    [1440, '24:00'],
  ])('renders %i as %s', (minute, expected) => {
    expect(minuteToTime(minute)).toBe(expected);
  });

  it.each([
    ['09:00', 540],
    ['00:00', 0],
    ['24:00', 1440],
    ['9:05', 545],
  ])('parses %s as %i', (value, expected) => {
    expect(timeToMinute(value)).toBe(expected);
  });

  it.each(['', 'nonsense', '25:00', '09:70', '09', '09:0'])('rejects %p', (value) => {
    // null rather than NaN, so an unparseable value cannot travel into a
    // payload and become a database error a long way from here.
    expect(timeToMinute(value)).toBeNull();
  });

  it('round-trips every minute of the day', () => {
    for (let minute = 0; minute <= 1440; minute += 1) {
      expect(timeToMinute(minuteToTime(minute))).toBe(minute);
    }
  });
});
