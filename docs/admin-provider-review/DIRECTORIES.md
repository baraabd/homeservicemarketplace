# Admin directories and navigation

The approved Admin surfaces use UX/UI Redesign Mode. Read authorization and API changes remain Integration Mode. The existing Admin amber/slate palette, language provider, query client, authentication and protected route are reused.

## Routes

| Route                                 | Purpose                                                | Default filter            |
| ------------------------------------- | ------------------------------------------------------ | ------------------------- |
| `/admin`                              | Existing overview                                      | —                         |
| `/admin/users`                        | Account directory and user drawer                      | Every non-deleted account |
| `/admin/providers`                    | Provider profile directory                             | `status=ALL`              |
| `/admin/reviews`                      | Application review queue                               | `status=PENDING_REVIEW`   |
| `/admin/providers/:providerProfileId` | Full six-task review workspace                         | Exact provider ID         |
| `/admin/verification`                 | Existing case queue, account controls and policy panel | Existing behavior         |

Financials, disputes, settings and audit destinations remain available. `/admin/*` retains `RequireAdmin`. These Admin routes have no new feature flag and are reachable through the normal application shell.

On desktop the navigation is a slate side rail; mobile and tablet use a labeled, focus-managed Radix navigation dialog. Routes own navigation rather than a hidden local section state. Language and theme controls use the existing context. Closing mobile navigation returns focus to the menu button; selecting a route moves focus to the content.

## API and state ownership

- `GET /v1/admin/providers` accepts `status=ALL`, `query` (display name/email), `userId` (exact linked account), `limit` and `cursor`. Omitting status retains the legacy pending-review default.
- `GET /v1/admin/users` retains its existing search, role, status and cursor contract.
- Both full directories keep filters and the current cursor in the URL; the previous-page trail uses native router history state so URLs stay bounded. Reload and browser Back preserve the trail. A copied cursor link without history offers a clearly labeled first-page action. Changing a filter resets pagination. A review link carries a local `returnTo` that restores the directory and its current page. Only `/admin/providers` and `/admin/reviews` return destinations are accepted.
- Previous/next controls use server cursors and do not filter a partial result locally. They expose records beyond the first 50 and disable while a request is pending.
- Embedded legacy verification queues now expose their server pagination through local cursor history. Their filters reset that history.
- Provider list/detail/audit/verification metadata and user list/detail require fresh `user:read:any`, in addition to authentication and the existing Admin role boundary. Restricted document bytes still have their separate evidence-view authorization.
- Account status, roles, Admin access-request status, provider acceptance and effective work permission remain distinct facts. The directory does not derive work permissions from an ACTIVE label.

Account and provider directories preserve the existing soft-delete boundary. They do not expose deleted records or implement account deletion. Backend status mutations retain their existing authorization, self-protection and audit behavior.

## Validation

Focused component tests exercise complete-provider status selection, deep-link filters, account lookup, server cursor pagination, return links, filter reset and permission failures. Existing user-control tests also exercise pagination beyond the first page. The legacy verification queue has a next/previous/reset regression test. HTTP controller tests exercise revoked read permissions on the new protected read paths using the real permission guard with a controlled permission resolver.

Browser and persisted integration acceptance are tracked separately in `TEST_PLAN.md`; component fixtures and controller fakes do not establish visual or real-database acceptance.
