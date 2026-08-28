import { describe, it, expect } from 'vitest';
import type { ProviderOnboardingHubTask } from '@homeservicemarketplace/contracts';
import { PROVIDER_ONBOARDING_HUB_GROUPS } from '@homeservicemarketplace/contracts';

import {
  SCREEN_COPY,
  groupLabel,
  nextActionLabel,
  progressLabel,
  statusExplanation,
  statusLabel,
  taskCopy,
  type Lang,
} from './onboarding-hub-copy';

// Sprint 9B.16 — the copy bundle.
//
// The point of these tests is PARITY. A missing Arabic string does not crash
// anything; it silently renders English inside an RTL layout, which is exactly
// the class of defect nobody notices until a user reports it.

const LANGS: Lang[] = ['en', 'ar'];

const TASK_IDS = [
  'BASICS_IDENTITY',
  'SERVICES_EXPERIENCE',
  'WORK_AREA',
  'WORKING_HOURS',
  'PORTFOLIO',
  'REVIEW_SUBMISSION',
];

const task = (over: Partial<ProviderOnboardingHubTask> = {}): ProviderOnboardingHubTask => ({
  id: 'BASICS_IDENTITY',
  group: 'BASICS',
  status: 'AVAILABLE',
  title: 'server title',
  description: 'server description',
  ...over,
});

describe('task copy', () => {
  it.each(LANGS)('has a title and a description for all six tasks in %s', (lang) => {
    for (const id of TASK_IDS) {
      const copy = taskCopy(task({ id, title: 'FALLBACK', description: 'FALLBACK' }), lang);
      expect(copy.title, `${id} title in ${lang}`).not.toBe('FALLBACK');
      expect(copy.description, `${id} description in ${lang}`).not.toBe('FALLBACK');
      expect(copy.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('renders DIFFERENT prose per language for the same task', () => {
    // The regression this guards: rendering the server's single-language
    // `title` verbatim, which shows an English reader Arabic.
    const en = taskCopy(task(), 'en');
    const ar = taskCopy(task(), 'ar');
    expect(en.title).not.toBe(ar.title);
  });

  it('falls back to the server strings for a task it has never heard of', () => {
    const copy = taskCopy(
      task({ id: 'TASK_FROM_A_NEWER_SERVER', title: 'From server', description: 'Also server' }),
      'en',
    );
    expect(copy).toEqual({ title: 'From server', description: 'Also server' });
  });
});

describe('group labels', () => {
  it.each(LANGS)('names every group in the contract in %s', (lang) => {
    for (const group of PROVIDER_ONBOARDING_HUB_GROUPS) {
      const label = groupLabel(group, lang);
      expect(label, `${group} in ${lang}`).toBeTruthy();
      expect(label).not.toBe(group);
    }
  });
});

describe('status labels and explanations', () => {
  it.each(LANGS)('labels all four statuses in %s', (lang) => {
    for (const status of ['COMPLETE', 'AVAILABLE', 'WAITING', 'BLOCKED']) {
      expect(statusLabel(status, lang)).not.toBe(status);
    }
  });

  it.each(LANGS)('explains the two non-actionable states in %s, and only those', (lang) => {
    // A row the provider cannot press must say why. A row they CAN press
    // needs no excuse — and offering one would be noise on every row.
    expect(statusExplanation('WAITING', lang)).toBeTruthy();
    expect(statusExplanation('BLOCKED', lang)).toBeTruthy();
    expect(statusExplanation('AVAILABLE', lang)).toBeNull();
    expect(statusExplanation('COMPLETE', lang)).toBeNull();
  });

  it('falls back to the raw code for an unknown status rather than rendering nothing', () => {
    expect(statusLabel('SOMETHING_NEW', 'en')).toBe('SOMETHING_NEW');
    expect(statusExplanation('SOMETHING_NEW', 'en')).toBeNull();
  });
});

describe('progress label', () => {
  it('is a COUNT, and includes both numbers the server sent', () => {
    expect(progressLabel(3, 6, 'en')).toBe('3 of 6 complete');
    expect(progressLabel(3, 6, 'ar')).toContain('3');
    expect(progressLabel(3, 6, 'ar')).toContain('6');
  });

  it('never renders a percent sign — the hub counts tasks, it does not measure them', () => {
    expect(progressLabel(3, 6, 'en')).not.toContain('%');
    expect(progressLabel(3, 6, 'ar')).not.toContain('%');
  });

  it('renders the zero and the finished cases without special-casing', () => {
    expect(progressLabel(0, 6, 'en')).toBe('0 of 6 complete');
    expect(progressLabel(6, 6, 'en')).toBe('6 of 6 complete');
  });
});

describe('screen copy', () => {
  it.each(LANGS)('covers every view state in %s with a non-empty title', (lang) => {
    for (const [state, copy] of Object.entries(SCREEN_COPY[lang])) {
      expect(copy.title, `${state} in ${lang}`).toBeTruthy();
    }
  });

  it('gives the states a provider can act on a CTA, and the others none', () => {
    expect(SCREEN_COPY.en.ERROR.cta).toBeTruthy();
    expect(SCREEN_COPY.en.UNAUTHORIZED.cta).toBeTruthy();
    // Nothing to press while an application sits in a queue.
    expect(SCREEN_COPY.en.ACTION_REQUIRED.cta).toBeNull();
  });
});

describe('next-action label', () => {
  it.each(LANGS)('labels the two actionable kinds in %s', (lang) => {
    expect(nextActionLabel('COMPLETE_TASK', lang)).toBeTruthy();
    expect(nextActionLabel('SUBMIT', lang)).toBeTruthy();
  });

  it('gives AWAIT_REVIEW and NONE no button', () => {
    expect(nextActionLabel('AWAIT_REVIEW', 'en')).toBeNull();
    expect(nextActionLabel('NONE', 'en')).toBeNull();
  });

  it('gives an unknown kind no button rather than a guessed one', () => {
    expect(nextActionLabel('TELEPORT', 'en')).toBeNull();
  });
});
