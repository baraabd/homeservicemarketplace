# R13 — Support authority matrix

| Capability | Authority | Persistence | Acceptance target |
| --- | --- | --- | --- |
| FAQ content | Static web copy | none | no fake message creation |
| Create ticket | authenticated requester | `SupportTicket` + first `SupportMessage` in one transaction | retry-safe, reload/fresh-login |
| List/read own tickets | requester id from session | PostgreSQL | wrong-user returns not found |
| Send requester message | ticket ownership + OPEN state | `SupportMessage` | retry-safe, offline honest |
| Admin queue/detail | admin role + fresh `user:read:any` | PostgreSQL | non-admin denied |
| Admin reply | same admin authority + OPEN ticket | `SupportMessage` | audited, retry-safe |
| Close/reopen | same admin authority | ticket status/closed metadata | conditional transition + audit |
| Agent online/typing/read receipt | none | none | deliberately absent |
| Support rating | none | none | local-only control removed |
