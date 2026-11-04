import type { PrismaTx } from '@homeservicemarketplace/database';

/**
 * K06 — the one definition of "is an administrator right now".
 *
 * The `admin` role in an access token is a claim made when the token was
 * minted. Granting admin revokes the applicant's sessions, but no API path
 * removes the role, so a removal is made out of band and the old token keeps
 * the claim until it expires. Admin surfaces that decide anything re-read
 * this instead. Same standing the admin floor and verification-policy checks
 * use: a live `admin` role on an ACTIVE, non-deleted, active account.
 */
export async function hasCurrentAdminMembership(
  db: Pick<PrismaTx, 'userRole'>,
  userId: string,
): Promise<boolean> {
  const membership = await db.userRole.findFirst({
    where: {
      userId,
      user: { deletedAt: null, status: 'ACTIVE', isActive: true },
      role: { name: 'admin', deletedAt: null },
    },
    select: { roleId: true },
  });
  return membership !== null;
}
