import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProviderServiceAreaExpansionView } from '@homeservicemarketplace/contracts';

import { ServiceAreaRewardCard } from './ServiceAreaRewardCard';
import { SERVICE_AREA_COPY } from '../copy/service-area-copy';

// Sprint 9B.20 — the reward card.
//
// Three things this file exists to hold still:
//
//   1. The card renders ONLY what the server sent. There is no eligibility
//      arithmetic in the component, so the tests drive it entirely by changing
//      the server's answer.
//   2. Withheld thresholds never reach the DOM. Not as text, not as an
//      attribute — the bundle a provider can read must not contain the number
//      they would need to game.
//   3. The copy promises nothing. "You will get more work" is a guarantee the
//      marketplace cannot keep.

const EN = SERVICE_AREA_COPY.en;

function view(over: Partial<ProviderServiceAreaExpansionView> = {}) {
  return {
    show: true,
    allowedMaxKm: 100,
    baseMaxKm: 100,
    currentTier: null,
    nextTier: { key: 'established', maxKm: 150 },
    progress: [
      {
        key: 'VERIFICATION' as const,
        met: false,
        progress: null,
        current: null,
        target: null,
        disclosed: true,
      },
      {
        key: 'COMPLETED_JOBS' as const,
        met: false,
        progress: 0.3,
        current: 3,
        target: 10,
        disclosed: true,
      },
      {
        key: 'CANCELLATION_RATE' as const,
        met: true,
        progress: null,
        current: null,
        target: null,
        disclosed: false,
      },
    ],
    reasonCodes: ['NO_TIER_YET' as const],
    policyVersion: '2026.08-sy-v1',
    ...over,
  };
}

function renderCard(over: Partial<ProviderServiceAreaExpansionView> = {}) {
  return render(<ServiceAreaRewardCard expansion={view(over)} copy={EN} />);
}

describe('whether the card appears at all', () => {
  it('renders nothing when the server says not to', () => {
    const { container } = renderCard({ show: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the server sent no expansion block at all', () => {
    // A cached draft, a rolling deploy, an older API. The screen the provider
    // is trying to finish must not go down over a field it did not get.
    const { container } = render(<ServiceAreaRewardCard expansion={undefined} copy={EN} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders when the server says to', () => {
    renderCard();
    expect(screen.getByTestId('expansion-reward-card')).toBeInTheDocument();
  });
});

describe('locked and unlocked are visibly different states', () => {
  it('is locked with no tier held', () => {
    renderCard();
    expect(screen.getByTestId('expansion-reward-card')).toHaveAttribute('data-state', 'locked');
    expect(screen.getByTestId('reward-title')).toHaveTextContent(EN.rewardLockedTitle);
  });

  it('is unlocked with a tier held, and names the ceiling it earned', () => {
    renderCard({ currentTier: { key: 'established', maxKm: 150 }, allowedMaxKm: 150 });
    expect(screen.getByTestId('expansion-reward-card')).toHaveAttribute('data-state', 'unlocked');
    expect(screen.getByTestId('reward-title')).toHaveTextContent('up to 150 km');
  });

  it('says so at the top of the ladder instead of going blank', () => {
    renderCard({
      currentTier: { key: 'wide', maxKm: 200 },
      nextTier: null,
      allowedMaxKm: 200,
    });
    expect(screen.getByTestId('reward-at-top')).toBeInTheDocument();
    expect(screen.queryByTestId('reward-next-tier')).not.toBeInTheDocument();
  });
});

describe('progress', () => {
  it('shows the disclosed numbers', () => {
    renderCard();
    expect(screen.getByTestId('reward-criterion-value-COMPLETED_JOBS')).toHaveTextContent(
      '3 of 10',
    );
  });

  it('renders a rating at one decimal place', () => {
    renderCard({
      progress: [
        {
          key: 'RATING',
          met: false,
          progress: null,
          current: 4.2,
          target: 4.5,
          disclosed: true,
        },
      ],
    });
    expect(screen.getByTestId('reward-criterion-value-RATING')).toHaveTextContent('4.2 of 4.5');
  });

  it('marks met and unmet with TEXT, not only with colour', () => {
    renderCard();
    const done = screen.getByTestId('reward-criterion-CANCELLATION_RATE');
    const notYet = screen.getByTestId('reward-criterion-VERIFICATION');
    expect(done).toHaveTextContent(EN.rewardMet);
    expect(notYet).toHaveTextContent(EN.rewardNotMet);
  });

  it('exposes met state as an attribute a test can hold still', () => {
    renderCard();
    expect(screen.getByTestId('reward-criterion-CANCELLATION_RATE')).toHaveAttribute(
      'data-met',
      'true',
    );
    expect(screen.getByTestId('reward-criterion-VERIFICATION')).toHaveAttribute(
      'data-met',
      'false',
    );
  });
});

describe('withheld thresholds', () => {
  it('states whether an anti-abuse criterion is satisfied but never its number', () => {
    renderCard();
    const row = screen.getByTestId('reward-criterion-CANCELLATION_RATE');
    expect(row).toHaveTextContent(EN.criterionNames.CANCELLATION_RATE!);
    expect(row).toHaveTextContent(EN.rewardMet);
    expect(
      screen.queryByTestId('reward-criterion-value-CANCELLATION_RATE'),
    ).not.toBeInTheDocument();
  });

  it('puts no digit at all in a withheld row', () => {
    // Stronger than "not the threshold": a withheld row carries NO number, so
    // there is nothing to infer one from. Scoped to the rows' text rather than
    // the whole markup, because the markup is full of unrelated numbers —
    // icon geometry, font sizes — and a regex over all of it would be a test
    // that fails for reasons nothing to do with disclosure.
    renderCard({
      progress: [
        {
          key: 'CANCELLATION_RATE',
          met: false,
          progress: null,
          current: null,
          target: null,
          disclosed: false,
        },
        {
          key: 'RESPONSE_TIME',
          met: false,
          progress: null,
          current: null,
          target: null,
          disclosed: false,
        },
      ],
    });
    for (const key of ['CANCELLATION_RATE', 'RESPONSE_TIME']) {
      const text = screen.getByTestId(`reward-criterion-${key}`).textContent ?? '';
      expect({ key, text, hasDigit: /\d/.test(text) }).toEqual({ key, text, hasDigit: false });
    }
  });
});

describe('the copy promises nothing', () => {
  it('qualifies the only benefit claim it makes', () => {
    renderCard();
    expect(screen.getByTestId('reward-benefit')).toHaveTextContent(
      'May help you appear to more nearby customers.',
    );
  });

  it('says out loud that the limit moved and the radius did not', () => {
    renderCard({ currentTier: { key: 'established', maxKm: 150 }, allowedMaxKm: 150 });
    expect(screen.getByTestId('reward-no-obligation')).toHaveTextContent('raises the limit only');
  });

  it.each(['en', 'ar'] as const)('makes no volume guarantee in %s', (lang) => {
    const copy = SERVICE_AREA_COPY[lang];
    const strings = [
      copy.rewardLockedTitle,
      copy.rewardUnlockedTitle(150),
      copy.rewardBenefit,
      copy.rewardNoObligation,
      copy.rewardNextTier(200),
      copy.rewardAtTop,
    ].join(' ');
    // The phrasings that would turn a permission into a promise.
    for (const forbidden of [
      /will (get|receive|increase)/i,
      /more (jobs|work|requests|bookings|income|earnings)/i,
      /guarantee/i,
      /المزيد من (الطلبات|العمل|الأعمال)/,
      /سوف تحصل/,
      /نضمن/,
    ]) {
      expect({ lang, forbidden: forbidden.source, matched: forbidden.test(strings) }).toEqual({
        lang,
        forbidden: forbidden.source,
        matched: false,
      });
    }
  });
});
