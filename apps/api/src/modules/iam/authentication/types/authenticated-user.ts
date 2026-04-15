// Shape attached to `req.user` after a successful JwtAuthGuard. Intentionally
// minimal: anything business-domain stays in the service layer.
export interface AuthenticatedUser {
  id: string;
  sessionId: string;
  jti: string;
  roles: string[];
}

// 'cookie' when token came from hsm_at, 'header' when from Authorization.
export type AuthTransport = 'cookie' | 'header';
