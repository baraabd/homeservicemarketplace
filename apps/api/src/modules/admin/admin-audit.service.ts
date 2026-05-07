import { Injectable } from '@nestjs/common';
import type { AuditEventType, PrismaTx } from '@homeservicemarketplace/database';

import { AuditEventRepository } from '../../infrastructure/persistence/iam/audit-event.repository';

// Sprint 6 admin audit helper. Every admin mutation across the
// admin sprints (6.1 user control, 6.2 verification, 6.3 disputes,
// 6.5 settings) MUST go through this service to leave a stable,
// queryable audit trail. The repository is shared with the IAM
// auth flow's audit writes so the operator has one timeline.
//
// Scope: this slice (6.0 preflight) ships the helper. Subsequent
// sprints add new `AuditEventType` enum values via Prisma migrations
// and call `record(...)` from their service layer.
@Injectable()
export class AdminAuditService {
  constructor(private readonly events: AuditEventRepository) {}

  async record(
    args: {
      adminUserId: string;
      type: AuditEventType;
      metadata: Record<string, unknown>;
      ipAddress?: string | null;
      userAgent?: string | null;
      requestId?: string | null;
    },
    tx?: PrismaTx,
  ): Promise<void> {
    await this.events.write(
      {
        userId: args.adminUserId,
        type: args.type,
        metadata: args.metadata,
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
        requestId: args.requestId ?? null,
      },
      tx,
    );
  }
}
