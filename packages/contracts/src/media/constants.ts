// Shared media constraints — the single source of truth consumed by
// BOTH the web wizard (UI validation + copy) and the API (presign DTO
// + create-request DTO validation). Keeping the cap here prevents the
// frontend and backend limits from drifting apart.

/**
 * Maximum number of media attachments (images/videos) a seeker can
 * attach to a single service request.
 *
 * Sprint 7.13 — raised from 4 to 6 ("حتى 6 صور"). The backend enforces
 * this independently in the presign + create-request DTOs so a
 * malicious client can never bypass the wizard's cap.
 */
export const MAX_REQUEST_MEDIA_ITEMS = 6;
