import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  ProviderAutosaveIndicator,
  ProviderButton,
  ProviderChoiceCard,
  ProviderErrorSummary,
  ProviderNotice,
  ProviderProgress,
  ProviderStatusBadge,
  ProviderStatusTimeline,
  ProviderTaskRow,
  ProviderTextInput,
  toneForTaskStatus,
} from './index';

// The provider design system's contract.
//
// These test SEMANTICS, not appearance: which element a control actually is,
// what it announces, and what it associates. Those are the properties that
// decide whether the surface is operable by keyboard and legible to a screen
// reader — and they are exactly what got re-derived slightly differently on
// each of the six task screens before the library existed.

describe('status vocabulary', () => {
  it('maps the server task statuses to tones', () => {
    expect(toneForTaskStatus('COMPLETE')).toBe('done');
    expect(toneForTaskStatus('AVAILABLE')).toBe('todo');
    expect(toneForTaskStatus('BLOCKED')).toBe('blocked');
    expect(toneForTaskStatus('WAITING')).toBe('waiting');
  });

  it('falls back to todo for a status the client has never heard of', () => {
    // A server that adds a status must not blank the row.
    expect(toneForTaskStatus('SOMETHING_NEW')).toBe('todo');
  });

  it('AVAILABLE is not the accent tone', () => {
    // Most of the list is outstanding. Painting all of it in the accent colour
    // leaves nothing for the one action we want pressed.
    expect(toneForTaskStatus('AVAILABLE')).not.toBe('accent');
  });
});

describe('ProviderButton', () => {
  it('meets the WCAG 2.2 target size', () => {
    render(<ProviderButton>Save</ProviderButton>);
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('min-h-[44px]');
  });

  it('sizes to content by default, and fills only when asked', () => {
    // The default is `auto` because once the phone frame came off, a w-full
    // primary became a 768px-wide button on desktop.
    const { rerender } = render(<ProviderButton>Continue</ProviderButton>);
    expect(screen.getByRole('button').className).not.toContain('w-full');
    rerender(<ProviderButton size="block">Continue</ProviderButton>);
    expect(screen.getByRole('button').className).toContain('w-full');
  });

  it('is a real button element, so Enter and Space work without handlers', () => {
    render(<ProviderButton>Go</ProviderButton>);
    expect(screen.getByRole('button', { name: 'Go' }).tagName).toBe('BUTTON');
  });
});

describe('ProviderStatusBadge', () => {
  it('carries a WORD, not only a colour', () => {
    render(<ProviderStatusBadge tone="waiting" label="With us" />);
    expect(screen.getByText('With us')).toBeInTheDocument();
  });
});

describe('ProviderTaskRow', () => {
  it('is a button when it leads somewhere', () => {
    render(
      <ProviderTaskRow
        id="WORK_AREA"
        title="Work area"
        status="AVAILABLE"
        statusLabel="To do"
        onOpen={() => {}}
      />,
    );
    const row = screen.getByTestId('task-row-WORK_AREA');
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveAttribute('data-status', 'AVAILABLE');
  });

  it('is NOT a button when it does not', () => {
    // A locked or completed row rendered as a button gives a keyboard user a
    // stop that does nothing when pressed.
    render(<ProviderTaskRow id="REVIEW" title="Review" status="BLOCKED" statusLabel="Locked" />);
    const row = screen.getByTestId('task-row-REVIEW');
    expect(row.tagName).not.toBe('BUTTON');
    expect(row).toHaveAttribute('data-actionable', 'false');
  });

  it('shows the reason a blocked task cannot be opened', () => {
    render(
      <ProviderTaskRow
        id="REVIEW"
        title="Review"
        status="BLOCKED"
        statusLabel="Locked"
        explanation="Finish the tasks above first."
      />,
    );
    expect(screen.getByText('Finish the tasks above first.')).toBeInTheDocument();
  });

  it('names the status in its accessible name', () => {
    render(
      <ProviderTaskRow
        id="PORTFOLIO"
        title="Portfolio"
        status="AVAILABLE"
        statusLabel="To do"
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Portfolio — To do' })).toBeInTheDocument();
  });
});

describe('ProviderNotice', () => {
  it('states the specific problem and offers the way to it', () => {
    // The component this replaces rendered a real consent requirement as
    // "Something here still needs attention".
    const onAction = vi.fn();
    render(
      <ProviderNotice
        title="Agree to the terms to submit"
        description="You have not accepted version v1."
        actionLabel="Review terms"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('Agree to the terms to submit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review terms' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('announces a danger notice as an alert', () => {
    render(<ProviderNotice tone="danger" title="Submission failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Submission failed');
  });
});

describe('ProviderProgress', () => {
  it('reports the SERVER count, not a client percentage', () => {
    render(<ProviderProgress complete={2} total={6} label="2 of 6 complete" />);
    const bar = screen.getByRole('progressbar', { name: '2 of 6 complete' });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '6');
  });

  it('does not divide by zero before the server has answered', () => {
    render(<ProviderProgress complete={0} total={0} label="Loading" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '0');
  });
});

describe('ProviderTextInput', () => {
  it('associates label, hint and control', () => {
    render(<ProviderTextInput label="Display name" hint="Customers see this." />);
    const input = screen.getByLabelText('Display name');
    expect(input).toBeInTheDocument();
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Customers see this.');
  });

  it('marks the control invalid and describes it by the error', () => {
    render(<ProviderTextInput label="Phone" error="Enter a phone number." />);
    const input = screen.getByLabelText('Phone');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy!)).toHaveTextContent('Enter a phone number.');
  });

  it('uses a 16px control on touch so iOS does not zoom the form', () => {
    render(<ProviderTextInput label="City" />);
    expect(screen.getByLabelText('City').className).toContain('text-[16px]');
  });
});

describe('ProviderErrorSummary', () => {
  it('renders nothing when there is nothing wrong', () => {
    const { container } = render(<ProviderErrorSummary title="Fix these" errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces the failures and links to each field', () => {
    const onSelect = vi.fn();
    render(
      <ProviderErrorSummary
        title="Fix 2 things"
        errors={[
          { id: 'bio', message: 'Add a short bio.' },
          { id: 'phone', message: 'Enter a phone number.' },
        ]}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Fix 2 things');
    fireEvent.click(screen.getByRole('button', { name: 'Add a short bio.' }));
    expect(onSelect).toHaveBeenCalledWith('bio');
  });
});

describe('ProviderChoiceCard', () => {
  it('is driven by a real radio, so the platform owns selection', () => {
    const onSelect = vi.fn();
    render(
      <ProviderChoiceCard
        name="providerType"
        value="INDIVIDUAL"
        checked={false}
        onSelect={onSelect}
        title="Individual"
      />,
    );
    const radio = screen.getByRole('radio', { name: /Individual/ });
    expect(radio).not.toBeChecked();
    fireEvent.click(radio);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('ProviderAutosaveIndicator', () => {
  const labels = {
    idle: 'Saved',
    saving: 'Saving…',
    saved: 'Saved',
    offline: 'Not saved yet — keep this page open',
    error: 'Could not save',
  };

  it('announces politely', () => {
    render(<ProviderAutosaveIndicator state="saving" labels={labels} />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el).toHaveTextContent('Saving…');
  });

  it('stays pessimistic when offline', () => {
    // Pending edits are in memory. Saying otherwise is a lie the provider pays
    // for when the tab closes.
    render(<ProviderAutosaveIndicator state="offline" labels={labels} />);
    expect(screen.getByRole('status')).toHaveTextContent('keep this page open');
  });
});

describe('ProviderStatusTimeline', () => {
  it('is an ordered list, because the order is the meaning', () => {
    render(
      <ProviderStatusTimeline
        entries={[
          { id: 'submitted', title: 'Application sent', tone: 'done', at: '30 Aug' },
          { id: 'review', title: 'Being reviewed', tone: 'waiting', current: true },
        ]}
      />,
    );
    expect(screen.getByTestId('provider-timeline').tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
