// PATCH /v1/me/profile body.
//
// Every field is optional — clients send only the fields they want to
// update. Sending the field with `null` clears it (for the nullable
// fields). Sending the field with an empty string is normalised to
// null server-side.
//
// Email / userId / role / status / password are intentionally NOT on
// this contract. The server's forbidNonWhitelisted ValidationPipe
// rejects payloads that try to inject them.
export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string | null;
  city?: string | null;
  bio?: string | null;
}
