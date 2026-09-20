import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';
import type { DisputeDraftContent, DisputeDraftView } from '@homeservicemarketplace/contracts';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceCipher } from './workspace-cipher.service';
import {
  digest,
  conflict,
  draftSchema,
  hoursAfter,
  missing,
  workspacePolicy,
  WORKSPACE_SETTING,
} from './workspace.policy';

const EMPTY: DisputeDraftContent = { issueCode: '', requestedOutcome: '', statement: '', step: 0 };
@Injectable()
export class WorkspaceDrafts {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly transactions: TransactionRunner,
    private readonly cipher: WorkspaceCipher,
  ) {}
  async read(actorId: string, bookingId: string): Promise<DisputeDraftView> {
    return this.transactions.run(async (tx) => {
      await this.repository.booking(actorId, bookingId, tx);
      const row = await tx.disputePrivateDraft.findUnique({
        where: { userId_bookingId: { userId: actorId, bookingId } },
      });
      // Existing personal drafts remain readable after intake policy withdrawal.
      if (row && !row.erasedAt && row.expiresAt > new Date())
        return {
          version: row.version,
          content: this.cipher.decode<DisputeDraftContent>(
            row.contentCipher,
            `draft:${actorId}:${bookingId}`,
          ),
          savedAt: row.updatedAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        };
      const p = workspacePolicy(
        (await tx.platformSetting.findUnique({ where: { key: WORKSPACE_SETTING } }))?.value,
      );
      if (!p?.enabled || !p.pilotUserIds.includes(actorId)) throw missing();
      this.cipher.ready();
      return { version: row?.version ?? 0, content: EMPTY, savedAt: null, expiresAt: null };
    });
  }
  async save(actorId: string, bookingId: string, raw: unknown): Promise<DisputeDraftView> {
    const parsed = draftSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid draft fields.', 400);
    return this.transactions.run(async (tx) => {
      await this.repository.booking(actorId, bookingId, tx);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`,
      );
      const p = workspacePolicy(
        (await tx.platformSetting.findUnique({ where: { key: WORKSPACE_SETTING } }))?.value,
      );
      if (!p?.enabled || !p.pilotUserIds.includes(actorId)) throw missing();
      if (
        await tx.dispute.count({
          where: { bookingId, deletedAt: null, status: { in: ['OPEN', 'IN_REVIEW'] } },
        })
      )
        throw conflict('CASE_ALREADY_SUBMITTED');
      const row = await tx.disputePrivateDraft.findUnique({
        where: { userId_bookingId: { userId: actorId, bookingId } },
      });
      if (
        row &&
        !row.erasedAt &&
        row.version === parsed.data.version + 1 &&
        row.expiresAt > new Date() &&
        digest(this.cipher.decode(row.contentCipher, `draft:${actorId}:${bookingId}`)) ===
          digest(parsed.data.content)
      )
        return {
          version: row.version,
          content: parsed.data.content,
          savedAt: row.updatedAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        };
      if ((row?.version ?? 0) !== parsed.data.version) throw conflict('DRAFT_VERSION_CHANGED');
      const data = {
        erasedAt: null,
        contentCipher: this.cipher.encode(parsed.data.content, `draft:${actorId}:${bookingId}`),
        version: parsed.data.version + 1,
        expiresAt: hoursAfter(new Date(), p.draftRetentionHours),
      };
      const saved = await tx.disputePrivateDraft.upsert({
        where: { userId_bookingId: { userId: actorId, bookingId } },
        create: { ...data, userId: actorId, bookingId },
        update: data,
      });
      return {
        version: saved.version,
        content: parsed.data.content,
        savedAt: saved.updatedAt.toISOString(),
        expiresAt: saved.expiresAt.toISOString(),
      };
    });
  }
}
