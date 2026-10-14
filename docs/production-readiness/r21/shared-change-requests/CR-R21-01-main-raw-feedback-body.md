# CR-R21-01 — raw body for the signed mail-feedback route

| Field     | Value                                                         |
| --------- | ------------------------------------------------------------- |
| Path      | `apps/api/src/main.ts` (coordinator-owned; not leased to R21) |
| Requested | 2026-10-13, R21 (`feat/r21-email-production`)                 |
| Blocks    | runtime acceptance of `POST /v1/mail/feedback`                |
| Migration | none · Dependency: none (express is already a dependency)     |

## Reason

`MailFeedbackController` authenticates provider feedback with an HMAC over
the **exact request bytes**. `main.ts` mounts `express.json()` globally, so
the controller receives a parsed object and — by design — refuses every
request with 400 (it never verifies a re-serialisation). The route is
therefore mounted and safe but unusable until this one line lands.

## Minimal patch

```diff
     app.use('/v1/media/uploads', express.raw({ type: '*/*', limit: '10mb' }));
+    // R21 — delivery feedback is authenticated by an HMAC over the exact
+    // request bytes, so it must reach MailFeedbackController unparsed.
+    app.use('/v1/mail/feedback', express.raw({ type: '*/*', limit: '256kb' }));
     // JSON parser for everything else. Mounted AFTER the raw parser
     // so the raw mount wins for upload paths.
     app.use(express.json({ limit: '1mb' }));
```

## Tests

- Already covered with the same mount order in
  `apps/api/test/integration/r21-mail-feedback.integration.spec.ts`
  (`buildApp({ raw: true })`), including the fail-closed case without it.
- After applying: boot the real API and POST a signed fixture (ACCEPTANCE.md
  § Runtime checks, step R-3); expect 200 / `{applied|duplicate|unmatched}`.
