import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import type { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { AuthenticatedUser } from '../../authentication/types/authenticated-user';
import { CurrentAdminGuard } from './current-admin.guard';

// K06 — the token's `admin` claim is not enough; live membership decides.

function ctxWith(user?: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function prismaWith(membership: { roleId: string } | null) {
  const findFirst = jest.fn().mockResolvedValue(membership);
  return { findFirst, prisma: { client: { userRole: { findFirst } } } as unknown as PrismaService };
}

const ADMIN_CLAIM: AuthenticatedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['admin'] };

describe('CurrentAdminGuard', () => {
  it('allows a caller who is an administrator now', async () => {
    const { prisma, findFirst } = prismaWith({ roleId: 'admin-role' });
    await expect(new CurrentAdminGuard(prisma).canActivate(ctxWith(ADMIN_CLAIM))).resolves.toBe(
      true,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u-1',
        user: { deletedAt: null, status: 'ACTIVE', isActive: true },
        role: { name: 'admin', deletedAt: null },
      },
      select: { roleId: true },
    });
  });

  it('refuses a token that still claims admin after the membership was removed', async () => {
    const { prisma } = prismaWith(null);
    await expect(new CurrentAdminGuard(prisma).canActivate(ctxWith(ADMIN_CLAIM))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a request without an authenticated user and does not query', async () => {
    const { prisma, findFirst } = prismaWith({ roleId: 'admin-role' });
    await expect(new CurrentAdminGuard(prisma).canActivate(ctxWith(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });
});
