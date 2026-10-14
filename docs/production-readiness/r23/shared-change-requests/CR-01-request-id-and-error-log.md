# CR-01 — request-id agreement and path-only error logging

Owner of the files: coordinator. Requested by: R23. Dependency or migration
consequences: none.

## Paths

- `apps/api/src/infrastructure/http/request-id.middleware.ts`
- `apps/api/src/infrastructure/http/all-exceptions.filter.ts`

## Reason

1. pino-http runs before `RequestIdMiddleware`. R23 made the logger validate
   the inbound `x-request-id` (it used to log the raw header). For an
   **invalid** header both layers now mint a UUID, but independently: the log
   line carries UUID A while the response header and the error body carry
   UUID B. A support engineer given B cannot find the request in the logs.
   This mismatch already existed at base for invalid headers; R23 did not
   introduce it, but it now matters because logs are the correlation path.
2. `AllExceptionsFilter` logs `path: req.url`, which includes the query string.
   R23's log scrubber removes secret-shaped values (`token=`, `otp=` …), but
   ordinary query values such as a search term or a name stay. The filter
   should log the path only, like the request serializer now does.

## Minimal patch

```diff
--- a/apps/api/src/infrastructure/http/request-id.middleware.ts
+++ b/apps/api/src/infrastructure/http/request-id.middleware.ts
@@
   use(req: Request, res: Response, next: NextFunction): void {
-    const incoming = req.header(REQUEST_ID_HEADER);
-    const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
+    // pino-http's genReqId runs first and has already validated or minted
+    // an id; reuse it so the log and the response carry the same value.
+    const existing = typeof req.id === 'string' && SAFE_ID.test(req.id) ? req.id : undefined;
+    const incoming = req.header(REQUEST_ID_HEADER);
+    const id = existing ?? (incoming && SAFE_ID.test(incoming) ? incoming : randomUUID());
     req.id = id;
     res.setHeader(REQUEST_ID_HEADER, id);
     next();
```

```diff
--- a/apps/api/src/infrastructure/http/all-exceptions.filter.ts
+++ b/apps/api/src/infrastructure/http/all-exceptions.filter.ts
@@
+import { pathOnly } from '../logger/redaction';
@@
-        path: req.url,
+        path: pathOnly(req.originalUrl ?? req.url),
@@
-      this.logger.debug({ msg: 'Handled exception', status, code, requestId, path: req.url });
+      this.logger.debug({ msg: 'Handled exception', status, code, requestId, path: pathOnly(req.originalUrl ?? req.url) });
```

## Tests

- `request-id.middleware.spec.ts` (new, beside the middleware): invalid
  header → the id set by `generateRequestId` is kept and echoed.
- `all-exceptions.filter.spec.ts`: a 500 on `/x?q=Jane` logs `path: '/x'`.
- Re-run `logger.privacy.spec.ts`.

## Alternative mount for the HTTP telemetry middleware

If the coordinator prefers global middleware to be visible in `AppModule`,
remove `configure()` from `MetricsModule` and add to `AppModule.configure`:

```ts
consumer.apply(RequestIdMiddleware, HttpTelemetryMiddleware).forRoutes('*');
```
