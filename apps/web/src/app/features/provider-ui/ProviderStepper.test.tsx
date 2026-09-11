import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ProviderStepper } from './forms';

// Sprint 09B.29 Phase 5 — the stepper on its own terms.
//
// The approved experience screen replaced a numeric field with `−` and `+`,
// and its own help text says why: it avoids typing errors. That only holds if
// the replacement is genuinely operable — by keyboard, by screen reader, and
// by a thumb — so the control is tested here rather than only through the
// screen that happens to use it first.

function Harness({
  initial = 5,
  min = 0,
  max = 10,
  disabled = false,
}: {
  initial?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ProviderStepper
      label="Years of experience"
      hint="Use + and − to avoid typing errors."
      value={value}
      min={min}
      max={max}
      decreaseLabel="Decrease years of experience"
      increaseLabel="Increase years of experience"
      onChange={setValue}
      disabled={disabled}
      testId="years"
    />
  );
}

describe('ProviderStepper — accessible names and semantics', () => {
  it('gives each button a name, so neither is announced as just "button"', () => {
    render(<Harness />);

    expect(
      screen.getByRole('button', { name: 'Decrease years of experience' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Increase years of experience' }),
    ).toBeInTheDocument();
  });

  it('is one labelled group, so the number is never read as a bare digit', () => {
    render(<Harness />);

    const group = screen.getByRole('group', { name: 'Years of experience' });
    expect(within(group).getByTestId('years-value')).toHaveTextContent('5');
  });

  it('reports the value through <output>, which announces its own changes', () => {
    const { container } = render(<Harness />);

    const output = container.querySelector('output');
    expect(output).not.toBeNull();
    expect(output).toHaveTextContent('5');
  });

  it('associates the hint with the group', () => {
    render(<Harness />);

    const group = screen.getByRole('group', { name: 'Years of experience' });
    const describedBy = group.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      'Use + and − to avoid typing errors.',
    );
  });
});

describe('ProviderStepper — operation', () => {
  it('increments and decrements', () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId('years-increase'));
    expect(screen.getByTestId('years-value')).toHaveTextContent('6');

    fireEvent.click(screen.getByTestId('years-decrease'));
    expect(screen.getByTestId('years-value')).toHaveTextContent('5');
  });

  it('is operable by keyboard alone, because the buttons are real buttons', () => {
    render(<Harness />);

    const increase = screen.getByTestId('years-increase');
    increase.focus();
    expect(increase).toHaveFocus();

    // A <button> activates on both Enter and Space natively; firing a click is
    // what the browser does for each. The point being asserted is that the
    // control is a focusable button rather than a div with a handler.
    expect(increase.tagName).toBe('BUTTON');
    expect(increase).toHaveAttribute('type', 'button');
  });

  it('stops at its bounds instead of running past them', () => {
    render(<Harness initial={10} max={10} />);

    const increase = screen.getByTestId('years-increase');
    expect(increase).toBeDisabled();

    fireEvent.click(increase);
    expect(screen.getByTestId('years-value')).toHaveTextContent('10');
  });

  it('disables the decrease button at the floor, which is announced and unfocusable', () => {
    render(<Harness initial={0} min={0} />);

    const decrease = screen.getByTestId('years-decrease');
    expect(decrease).toBeDisabled();
    // A press that silently does nothing is worse than a control that says it
    // cannot be pressed.
    fireEvent.click(decrease);
    expect(screen.getByTestId('years-value')).toHaveTextContent('0');
  });

  it('never emits a value outside its bounds even if pressed at the edge', () => {
    const onChange = vi.fn();
    render(
      <ProviderStepper
        label="Years"
        value={0}
        min={0}
        max={3}
        decreaseLabel="Decrease"
        increaseLabel="Increase"
        onChange={onChange}
        testId="b"
      />,
    );

    fireEvent.click(screen.getByTestId('b-increase'));
    expect(onChange).toHaveBeenCalledWith(1);
    expect(onChange.mock.calls.every((call) => Number(call[0]) >= 0 && Number(call[0]) <= 3)).toBe(
      true,
    );
  });

  it('disables both buttons when the whole control is disabled', () => {
    render(<Harness disabled />);

    expect(screen.getByTestId('years-increase')).toBeDisabled();
    expect(screen.getByTestId('years-decrease')).toBeDisabled();
  });
});

describe('ProviderStepper — geometry and direction', () => {
  it('gives both buttons a 44px touch target', () => {
    render(<Harness />);

    // h-11/w-11 is Tailwind's 2.75rem = 44px, the mandated minimum. Asserted
    // on the class because jsdom computes no layout; the rendered size is
    // checked in the browser matrix.
    for (const id of ['years-increase', 'years-decrease']) {
      const button = screen.getByTestId(id);
      expect(button.className).toContain('h-11');
      expect(button.className).toContain('w-11');
    }
  });

  it('uses no physical left/right classes, so RTL mirrors without a second rule', () => {
    const { container } = render(<Harness />);

    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
  });

  it('carries no animation for reduced-motion to have to suppress', () => {
    const { container } = render(<Harness />);

    expect(container.innerHTML).not.toContain('animate-');
    expect(container.innerHTML).not.toContain('transition-');
  });
});
