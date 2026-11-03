# K06 operator runbook: administrator workflows

For administrators operating the launch. It covers only behaviour verified at
`6be58f44`. Policy values (identity method, dispute windows, support targets)
come from K02 and are **not** defined here.

## Ground rules

- The server decides. Anything the dashboard hides or greys out has been
  refused by the API, and a different browser or client does not change that.
- You cannot decide anything about your own account or your own provider
  profile: no self-suspension, self-review, self-approval or self-reactivation,
  and you cannot decide your own admin access request.
- Use only synthetic accounts in non-production environments. Never upload a
  real identity document to staging.

## Removing an administrator

There is **no API or screen** that removes the `admin` role. If it is removed
directly in the database:

1. Delete the `UserRole` row for the `admin` role.
2. **Also revoke the user's sessions** (suspend then restore the account, or
   revoke their `Session` rows). This logs them out everywhere.

Since K06, step 1 alone already stops every admin decision on the next request.
Step 2 still matters because it ends their sockets and their claim-only screens.

## Users

- **Suspend or lock**: Users → status. Every session is revoked in the same
  transaction, and the user's next request is refused. The reason you type is
  not stored; the audit records only its length.
- **Restore** does not bring sessions back. The user signs in again.
- **Last administrator**: suspending the only active administrator is refused
  (409). Approve or restore a second administrator first.

## Provider applications

1. Open the application from Provider review. Decide on the **revision you
   loaded**. If anything changed, the API answers "This review changed. Reload
   it before deciding" (409). Reload and review again.
2. **Approve** requires every blocker to be clear: current submission,
   approved specialty, verification evidence present, scanned `CLEAN` and
   physically available.
3. **Request changes** sends field-level feedback to the provider. You can ask
   to correct an identity document only if one was already submitted; you
   cannot use feedback to demand a new document. Whether identity documents
   are collected at all is K02's decision (BLOCKED_INPUTS B-1).
4. Two reviewers deciding at once: one wins, and the other gets 409.

## Restricted identity evidence

- Opening a document needs `verification:evidence:view`. Every open, allowed
  or refused, is written to the access log.
- "Document access is temporarily unavailable" (503) means the access log could
  not be written, so the document was **not** shown. Retry later, and do not
  work around it.
- Unscanned, failed-scan, quarantined or erased documents are never shown.

## Settings

- Settings marked **not in effect** (for example `default_currency` and
  `platform_fee_bps`) are not read by the platform and cannot be changed.
  Changing a currency setting does not change any amount.
- `disputes.self_service.intake` is the dispute pilot policy (see below).
  Every change is versioned in the setting history and audited.

## Support

- Admin → Support lists every ticket. Replying, closing or reopening needs
  `support:respond`; `support:read` only reads.
- Each reply, close or reopen sends the requester **one** in-app notification
  that links to the ticket in the app they wrote from. The notification never
  contains your reply text. Retrying the same reply does not notify twice.
- A closed ticket accepts no new messages; reopen it to continue.
- There is no assignment, SLA or alert for new requester messages
  (BLOCKED_INPUTS B-4). Check the queue on a schedule.
- Suspended accounts cannot sign in, so they cannot reach in-app support. Use
  the approved out-of-band channel once K02 defines one.

## Disputes: pilot only

- Intake is **closed** unless `disputes.self_service.intake` holds a valid,
  enabled policy. Its shape is `version`, `enabled`, `pilotUserIds` (1–500 ids),
  `allowedBookingStates` and `terminalWindowHours`. **Use only K02-approved
  values.** An invalid value is refused and intake stays closed.
- Anyone not in `pilotUserIds` sees "not enabled" and a link to support. This
  is not a public dispute service.
- To stop the pilot: delete the setting, or set `enabled: false`. Existing
  cases stay readable.
