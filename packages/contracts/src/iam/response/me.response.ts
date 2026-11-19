import type { AccountStatus } from '../enums/account-status';
import type { RoleName } from '../enums/role-name';

export interface MeResponse {
  id: string;
  email: string | null;
  phoneNumber?: string | null;
  phoneVerifiedAt?: string | null;
  firstName: string;
  lastName: string;
  status: AccountStatus;
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  roles: RoleName[];
}
