# R13 — Support policy

Status: **CONFIRMED FOR IMPLEMENTED SCOPE**

R13 replaces the client-only seeded support chat with authenticated support tickets.

## Confirmed rules

- Static FAQ answers are static content. They do not create messages or imply that a support agent replied.
- Any authenticated account may create and read only its own support tickets.
- The authenticated user identity is the requester authority; requester ids are never accepted from the client.
- Platform administrators are the current support operators. Admin routes remain behind the existing admin role plus the fresh `user:read:any` permission check; R13 does not create a new support role.
- Tickets are either `OPEN` or `CLOSED`.
- Only an authorized admin may close or reopen a ticket in R13.
- Messages on a closed ticket are rejected until an admin reopens it.
- Each logical create/send carries a client idempotency key. Retrying the same accepted content returns the stored resource; reusing the key for different content is a conflict.
- No message edit/delete endpoint exists.
- Support message bodies and subjects are never copied into audit metadata.
- There is no authoritative agent presence, typing state, queue position, SLA, read receipt, or support rating in R13; the UI must not fabricate any of them.

## Not implemented

- attachments;
- dedicated support-agent role;
- automatic assignment/routing;
- SLA timers;
- email/SMS support delivery;
- AI/bot replies;
- support-quality rating.

Those require separate product and operational decisions.
