/** Verified login contacts belong to User, never to editable provider/profile contacts. */
export interface AuthenticationContacts {
  email?: string | null;
  emailVerifiedAt?: Date | string | null;
  phoneNumber?: string | null;
  phoneVerifiedAt?: Date | string | null;
}

export function hasVerifiedAuthenticationContact(
  user: AuthenticationContacts | null | undefined,
): boolean {
  return Boolean(
    user && ((user.email && user.emailVerifiedAt) || (user.phoneNumber && user.phoneVerifiedAt)),
  );
}
