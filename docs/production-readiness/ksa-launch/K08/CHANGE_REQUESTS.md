# K08 change requests to owning lanes

K08 does not hold a lease on these files. `apps/web/src/app/features/subscriptions/StripePlanPurchase*.tsx`
and `stripe-purchase.api*.ts` are in the G3 coordinator single-writer allowlist
(`post-r18/gates/g3/evidence/ALLOWLIST.json`). K08 does not widen that
allowlist. Fixes are proposed to the owner as reviewed patches.

## CR-K08-01 — Same-tab same-plan second purchase replays the first purchase (P1)

**Owner:** G3 coordinator (StripePlanPurchase component lease). **Status:**
reproduced locally and fix verified locally; not applied to any branch.

**Defect.** `stripePurchaseKeys(userId, planId)` persists the intent, attempt
and resume `Idempotency-Key` values in tab `sessionStorage` under
`hsm:stripe-purchase:<user>:<plan>`. Nothing ever removes them. Tab
`sessionStorage` survives reload and sign-out/sign-in. The server stores and
replays the original command response for a reused key and the same request
(`MoneyCommandService.command`). So after a server-confirmed purchase, an
explicit second purchase of the same plan version in the same tab sends the
first purchase's intent key and attempt key. It receives the old intent and
attempt, and no distinct new purchase is possible in that tab.

**Reproduction.** Run `StripePlanPurchase.same-tab.test.tsx` from the patch.
It uses the real key module, real jsdom `sessionStorage` and an explicit Axios
HTTP double. Unmount plus remount models reload and sign-out/sign-in. On
unmodified `92770ea6`, the test `a confirmed purchase does not absorb a second explicit purchase
after reload/sign-in` fails with `expected 1 to be 2` (one distinct intent key
across two purchases). The two controls pass: pending keeps its key, and a
transport error does not rotate the key.

**Fix (patch `patches/CR-K08-01-same-tab-purchase-identity.patch`, SHA-256
`57d975068b770537d08b748b1b30d6cfef07b492380a9aef8f6ef39206b5fb53`).**

- Adds `retireStripePurchaseKeys(userId, planId, keys)`. It compares and
  removes, deleting the stored identity only if it is exactly the given one, so
  a newer identity is never discarded.
- `StripePlanPurchase.loadSession` calls it only when the server session reports
  `CONFIRMED`. The server derives `CONFIRMED` live from
  `intent.status === 'SUCCEEDED'` (`stripe-session.service.ts`), not from a
  replayed snapshot.
- Keys are never rotated on `PROCESSING`, unknown outcome, timeout, transport
  error or failure, so pending purchases recover with their original identity.
- No server, contract, schema, authority or copy change. Browser storage still
  grants nothing.

**Local results with the patch applied (component evidence only):** the
subscriptions feature passes 44 of 44 tests in 6 files, with 0 failed and 0
skipped. Web typecheck exit 0, scoped ESLint exit 0, Prettier check exit 0.

**Still required before acceptance:** the real-API scenario with Stripe test
mode (B3). Complete purchase 1, check that the webhook drives `SUCCEEDED`,
reload, sign out and sign in in the same tab, then make purchase 2. Assert a
distinct intent and attempt, a distinct resulting subscription period, exactly
one ledger effect per purchase, and that a replayed webhook does not change the
ledger total. Whether the server permits a second purchase of the same plan
version while a period is active is a server policy question; the server must
answer it, not the client.

**Residual edge (documented, not fixed):** if a purchase is confirmed by webhook
while the tab is closed, the next "Review" in that tab first replays the old
intent. The user then sees it confirmed and the identity is retired, so a
further explicit action gets fresh keys. No duplicate effect is possible. The
replayed amount display comes from the stored original response.

## CR-K08-02 — Checkout is offered when payment is disabled (P1, launch truthfulness)

**Owner:** G3 coordinator / R33 owner. Needs a product decision. **Status:**
found by source inspection; not reproduced in a browser.

`MyPlanScreen.tsx` renders `<StripePlanPurchase>` for every catalogue plan
unconditionally. No web code reads `VITE_STRIPE_SANDBOX_ENABLED`; only the CSP
builder does. With the flag off, the CSP has `frame-src 'none'` and no Stripe
script origin. The UI still offers "Review sandbox purchase" and "Continue with
this amount". The server rejects only at session time
(`STRIPE_CONFIGURATION_UNAVAILABLE` / `STRIPE_CHECKOUT_UNAVAILABLE`), which is
shown as "Payment is unavailable or the request failed. Retry…". That invites
a retry that cannot succeed. Stripe availability is enforced in the collection
adapter at dispatch (`stripe-collection.adapter.ts`), so an intent row may
already exist when the rejection arrives. That ordering is inferred from source
and was not verified at runtime.

**Proposed direction (not implemented):** a server-owned availability
projection for each payment method. Checkout renders only for available
methods, and unsupported rails show a truthful "not available" state. A client
build flag must not decide availability or grant authority. It may only keep
the CSP closed.
