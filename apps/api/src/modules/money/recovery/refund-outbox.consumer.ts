import { Injectable } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import { OutboxPermanentError } from '../../../infrastructure/outbox/outbox.errors';
import type {
  OutboxHandler,
  OutboxHandlerResult,
} from '../../../infrastructure/outbox/outbox.handler';
import {
  REFUND_DISPATCH_EVENT,
  RefundOrchestratorService,
} from '../refunds/refund-orchestrator.service';

@Injectable()
export class RefundOutboxConsumer implements OutboxHandler {
  readonly name = 'money.refund.dispatch.v1';
  readonly eventTypes = [REFUND_DISPATCH_EVENT];

  constructor(private readonly orchestrator: RefundOrchestratorService) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult> {
    const value = event.payload;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.refundId !== 'string' ||
      typeof value.commandId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(value.refundId) ||
      !/^[A-Za-z0-9_-]{1,64}$/u.test(value.commandId) ||
      Object.keys(value).some((key) => !['refundId', 'commandId'].includes(key)) ||
      event.eventType !== REFUND_DISPATCH_EVENT ||
      event.aggregateType !== 'MoneyRefund' ||
      event.aggregateId !== value.refundId
    ) {
      throw new OutboxPermanentError('Invalid refund delivery intent.');
    }
    const { refundId, commandId } = value;
    const dispatch = await tx.moneyDispatch.findUnique({ where: { refundId } });
    const command = await tx.moneyCommand.findUnique({ where: { id: commandId } });
    const response = command?.response;
    const result =
      response && typeof response === 'object' && !Array.isArray(response) ? response.value : null;
    const subject =
      result && typeof result === 'object' && !Array.isArray(result)
        ? (result.resourceId ?? result.id)
        : null;
    if (
      !dispatch ||
      dispatch.kind !== 'REFUND' ||
      !command?.actorUserId ||
      !['RESERVE_REFUND', 'DISPATCH_REFUND', 'QUERY_REFUND'].includes(command.action) ||
      subject !== refundId
    ) {
      throw new OutboxPermanentError('Refund delivery authority is inconsistent.');
    }
    if (['SUCCEEDED', 'FAILED'].includes(dispatch.status)) return { stats: { terminal: 1 } };
    // No I/O in handle. MoneyDispatch already committed with the reservation.
    // Its independent scanner makes loss of this accelerator recoverable.
    return {
      afterCommit: () => this.orchestrator.deliver(refundId, commandId),
      stats: { durableIntents: 1 },
    };
  }
}
