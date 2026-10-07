# R17 — Authority matrix

Inventory of `develop@460b9ee`. For each capability: the path from screen to
database, who decides, and what currently proves it. Evidence levels:
**U** unit (mocked collaborators), **E** API e2e with mocked service,
**I** real PostgreSQL integration (guards may be stubbed — noted),
**H** real HTTP app with real login, **B** real browser + real API + DB,
**X** cross-instance (two API processes).

## A — Messaging

| Capability                | Path                                                                                                                                                                               | Authority                                                                                            | Evidence before R17                                   | After R17-A                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Open booking conversation | `ChatScreen`/`MyBidsScreen` → `POST /v1/{me,provider}/conversations` → `ConversationsService.getOrCreateForBooking` → partial unique `Conversation_bookingId_live_unique`          | Server: booking participant on the route's side (R12 side binding); provider needs `MANAGE_BOOKINGS` | I (guards stubbed), B                                 | + X                                       |
| Send message              | `POST …/:id/messages` → `sendMessage` → `@@unique([conversationId, senderUserId, idempotencyKey])`                                                                                 | Server: participant; sender from session; key scoped per sender                                      | I (guards stubbed), B                                 | + X (retry across replicas)               |
| Read history              | `GET …/:id/messages` (newest page, `createdAt desc, id desc`, cursor)                                                                                                              | Server: participant                                                                                  | I, B                                                  | + X (paging while another replica writes) |
| Mark read                 | `ChatScreen` effect → `POST …/:id/read` → `lastReadAt`                                                                                                                             | Server; R17: up to a named message of the conversation, never backwards                              | U (mocked), I (provider bodyless call)                | U, I, X — see `R17_A_MESSAGING.md`        |
| Unread count / badge      | `GET /v1/me/conversations` → `countUnreadForParticipant(createdAt > lastReadAt)` → `HomeScreen` badge sum                                                                          | Server                                                                                               | none (R12 matrix: "not separately tested")            | I, X                                      |
| Live delivery             | Web: 4 s polling (seeker open chat, provider thread), 20 s provider list. Socket.IO gateway off by default (`REALTIME_SOCKET_IO=false`); web never calls `subscribeToConversation` | —                                                                                                    | U (gateway with stub sockets)                         | unchanged; not accepted (see gap A-6)     |
| Session across replicas   | JWT + session row in PostgreSQL; logout on one replica                                                                                                                             | Server                                                                                               | manual script `runtime:sprint01-security` (not in CI) | X                                         |

## B — Notifications

| Capability                               | Path                                                                                                        | Authority                                       | Evidence                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Create (domain transaction)              | `NotificationsService.createForUser(input, tx)` from bids, bookings, admin disputes, admin verification     | Server, same transaction as the business change | U; I via R07/R09/dispute suites      |
| Create (outbox)                          | `request.available` fan-out, dispute workspace, provider review, verification case                          | Outbox + `OutboxHandlerRun` marker              | I                                    |
| List / unread / read / read-all / delete | `/v1/me/notifications*` (experience scope = deep-link prefix)                                               | Server, owner filter on every call              | U (repo mocked), E (service stubbed) |
| Live push                                | `realtime.publishFor` (Socket.IO room `user:{id}` + in-process SSE)                                         | best effort                                     | U                                    |
| Web inbox / badges                       | seeker `NotificationDrawer`, `ProfileTab`; provider `ProviderNotifications`; admin `AdminNotificationsBell` | Server counts; polling 15–20 s                  | U; Playwright stubs `unread-count`   |
| Preferences                              | `DisputeNotificationPreference` only; `SettingsPage` toggles are local state                                | partial                                         | I (dispute workspace)                |

## C — Disputes

| Capability           | Path                                                                                                                                         | Authority                                                      | Evidence                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| Intake               | `dispute-intake.service` (booking lock, one active dispute per booking)                                                                      | Server; policy key `disputes.self_service.intake` (not seeded) | I                                  |
| Workspace commands   | `/v1/me/disputes/:id/workspace/*`, `/v1/admin/dispute-workspaces/*` → `workspace-commands.service` (row locks, `expectedRevision`, receipts) | Server; fresh `dispute:*` permissions in the transaction       | I, H, B (dispute-workspace CI job) |
| Evidence             | encrypted restricted storage, streamed through the API, ClamAV                                                                               | Server; reads audited                                          | I with real ClamAV                 |
| Legacy admin tickets | `/v1/admin/disputes` → `admin-disputes.service`                                                                                              | `@Roles('admin')` only                                         | U (mocked), E (service stubbed)    |
| Money                | none — decisions are intent; `RESOLVED_REFUND/PARTIAL` are display labels (R15 matrix)                                                       | —                                                              | —                                  |

## D — Admin operations

| Section       | Functional                                                                                              | Read-only by design | Placeholder / broken / policy gap                                                                               | Evidence      |
| ------------- | ------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------- |
| Users         | search, role/status filters, keyset paging, suspend/activate (transactional, audited, sessions revoked) | detail drawer       | no last-admin guard; no reason captured; legacy non-idempotent `POST :id/suspend`                               | U, E (mocked) |
| Settings      | allowlisted bulk `PATCH` with typed validation, history, audit                                          | —                   | legacy `PUT /:key` bypasses allowlist and validation; 4 settings read nowhere; no concurrency token; ReDoS (#1) | U, E (mocked) |
| Analytics     | range queries                                                                                           | totals              | mixed currencies under one label; `updatedAt` as completion time; null shown as 0                               | U, E (mocked) |
| Notifications | own-inbox mark read                                                                                     | —                   | badge capped at page size; no admin producer exists                                                             | E (mocked)    |
| Audit         | actor/action filters                                                                                    | list                | UI never pages past 50                                                                                          | U, E (mocked) |

## E — Provider surfaces

| Surface             | Path                                                                                      | Authority                                                  | Evidence         |
| ------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------- |
| Feed / detail       | `/v1/provider/available-requests[/:id]` (+ legacy `/v1/me/provider/jobs/available`)       | Server: category, area, own-request exclusion, capability  | I, B (R07, R09)  |
| Bid submit/withdraw | `/v1/provider/bids` (lock, one active bid partial unique)                                 | Server; `SUBMIT_BID`                                       | I, B (R07)       |
| Booking actions     | `/v1/provider/bookings/:id/{start,complete,cancel}` (conditional transition)              | Server; `MANAGE_BOOKINGS`                                  | I; API-only in B |
| Public profile      | owner preview only (`PUBLIC_PROFILE_ROUTE_AVAILABLE = false`); seekers see bid projection | Server allowlist projection                                | U                |
| Status centre       | `ProviderStatusCentreScreen` from capabilities, case and profile                          | mixed: some client-derived (`profile.status === 'ACTIVE'`) | U                |
