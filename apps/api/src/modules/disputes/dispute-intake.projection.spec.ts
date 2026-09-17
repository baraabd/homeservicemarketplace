import { participantSummary } from './dispute-intake.projection';
import type { IntakeCase } from './dispute-intake.repository';
const row = { id: 'di_case', bookingId: 'booking', openedById: 'owner', status: 'RESOLVED_REFUND', priority: 'URGENT', reason: 'private reason', description: 'internal-admin-note', resolution: 'private financial instructions', resolvedById: 'reviewer', createdAt: new Date('2026-09-17'), updatedAt: new Date('2026-09-17'), booking: { seekerUserId: 'owner', provider: { userId: 'provider' } } } as IntakeCase;
it('does not interpret a legacy resolution label as execution of a refund', () => { expect(participantSummary(row, 'owner').state).toBe('DECISION_RECORDED'); });
it('projects an exact minimal shape for participants, not an Admin DTO', () => {
  expect(participantSummary(row, 'provider')).toEqual({ id: 'di_case', reference: 'di_case', bookingId: 'booking', state: 'DECISION_RECORDED', role: 'PROVIDER', openedByYou: false, submittedAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z' });
});
