import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaTx, type DisputeWorkspace } from '@homeservicemarketplace/database';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import { conflict, forbidden, missing, WORKSPACE_PERMISSIONS } from './workspace.policy';
import type { DisputeActorRole } from '@homeservicemarketplace/contracts';

export interface WorkspaceActor {
  id: string;
  role: DisputeActorRole;
  permissions: Set<string>;
}
@Injectable()
export class WorkspaceRepository {
  constructor(
    readonly prisma: PrismaService,
    @Inject(PermissionResolverService)
    private readonly permissions: Pick<PermissionResolverService, 'resolveFreshForUser'>,
  ) {}
  async booking(actorId: string, bookingId: string, tx: PrismaTx) {
    const row = await tx.booking.findFirst({
      where: {
        id: bookingId,
        deletedAt: null,
        OR: [{ seekerUserId: actorId }, { provider: { userId: actorId } }],
      },
      include: { provider: { select: { userId: true } } },
    });
    if (!row) throw missing();
    return row;
  }
  async actor(
    actorId: string,
    workspace: DisputeWorkspace,
    tx: PrismaTx,
    reviewer = false,
  ): Promise<WorkspaceActor> {
    const account = await tx.user.findUnique({
      where: { id: actorId },
      select: { isActive: true, status: true, deletedAt: true },
    });
    if (!account || !account.isActive || account.deletedAt || account.status !== 'ACTIVE')
      throw missing();
    const booking = await tx.dispute.findFirst({
      where: { id: workspace.disputeId, deletedAt: null },
      include: { booking: { include: { provider: { select: { userId: true } } } } },
    });
    if (!booking || booking.booking.deletedAt) throw missing();
    // Both historical participation and current ownership must match. Reassignment
    // does not silently disclose a past participant's private case to a new owner.
    const isSeeker = workspace.seekerUserId === actorId && booking.booking.seekerUserId === actorId;
    const isProvider =
      workspace.providerUserId === actorId && booking.booking.provider.userId === actorId;
    if (!reviewer && (isSeeker || isProvider))
      return { id: actorId, role: isSeeker ? 'SEEKER' : 'PROVIDER', permissions: new Set() };
    if (workspace.seekerUserId === actorId || workspace.providerUserId === actorId)
      throw forbidden();
    const permissions = await this.permissions.resolveFreshForUser(actorId, tx);
    if (!permissions.has(WORKSPACE_PERMISSIONS.READ)) throw missing();
    return { id: actorId, role: 'REVIEWER', permissions };
  }
  async lock(id: string, tx: PrismaTx): Promise<DisputeWorkspace> {
    const row = await tx.dispute.findUnique({ where: { id }, select: { bookingId: true } });
    if (!row) throw missing();
    // One order for intake, collaboration, evidence and timers: booking -> workspace.
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Booking" WHERE "id" = ${row.bookingId} FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "disputeId" FROM "DisputeWorkspace" WHERE "disputeId" = ${id} FOR UPDATE`,
    );
    const workspace = await tx.disputeWorkspace.findUnique({ where: { disputeId: id } });
    if (!workspace) throw missing();
    return workspace;
  }
  async reviewerCan(
    reviewerId: string,
    workspace: DisputeWorkspace,
    permission: string,
    tx: PrismaTx,
  ) {
    if ([workspace.seekerUserId, workspace.providerUserId].includes(reviewerId)) throw forbidden();
    const actor = await this.actor(reviewerId, workspace, tx, true);
    if (!actor.permissions.has(permission)) throw forbidden();
  }
  async assertAssignableReviewer(reviewerId: string, w: DisputeWorkspace, tx: PrismaTx) {
    const actor = await this.actor(reviewerId, w, tx, true);
    const required =
      w.state === 'APPEALED'
        ? [WORKSPACE_PERMISSIONS.DECIDE_APPEAL]
        : [
            WORKSPACE_PERMISSIONS.REQUEST_INFORMATION,
            WORKSPACE_PERMISSIONS.PROPOSE,
            WORKSPACE_PERMISSIONS.DECIDE,
            WORKSPACE_PERMISSIONS.CLOSE,
          ];
    if (!required.some((permission) => actor.permissions.has(permission))) throw forbidden();
    if (w.state === 'APPEALED') {
      const appeal = await tx.disputeAppealRecord.findFirst({
        where: { disputeId: w.disputeId, status: 'OPEN' },
        include: { decision: true },
      });
      if (!appeal || appeal.decision.decidedById === reviewerId) throw forbidden();
    }
  }
  async assignableReviewers(w: DisputeWorkspace, tx: PrismaTx) {
    const original =
      w.state === 'APPEALED'
        ? await tx.disputeAppealRecord.findFirst({
            where: { disputeId: w.disputeId, status: 'OPEN' },
            include: { decision: true },
          })
        : null;
    const required =
      w.state === 'APPEALED'
        ? [WORKSPACE_PERMISSIONS.DECIDE_APPEAL]
        : [
            WORKSPACE_PERMISSIONS.REQUEST_INFORMATION,
            WORKSPACE_PERMISSIONS.PROPOSE,
            WORKSPACE_PERMISSIONS.DECIDE,
            WORKSPACE_PERMISSIONS.CLOSE,
          ];
    return tx.user.findMany({
      where: {
        status: 'ACTIVE',
        isActive: true,
        deletedAt: null,
        id: {
          notIn: [
            w.seekerUserId,
            w.providerUserId,
            ...(original ? [original.decision.decidedById] : []),
          ],
        },
        AND: [
          {
            userRoles: {
              some: {
                role: {
                  deletedAt: null,
                  rolePermissions: { some: { permission: { key: WORKSPACE_PERMISSIONS.READ } } },
                },
              },
            },
          },
          {
            userRoles: {
              some: {
                role: {
                  deletedAt: null,
                  rolePermissions: { some: { permission: { key: { in: required } } } },
                },
              },
            },
          },
        ],
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  }
  requireAssigned(actor: WorkspaceActor, workspace: DisputeWorkspace, permission: string) {
    if (
      actor.role !== 'REVIEWER' ||
      !actor.permissions.has(permission) ||
      workspace.assignedToUserId !== actor.id
    )
      throw forbidden();
  }
  async evidenceReady(id: string, evidenceIds: readonly string[], tx: PrismaTx) {
    if (new Set(evidenceIds).size !== evidenceIds.length)
      throw conflict('DUPLICATE_EVIDENCE_REFERENCE');
    const count = await tx.disputeEvidence.count({
      where: {
        id: { in: [...evidenceIds] },
        disputeId: id,
        state: 'CLEAN',
        erasureStartedAt: null,
        erasedAt: null,
        retainUntil: { gt: new Date() },
      },
    });
    if (count !== evidenceIds.length) throw conflict('EVIDENCE_NOT_REVIEWABLE');
  }
}
