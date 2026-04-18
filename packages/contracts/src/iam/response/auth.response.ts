import type { RoleName } from '../enums/role-name';

// Returned by /auth/login and /auth/refresh.
//
// Web clients receive tokens via HttpOnly cookies and therefore see
// `tokens: null`. Mobile clients receive `tokens: { accessToken, refreshToken,
// expiresIn }` in the body and store them securely.
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export interface AuthResponse {
  userId: string;
  roles: RoleName[];
  mfaRequired: boolean;
  tokens: AuthTokens | null;
}
