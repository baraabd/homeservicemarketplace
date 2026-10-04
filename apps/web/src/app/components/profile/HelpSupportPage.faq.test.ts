import { describe, expect, it } from 'vitest';

import { HELP_FAQS } from './HelpSupportPage';

describe('HelpSupportPage static FAQ — no fabricated support behaviour', () => {
  it('keeps FAQ answers as static content instead of support-agent messages', () => {
    expect(HELP_FAQS).toHaveLength(3);
    expect(HELP_FAQS.every((faq) => faq.en && faq.ar && faq.answerEn && faq.answerAr)).toBe(true);
  });

  it('does not promise bank transfers, 24-hour payouts, refunds, or a response SLA', () => {
    const all = JSON.stringify(HELP_FAQS);
    expect(all).not.toMatch(/bank transfer|within 24 hours|full refund|under 5 minutes/i);
    expect(all).not.toMatch(/تحويلات بنكية|24 ساعة|استرداداً كاملاً|أقل من 5 دقائق/);
  });

  it('describes the existing payment and dispute boundaries honestly', () => {
    const all = HELP_FAQS.map((faq) => faq.answerEn).join(' ');
    expect(all).toMatch(/does not process or hold customer funds/i);
    expect(all).toMatch(/dispute flow/i);
  });
});
