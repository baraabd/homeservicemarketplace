import { describe, expect, it } from 'vitest';
import {
  AMOUNT_LABELS,
  CONFIRMATION_LABELS,
  EXCEPTION_LABELS,
  financialStatusLabel,
  FINANCIAL_OPERATIONS_COPY,
  RECORD_KINDS,
  RECORD_LABELS,
} from './financial-operations.copy';

describe('financial operations bilingual semantics', () => {
  it('has complete English/Arabic copy parity', () => {
    expect(Object.keys(FINANCIAL_OPERATIONS_COPY.en).sort()).toEqual(
      Object.keys(FINANCIAL_OPERATIONS_COPY.ar).sort(),
    );
    for (const group of [RECORD_LABELS, AMOUNT_LABELS, CONFIRMATION_LABELS, EXCEPTION_LABELS]) {
      expect(Object.keys(group.en).sort()).toEqual(Object.keys(group.ar).sort());
      for (const value of Object.values(group.ar)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });
  it.each(['en', 'ar'] as const)('names every supported read kind in %s', (lang) => {
    for (const kind of RECORD_KINDS) expect(RECORD_LABELS[lang][kind]).toBeTruthy();
    expect(new Set(RECORD_KINDS).size).toBe(6);
  });
  it('does not equate unmeasured reconciliation with zero or subscription payments with earnings', () => {
    expect(FINANCIAL_OPERATIONS_COPY.en.reconciliationNotRun).toContain('not been measured');
    expect(FINANCIAL_OPERATIONS_COPY.en.reconciliationUnavailable).toContain(
      'does not establish zero',
    );
    expect(FINANCIAL_OPERATIONS_COPY.en.scopeNote).toContain('separate from booking prices');
    expect(FINANCIAL_OPERATIONS_COPY.en.accessNote).toContain('does not verify identity');
  });
  it('localizes incomplete payment states and preserves an unknown server state', () => {
    expect(financialStatusLabel('PENDING_PAYMENT', 'en')).toBe('Awaiting payment');
    expect(financialStatusLabel('PENDING_PAYMENT', 'ar')).toBe('بانتظار الدفع');
    expect(financialStatusLabel('PROCESSING', 'ar')).toBe('قيد المعالجة');
    expect(financialStatusLabel('SUSPENDED', 'ar')).toBe('موقوف');
    expect(financialStatusLabel('FUTURE_SERVER_STATE', 'ar')).toBe('FUTURE_SERVER_STATE');
  });
});
