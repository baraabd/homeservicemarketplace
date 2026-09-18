import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvailabilityTaskScreen } from '../provider-onboarding-v2/components/AvailabilityTaskScreen';
import { ProviderChoiceToggle } from './forms';

vi.mock('../provider-onboarding-v2/autosave/ProviderOnboardingAutosaveProvider', () => ({
  useOnboardingStepAutosave: () => ({
    isDirty: false,
    status: { kind: 'saved' },
    save: vi.fn(),
    flushAll: vi.fn().mockResolvedValue(undefined),
  }),
}));

afterEach(cleanup);

// Only the fields consumed by the rendered schedule. Real persistence and
// authorization remain the responsibility of the unchanged real-API suite.
const view = {
  version: 1,
  editable: true,
  data: {
    availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
    timezone: 'Asia/Damascus',
    resolvedTimezone: {
      resolved: 'Asia/Damascus',
      display: { city: 'Damascus', offset: 'UTC+3' },
      needsConfirmation: false,
    },
  },
} as unknown as ProviderOnboardingDraftView;

describe('selected Provider control foregrounds', () => {
  it.each(['en', 'ar'] as const)('%s days keep semantic contrast as selection changes', (lang) => {
    render(<AvailabilityTaskScreen view={view} lang={lang} editable />);
    const sunday = screen.getByTestId('day-toggle-0');
    const monday = screen.getByTestId('day-toggle-1');
    expect(sunday).toHaveAttribute('aria-pressed', 'true');
    expect(sunday).toHaveClass('text-white', 'dark:text-pv-bg');
    expect(monday).not.toHaveClass('dark:text-pv-bg');
    fireEvent.click(monday);
    expect(monday).toHaveAttribute('aria-pressed', 'true');
    expect(monday).toHaveClass('text-white', 'dark:text-pv-bg');
    fireEvent.click(sunday);
    expect(sunday).toHaveAttribute('aria-pressed', 'false');
    expect(sunday).toHaveClass('text-pv-text');
    expect(sunday).not.toHaveClass('dark:text-pv-bg');
  });

  it('does not change the selected or disabled state of a read-only week', () => {
    render(<AvailabilityTaskScreen view={view} lang="en" editable={false} />);
    const sunday = screen.getByTestId('day-toggle-0');
    expect(sunday).toBeDisabled();
    fireEvent.click(sunday);
    expect(sunday).toHaveAttribute('aria-pressed', 'true');
    expect(sunday).toHaveClass('dark:text-pv-bg');
  });

  it.each([true, false])('choice mark foreground follows checked=%s', (checked) => {
    render(<ProviderChoiceToggle checked={checked} onToggle={vi.fn()} label="Plumbing" testId="choice" />);
    const input = screen.getByRole('checkbox', { name: 'Plumbing' });
    expect(input).toHaveProperty('checked', checked);
    const mark = screen.getByTestId('choice').querySelector('span[aria-hidden="true"]');
    expect(mark).not.toBeNull();
    if (checked) expect(mark).toHaveClass('text-white', 'dark:text-pv-bg');
    else expect(mark).not.toHaveClass('dark:text-pv-bg');
  });
});
