# R13 — Support policy

Status: **CONFIRMED FOR IMPLEMENTED SCOPE**

R13 replaces the client-only seeded support chat with authenticated support tickets.

## Confirmed rules

- Static FAQ answers are static content. They do not create messages or imply that a support agent replied.
- Any authenticated account may create and read only its own support tickets.
- The authenticated user identity is the requester authority; requester ids are never accepted from the client.
- Platform administrators are the current support operators. Admin routes require the admin role plus a fresh database check of a support capability: `support:read` to list and read tickets, `support:respond` to reply, close or reopen. Both are granted to the `admin` role by the R13 migration and the seed. R13 does not create a separate support-agent role; a role holding only `support:read` can read but never write.
- Tickets are either `OPEN` or `CLOSED`.
- Only an authorized admin may close or reopen a ticket in R13.
- Messages on a closed ticket are rejected until an admin reopens it.
- Each logical create/send carries a client idempotency key. Retrying the same accepted content returns the stored resource — including after the ticket was closed, when the original send had been stored first; reusing the key for different content is a conflict.
- Ticket creation is limited to 5 per minute and message sends to 30 per minute per client, in addition to the global throttle.
- Ticket lists are ordered by creation time (newest first, id as tie-break) so cursor pages are stable while tickets receive messages.
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
