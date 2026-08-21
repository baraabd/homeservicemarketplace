import { describe, it, expect } from 'vitest';

import { getBotReply } from './HelpSupportPage';

// Sprint 01 hardening — the in-app support bot must not promise payment
// or refund behaviour the platform does not implement. The provider
// wallet/earnings surfaces are display-only ledgers ("no payouts, no
// withdrawals"), and there is no payment processor or automated refund
// flow: payment is arranged directly between the customer and the
// professional. These tests pin that the FAQ copy (EN + AR) stops
// over-promising, in pure form so a future re-skin can't silently
// reintroduce the claims.

const PAID_Q = 'When do pros get paid?';
const SATISFIED_Q = "What if I'm not satisfied?";

describe('HelpSupportPage getBotReply — no over-promised payment/refund copy', () => {
  it('the "paid" reply no longer promises 24h payouts or secure bank transfers (EN)', () => {
    const reply = getBotReply(PAID_Q, 'en');
    expect(reply).not.toMatch(/bank transfer/i);
    expect(reply).not.toMatch(/within 24 hours/i);
    // States the real model: payment is handled directly, not by FixNow.
    expect(reply).toMatch(/direct/i);
  });

  it('the "paid" reply no longer promises bank transfers (AR)', () => {
    const reply = getBotReply(PAID_Q, 'ar');
    expect(reply).not.toMatch(/تحويلات بنكية/);
    expect(reply).not.toMatch(/24 ساعة/);
  });

  it('the "satisfied" reply no longer promises a full refund (EN)', () => {
    const reply = getBotReply(SATISFIED_Q, 'en');
    expect(reply).not.toMatch(/full refund/i);
    // Points at the real path: contact support / open a dispute.
    expect(reply).toMatch(/support|dispute/i);
  });

  it('the "satisfied" reply no longer promises a full refund (AR)', () => {
    const reply = getBotReply(SATISFIED_Q, 'ar');
    expect(reply).not.toMatch(/استرداداً كاملاً/);
  });

  it('still answers the other FAQs unchanged (cancel + price)', () => {
    expect(getBotReply('How do I cancel a booking?', 'en')).toMatch(/cancel/i);
    expect(getBotReply('How is the price calculated?', 'en')).toMatch(/rate|estimate/i);
  });
});
