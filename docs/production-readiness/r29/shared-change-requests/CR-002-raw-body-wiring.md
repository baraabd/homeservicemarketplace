# CR-002 — Exact raw-body route and application ingress

State: **INTEGRATION_PENDING**, not applied. Coordinator-owned exact paths:

- `apps/api/src/infrastructure/http/request-body.ts`
- `apps/api/src/infrastructure/http/request-body.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/app.module.spec.ts`

Minimal parser patch, before the existing JSON parser:

```diff
   const router = express.Router();
+  router.post('/v1/money/webhooks/stripe', express.raw({
+    type: 'application/json', limit: 65_536, inflate: false,
+  }));
```

Preserve the existing error normalizer. Do not install a prefix/wildcard raw
parser or weaken media/mail body handling. The controller independently requires
JSON, a Buffer and a scalar signature, rejects Content-Encoding, and delegates
to official signature validation before any application write. Parser tests
must verify bytes/whitespace, 413 bounds, unsupported encoding, malformed
signature, GET/suffix routes and unchanged ordinary JSON/media/mail handling.

Register `StripeWebhookModule.register({ imports: [MoneyModule,
stripeTransport] })` exactly once in AppModule, where `stripeTransport` is the
single reviewed transport module instance from CR-003. The ingress imports
the existing money command service; the transport module does not import it.
Keep dependency direction acyclic and do not recreate MoneyCommandService.

Only `POST /v1/money/webhooks/stripe` carries the existing `@Public()` method
metadata. JwtAuthGuard already exits on public metadata without setting cookie
transport; CsrfGuard therefore needs **no change and no new exemption**. The
existing signature verification remains mandatory. Retain rate limiting and
allowlisted request logging; no request body, signature or client token logging.

Endpoint event subscription is only `payment_intent.succeeded` at the exact
pinned API version in the assigned test account. Unsupported, unpaid, wrong-mode
or wrong-account events fail; they do not receive an invented durable receipt.
Dashboard/endpoint registration is an owner-authorized external action and was
not performed. No migration, account grant, cookie change or live activation.

Required integrated test: real AppModule parser, guards, HTTP, PostgreSQL, Redis,
configured rail router and authentic Stripe sandbox signature. The isolated
controller tests in R29 do not establish that global integration.
