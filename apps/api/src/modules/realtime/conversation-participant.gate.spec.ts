import { ProviderCapability } from '@homeservicemarketplace/contracts';

import { ConversationParticipantGate } from './conversation-participant.gate';

// R12 — who may receive a conversation's realtime events. The same answer the
// REST read routes give: a seeker-side participant needs only a live session
// (checked by the gateway); a provider-side participant must also be allowed
// to manage bookings, as /v1/provider/conversations requires.

function gate(participant: unknown, canManageBookings: boolean) {
  const participants = { findByConversationAndUser: jest.fn().mockResolvedValue(participant) };
  const capabilities = { can: jest.fn().mockResolvedValue(canManageBookings) };
  const g = new ConversationParticipantGate(
    {} as never,
    participants as never,
    {} as never,
    capabilities as never,
  );
  return { g, participants, capabilities };
}

describe('ConversationParticipantGate.mayReceiveConversation (R12)', () => {
  it('refuses someone who is not a participant', async () => {
    const { g, capabilities } = gate(null, true);
    await expect(g.mayReceiveConversation('u-x', 'c-1')).resolves.toEqual({ allowed: false });
    expect(capabilities.can).not.toHaveBeenCalled();
  });

  it('admits the seeker-side participant without a provider check (dual-role users acting as customers)', async () => {
    const { g, capabilities } = gate({ role: 'SEEKER', providerProfileId: null }, false);
    await expect(g.mayReceiveConversation('u-1', 'c-1')).resolves.toEqual({
      allowed: true,
      side: 'SEEKER',
    });
    expect(capabilities.can).not.toHaveBeenCalled();
  });

  it('admits the provider-side participant who may manage bookings', async () => {
    const { g, capabilities } = gate({ role: 'PROVIDER', providerProfileId: 'prof-9' }, true);
    await expect(g.mayReceiveConversation('u-2', 'c-1')).resolves.toEqual({
      allowed: true,
      side: 'PROVIDER',
      providerProfileId: 'prof-9',
    });
    expect(capabilities.can).toHaveBeenCalledWith('u-2', ProviderCapability.ManageBookings);
  });

  it('refuses the provider-side participant who may not (e.g. suspended)', async () => {
    const { g } = gate({ role: 'PROVIDER', providerProfileId: 'prof-9' }, false);
    await expect(g.mayReceiveConversation('u-2', 'c-1')).resolves.toEqual({ allowed: false });
  });
});
