import { readOnboardingFeedback } from './provider-onboarding-feedback';

describe('provider feedback privacy boundary', () => {
  const item = {
    id: 'change-1',
    taskId: 'PORTFOLIO',
    field: 'bio',
    itemId: 'item-1',
    reasonCode: 'INCOMPLETE',
    providerMessage: 'Please describe the completed work.',
  };

  it('projects only public instructions and drops internal metadata', () => {
    expect(
      readOnboardingFeedback({
        requestedAt: '2026-09-15T09:00:00.000Z',
        internalNote: 'internal-only',
        items: [{ ...item, adminEmail: 'reviewer@example.test', storageKey: 'private/identity' }],
      }),
    ).toEqual({ requestedAt: '2026-09-15T09:00:00.000Z', items: [item] });
  });

  it.each([null, {}, [], { items: [item] }, { requestedAt: '2026-09-15', items: [] }])(
    'does not invent instructions from an absent or malformed legacy value: %p',
    (value) => {
      expect(readOnboardingFeedback(value)).toBeNull();
    },
  );

  it('ignores invalid task instructions while preserving valid instructions', () => {
    const feedback = readOnboardingFeedback({
      requestedAt: '2026-09-15',
      items: [{ ...item, taskId: 'ADMIN_SECURITY' }, { ...item, providerMessage: null }, item],
    });
    expect(feedback?.items).toEqual([item]);
  });
});
