import { Injectable } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import type { OutboxHandler } from '../../../../infrastructure/outbox/outbox.handler';

/** The transactional outbox's handler ledger is the durable delivery receipt.
 * Erasure is already committed: delivery must NEVER trigger another deletion. */
@Injectable()
export class EvidenceErasedHandler implements OutboxHandler {
  readonly name = 'evidence-erased.receipt.v1';
  readonly eventTypes = ['evidence.erased.v1'];
  async handle(event: OutboxEvent, tx: PrismaTx): Promise<void> {
    const payload = event.payload as { version?: unknown; jobId?: unknown; scope?: unknown };
    if (
      payload.version !== 1 ||
      typeof payload.jobId !== 'string' ||
      payload.scope !== 'PRIMARY_OBJECT_AND_VERSIONS'
    ) {
      throw new Error('invalid-evidence-erasure-event');
    }
    const job = await tx.evidenceRetentionJob.findUnique({
      where: { id: payload.jobId },
      select: { status: true },
    });
    if (job?.status !== 'COMPLETED') throw new Error('uncommitted-evidence-erasure');
  }
}
