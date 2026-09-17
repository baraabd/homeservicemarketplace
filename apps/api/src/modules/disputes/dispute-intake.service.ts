import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';
import {
  DISPUTE_ISSUE_CODES, DISPUTE_REQUESTED_OUTCOMES,
  type CreateParticipantDisputeRequest, type CreateParticipantDisputeResponse,
  type DisputeBookingChoices, type DisputeIntakeContext, type ParticipantDisputeDetail, type ParticipantDisputeList,
} from '@homeservicemarketplace/contracts';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { PlatformSettingRepository } from '../../infrastructure/persistence/settings/platform-setting.repository';
import { OutboxRepository } from '../../infrastructure/outbox/outbox.repository';
import { AppError } from '../../shared/errors/app-error';
import { DisputeIntakeRepository, type IntakeBooking } from './dispute-intake.repository';
import {
  DISPUTE_INTAKE_EVENT, DISPUTE_INTAKE_SETTING, INTAKE_ID_PREFIX,
  intakeEligibility, intakeIntentId, intakeRequestHash, parseIntakePolicy,
} from './dispute-intake.policy';
import { intakeReceiptSchema, participantSummary } from './dispute-intake.projection';

const notFound = () => new AppError('NOT_FOUND', 'Support case or booking not found.', 404);

@Injectable()
export class DisputeIntakeService {
  constructor(
    private readonly repository: DisputeIntakeRepository,
    private readonly settings: PlatformSettingRepository,
    private readonly transactions: TransactionRunner,
    private readonly outbox: OutboxRepository,
  ) {}

  async bookings(actorUserId: string, query: { limit?: number; cursor?: string }): Promise<DisputeBookingChoices> {
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    if (query.cursor && !(await this.repository.ownedBooking(query.cursor, actorUserId)))
      throw new AppError('VALIDATION_ERROR', 'Invalid booking cursor.', 400);
    const rows = await this.repository.listBookings(actorUserId, limit + 1, query.cursor);
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id, status: row.status,
      role: row.seekerUserId === actorUserId ? 'SEEKER' as const : 'PROVIDER' as const,
      serviceLabelEn: row.request.category?.labelEn ?? null,
      serviceLabelAr: row.request.category?.labelAr ?? null,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async context(actorUserId: string, bookingId: string): Promise<DisputeIntakeContext> {
    const booking = await this.repository.ownedBooking(bookingId, actorUserId);
    if (!booking) throw notFound();
    const setting = await this.settings.findByKey(DISPUTE_INTAKE_SETTING);
    const policy = parseIntakePolicy(setting?.value);
    const active = await this.repository.activeCase(bookingId);
    const { blocker, deadline } = intakeEligibility({
      policy, actorUserId, bookingState: booking.status,
      terminalAt: await this.repository.terminalAt(booking), now: new Date(),
    });
    return {
      booking: {
        id: booking.id, status: booking.status,
        serviceLabelEn: booking.request.category?.labelEn ?? null,
        serviceLabelAr: booking.request.category?.labelAr ?? null,
      },
      role: booking.seekerUserId === actorUserId ? 'SEEKER' : 'PROVIDER',
      canOpen: !active && blocker === null,
      blocker: active ? (active.id.startsWith(INTAKE_ID_PREFIX) ? 'ALREADY_OPEN' : 'LEGACY_REVIEW') : blocker,
      existingCaseId: active?.id.startsWith(INTAKE_ID_PREFIX) ? active.id : null,
      policyVersion: blocker === 'NOT_ENABLED' ? null : policy?.revision ?? null,
      openingDeadline: deadline?.toISOString() ?? null,
      issueCodes: DISPUTE_ISSUE_CODES,
      requestedOutcomes: DISPUTE_REQUESTED_OUTCOMES,
    };
  }

  async list(actorUserId: string, query: { limit?: number; cursor?: string }): Promise<ParticipantDisputeList> {
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    if (query.cursor && !(await this.repository.ownedCase(query.cursor, actorUserId)))
      throw new AppError('VALIDATION_ERROR', 'Invalid support case cursor.', 400);
    const rows = await this.repository.list(actorUserId, limit + 1, query.cursor);
    const items = rows.slice(0, limit).map((row) => participantSummary(row, actorUserId));
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async detail(actorUserId: string, id: string): Promise<ParticipantDisputeDetail> {
    const row = await this.repository.ownedCase(id, actorUserId);
    if (!row) throw notFound();
    const receipt = await this.repository.receipt(id);
    const parsed = intakeReceiptSchema.safeParse(receipt?.after);
    if (!parsed.success)
      throw new AppError('CONFLICT', 'This case requires a support review.', 409);
    const events = await this.repository.publicEvents(id);
    const summary = participantSummary(row, actorUserId);
    return {
      ...summary,
      issueCode: parsed.data.issueCode,
      requestedOutcome: parsed.data.requestedOutcome,
      statement: row.openedById === actorUserId ? receipt?.message ?? null : null,
      policyVersion: parsed.data.policyVersion,
      events: events.slice(0, 100).reverse().map((event) => ({
        id: event.id,
        kind: event.type === 'OPENED' ? 'SUBMITTED'
          : event.type === 'RESOLVED' ? 'DECISION_RECORDED' : 'STATUS_UPDATED',
        occurredAt: event.createdAt.toISOString(),
      })),
      eventsTruncated: events.length > 100,
      // Legacy outcome labels are NOT evidence that a refund was executed.
      nextAction: summary.state === 'SUBMITTED' || summary.state === 'IN_REVIEW'
        ? 'WAIT_FOR_REVIEW' : 'CONTACT_SUPPORT',
      capabilities: { uploadEvidence: false, respond: false, appeal: false },
    };
  }

  async create(actorUserId: string, input: CreateParticipantDisputeRequest): Promise<CreateParticipantDisputeResponse> {
    const statement = input.statement.trim();
    if (statement.length < 20 || statement.length > 4000)
      throw new AppError('VALIDATION_ERROR', 'The statement must contain 20 to 4000 characters.', 400);
    const id = intakeIntentId(actorUserId, input.idempotencyKey);
    const requestHash = intakeRequestHash({ ...input, statement });
    try {
      return await this.transactions.run(async (tx) => {
        if (!(await this.repository.ownedBooking(input.bookingId, actorUserId, tx))) throw notFound();
        await this.repository.lockBooking(input.bookingId, tx);
        const booking = await this.repository.ownedBooking(input.bookingId, actorUserId, tx);
        if (!booking) throw notFound();

        const existingIntent = await this.repository.byIntent(id, tx);
        if (existingIntent) {
          const receipt = await this.repository.receipt(id, tx);
          const parsed = intakeReceiptSchema.safeParse(receipt?.after);
          if (existingIntent.deletedAt || existingIntent.openedById !== actorUserId ||
              !parsed.success || parsed.data.requestHash !== requestHash)
            throw new AppError('CONFLICT', 'The submission intent cannot be reused for different content.', 409);
          return { dispute: participantSummary(existingIntent, actorUserId), created: false, replayed: true };
        }
        const active = await this.repository.activeCase(input.bookingId, tx);
        if (active) {
          if (!active.id.startsWith(INTAKE_ID_PREFIX))
            throw new AppError('CONFLICT', 'An existing support case requires a support review.', 409);
          return { dispute: participantSummary(active, actorUserId), created: false, replayed: false };
        }
        const policy = parseIntakePolicy((await this.settings.findByKey(DISPUTE_INTAKE_SETTING, tx))?.value);
        const eligibility = intakeEligibility({
          policy, actorUserId, bookingState: booking.status,
          terminalAt: await this.repository.terminalAt(booking, tx), now: new Date(),
        });
        if (eligibility.blocker === 'NOT_ENABLED') throw notFound();
        if (eligibility.blocker || !policy || input.policyVersion !== policy.revision)
          throw new AppError('CONFLICT', 'Booking eligibility or support policy has changed. Reload before submitting.', 409);

        const row = await tx.dispute.create({
          data: { id, bookingId: booking.id, openedById: actorUserId, reason: input.issueCode,
            description: null, status: 'OPEN', priority: 'MEDIUM' },
        });
        // This append-only domain record is the participant audit and durable intent receipt.
        // The original statement lives in the private immutable event message, NOT
        // in mutable Admin description or operational metadata. Only its author
        // and authorized Admin readers receive that message.
        await tx.disputeEvent.create({
          data: {
            disputeId: id, actorUserId, type: 'OPENED', message: statement,
            after: {
              schemaVersion: 1, requestHash, policyVersion: policy.revision,
              terminalWindowHours: policy.terminalWindowHours,
              allowedBookingStates: policy.allowedBookingStates,
              bookingStateAtSubmission: booking.status,
              openingDeadline: eligibility.deadline?.toISOString() ?? null,
              issueCode: input.issueCode, requestedOutcome: input.requestedOutcome,
              status: 'OPEN', origin: 'PARTICIPANT_INTAKE_V1',
            },
          },
        });
        const recipient = this.counterparty(booking, actorUserId);
        let notificationId: string | null = null;
        if (recipient) {
          const notification = await tx.notification.create({
            data: {
              userId: recipient, type: 'SYSTEM', title: 'Support case update',
              body: 'An update is available in Support cases. Open the application to review it.',
              // Legacy notification drawers route BOOKING to an unrelated overlay.
              // Keep this pilot notice informational until typed case routing ships.
              resourceType: null, resourceId: null, deepLink: `/disputes/${id}`,
              metadata: { disputeId: id, purpose: 'DISPUTE_INTAKE_V1' },
            },
          });
          notificationId = notification.id;
        }
        await this.outbox.enqueue({
          aggregateType: 'Dispute', aggregateId: id, eventType: DISPUTE_INTAKE_EVENT,
          dedupeKey: `dispute.intake.opened.v1:${id}`,
          payload: { schemaVersion: 1, disputeId: id, notificationId, actorUserId },
        }, tx);
        return {
          dispute: participantSummary({ ...row, booking }, actorUserId),
          created: true, replayed: false,
        };
      });
    } catch (error) {
      // A legacy Admin create can race this endpoint; the partial index arbitrates globally.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError('CONFLICT', 'A support case already exists. Reload the booking before continuing.', 409);
      throw error;
    }
  }
  private counterparty(booking: IntakeBooking, actorUserId: string): string | null {
    const id = booking.seekerUserId === actorUserId ? booking.provider.userId : booking.seekerUserId;
    return id && id !== actorUserId ? id : null;
  }
}
