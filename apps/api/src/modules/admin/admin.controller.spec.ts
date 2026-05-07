import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { AdminController } from './admin.controller';

describe('AdminController.health', () => {
  it('returns ok=true with the calling admin user id', () => {
    const ctrl = new AdminController();
    const out = ctrl.health({ id: 'admin-1', roles: ['admin'] } as AuthenticatedUser);
    expect(out.ok).toBe(true);
    expect(out.adminUserId).toBe('admin-1');
    expect(typeof out.serverTime).toBe('string');
    expect(new Date(out.serverTime).toString()).not.toBe('Invalid Date');
  });
});
