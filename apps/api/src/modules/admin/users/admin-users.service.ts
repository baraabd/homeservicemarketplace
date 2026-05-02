import { Injectable } from '@nestjs/common';
import type {
  AdminUserMutationResponse,
  AdminUserSummary,
  ListAdminUsersQuery,
  ListAdminUsersResponse,
} from '@homeservicemarketplace/contracts';
import type { AccountStatus, AuditEventType, User } from '@homeservicemarketplace/database';

import { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AdminAuditService } from '../admin-audit.service';

const DEFAULT_PAGE_SIZE = 50;

// Sprint 6.1 — admin user control. List / search / suspend / restore.
// Soft-delete is intentionally NOT exposed here (admin should not be
// able to nuke a user account from the UI; that path is reserved for
// the user themselves via the deactivate-my-account flow). Suspending
// blocks login (isActive=false + status=SUSPENDED); restoring puts
// the account back to ACTIVE.
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly audit: AdminAuditService,
    private readonly tx: TransactionRunner,
  ) {}

  async list(query: ListAdminUsersQuery): Promise<ListAdminUsersResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.users.searchForAdmin({
      q: query.q,
      status: query.status,
      roleName: query.role,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items = await Promise.all(page.map((u) => this.toSummary(u)));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async detail(userId: string): Promise<AdminUserSummary> {
    const u = await this.users.findById(userId);
    if (!u) throw new AppError('NOT_FOUND', 'User not found.', 404);
    return this.toSummary(u);
  }

  async suspend(adminUserId: string, targetUserId: string): Promise<AdminUserMutationResponse> {
    if (adminUserId === targetUserId) {
      // Suspending your own account would lock you out; refuse explicitly.
      throw new AppError('VALIDATION_ERROR', 'Admins cannot suspend themselves.', 400);
    }
    const updated = await this.tx.run(async (tx) => {
      const existing = await this.users.findById(targetUserId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'User not found.', 404);
      const next = await this.users.update(targetUserId, { isActive: false }, tx);
      // status flip via raw update — `status` isn't on UpdateUserInput.
      await tx?.user.update({
        where: { id: targetUserId, deletedAt: null },
        data: { status: 'SUSPENDED' as AccountStatus },
      });
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_USER_SUSPENDED' as AuditEventType,
          metadata: {
            targetUserId,
            previousStatus: existing.status,
            previousIsActive: existing.isActive,
          },
        },
        tx,
      );
      return { ...next, status: 'SUSPENDED' as AccountStatus };
    });
    return { user: await this.toSummary(updated) };
  }

  async restore(adminUserId: string, targetUserId: string): Promise<AdminUserMutationResponse> {
    const updated = await this.tx.run(async (tx) => {
      const existing = await this.users.findById(targetUserId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'User not found.', 404);
      const next = await this.users.update(targetUserId, { isActive: true }, tx);
      await tx?.user.update({
        where: { id: targetUserId, deletedAt: null },
        data: { status: 'ACTIVE' as AccountStatus },
      });
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_USER_RESTORED' as AuditEventType,
          metadata: {
            targetUserId,
            previousStatus: existing.status,
            previousIsActive: existing.isActive,
          },
        },
        tx,
      );
      return { ...next, status: 'ACTIVE' as AccountStatus };
    });
    return { user: await this.toSummary(updated) };
  }

  private async toSummary(u: User): Promise<AdminUserSummary> {
    const userRoles = await this.users.listRoles(u.id);
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status as AdminUserSummary['status'],
      isActive: u.isActive,
      emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
      mfaEnabled: u.mfaEnabled,
      roles: userRoles.map((r) => r.role.name),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }
}
