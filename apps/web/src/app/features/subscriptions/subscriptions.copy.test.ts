import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_COPY } from './subscriptions.copy';

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') {
    expect(value.trim().length).toBeGreaterThan(0);
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe('My Plan Arabic and English coverage', () => {
  it('has nonempty, complete key parity including every server state', () => {
    expect(leafKeys(SUBSCRIPTION_COPY.ar)).toEqual(leafKeys(SUBSCRIPTION_COPY.en));
    expect(Object.keys(SUBSCRIPTION_COPY.en.states).sort()).toEqual([
      'ACTION_REQUIRED',
      'ACTIVE',
      'CANCELLED',
      'EXPIRED',
      'FAILED',
      'NONE',
      'PENDING_PAYMENT',
      'SCHEDULED',
      'SUSPENDED',
    ]);
  });

  it('keeps payment, subscription access and identity/work eligibility distinct in both languages', () => {
    expect(SUBSCRIPTION_COPY.en.authority).toContain('does not verify your identity');
    expect(SUBSCRIPTION_COPY.ar.authority).toContain('لا يوثّق هويتك');
    expect(SUBSCRIPTION_COPY.en.paymentPending).toContain('does not confirm');
    expect(SUBSCRIPTION_COPY.ar.paymentPending).toContain('لا تؤكد نجاحه');
  });
});
