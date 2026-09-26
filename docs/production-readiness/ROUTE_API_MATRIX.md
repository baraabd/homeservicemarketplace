# Route / API / authority matrix

Base: `66e336cb4823802aabacc536584972aa43056d23`. Route composition is `apps/web/src/app/routes.ts`; source controllers and tests are resolved in FEATURE_INVENTORY.json. Internal Admin/Provider tab routes are not invented as separate root pages.

| Browser surface | Backend family / observed operations | Authority boundary |
| --- | --- | --- |
| /signup, /login, /forgot-password, /check-email | POST /v1/auth/register, login, verify-otp, resend-otp, forgot-password | Guest UI wrapper; public identity challenges/rate limits. No authentication guard is inferred for public login. |
| /verify-email, /reset-password | POST /v1/auth/verify-email, reset-password | Public token landing pages intentionally remain reachable with an existing session. |
| Session lifecycle | POST /v1/auth/refresh, logout, logout-all; GET /v1/auth/me | Opaque refresh token/CSRF contract; JWT guard on me/logout and CSRF on web commands. |
| /home/profile | GET/PATCH /v1/me/profile; list/create/update/delete/default /v1/me/addresses | JWT + authenticated-user ownership; mutation CSRF. |
| /home request wizard | GET /v1/services; POST /v1/media/presigned-url; POST /v1/me/requests | Catalog public; presign/request authenticated+CSRF. Request media ownership remains B03. |
| /home requests/bids | /v1/me/requests/:requestId; /timeline; /cancel; /reopen; /bids; /bids/:bidId/accept | JWT + Seeker request ownership; accept/cancel/reopen CSRF and transactional lifecycle rules. |
| /home/bookings | GET /v1/me/bookings, /:bookingId, /:bookingId/timeline; POST /:bookingId/cancel | JWT + caller's booking access; mutation CSRF. |
| /home/messages | /v1/me/conversations, /:conversationId/messages, /:conversationId/read | Authenticated conversation membership; writes CSRF. |
| Notification drawer | /v1/me/notifications, /unread-count, /:notificationId/read, /read-all | JWT + recipient ownership; writes CSRF. |
| /provider/* entry/status | /v1/me/provider; /v1/me/provider/capabilities | Capabilities explanation is JWT-only and returns denial reasons for the caller. It must not be hidden behind the gate it explains. |
| /provider/onboarding and /:taskId | /v1/me/provider/onboarding | Provider role/capability + JWT; writes CSRF, versioned server draft and transaction authority. |
| /provider/verification | /v1/me/provider/verification and /evidence | Reachable before work access, so blocked Providers can complete verification; capability and evidence ownership still apply. |
| Protected evidence view | /v1/verification/documents | Per-read authorization; restricted objects must not become public CDN media. |
| Provider feed | /v1/provider/available-requests; /v1/me/provider/jobs | JWT/provider role and ProviderActiveGuard; geo rules on backend. |
| Provider bids/bookings | /v1/provider/bids; /v1/provider/bookings; legacy /v1/me/provider/bookings | JWT/provider role/capability; command CSRF. Legacy/canonical paths must not diverge. |
| Provider messages | /v1/provider/conversations | JWT/provider role/capability plus conversation membership. |
| Provider portfolio/public profile | /v1/me/provider/portfolio; /v1/me/provider/public-profile | Own-provider capabilities; public-media and review authority remain distinct. |
| Provider earnings | /v1/provider/earnings; legacy /v1/me/provider/earnings | Read-only computed booking earnings, not settlement or payout authority. |
| /admin/* review/dossier | /v1/admin/providers/:providerProfileId/review, /history, /approve, /request-changes | JWT + admin + user:read:any; decisions add verification:decide and CSRF. |
| /admin/* verification policies | GET/POST /v1/admin/verification/policies, GET /options, POST /:version/retire | JWT/admin/verification:policy:manage; mutations CSRF. POST publishes; a persisted draft endpoint is not shown by this controller. |
| /admin/* portfolio | /v1/admin/providers/:providerProfileId/portfolio | JWT/admin, portfolio:read or portfolio:review, mutation CSRF. |
| Other Admin sections | /v1/admin/users, /providers, /analytics, /settings, /notifications, /financials; audit controller under /v1/admin | Admin-role controllers with command-specific permissions; inspect each controller rather than assuming uniform permission scope. |
| /disputes/* | Dispute intake/workspace and Admin dispute controllers | Participant/role/private-content and command-specific checks. See dispute profile's real HTTP/DB test sources. |
| Money execution | No mounted execution controller/repository at baseline | Domain exports do not make a live API; B04. |

## Guard caveat

AppModule's global guard is the application throttler, not a global JwtAuthGuard. Authentication/roles/permissions/CSRF are attached at controller/method boundaries and supplemented by service ownership checks. A component or route wrapper is never proof of API authorization.
