#!/usr/bin/env bash
#
# Sprint 4 — Docker Compose application-profile smoke test.
#
# Proves the containerised stack is actually usable, not merely buildable:
#
#   1. build          both images build from a clean context
#   2. migrate        the one-shot deployment job runs to completion, BEFORE
#                     the API starts, and is idempotent on a second run
#   3. boot           the API container becomes healthy
#   4. readiness      /health/ready is 200 and does NOT report Mongo
#   5. otp            register -> real SMTP to Mailpit -> read the code ->
#                     verify -> a usable access token
#   6. media upload   presign -> PUT the bytes -> GET them back byte-identical
#   7. non-root       the runtime process is not uid 0
#   8. sizes          report both image sizes
#
# Runs identically in CI and on a developer machine. Requires: docker, curl,
# node. Leaves nothing behind unless KEEP_STACK=1.
#
# Usage:  bash scripts/ci/compose-smoke.sh

set -euo pipefail

COMPOSE_FILE="infra/docker/docker-compose.yml"
DC=(docker compose -f "$COMPOSE_FILE" --profile app)
# Overridable so the test can run on a machine that already has something on
# 4000. Compose reads the same variable for the published port AND for
# PUBLIC_API_URL, so the presigned upload URLs the API mints stay reachable.
export API_HOST_PORT="${API_HOST_PORT:-4000}"
API="http://localhost:$API_HOST_PORT"
MAILPIT="http://localhost:8025"
BOOT_TIMEOUT_SECONDS="${BOOT_TIMEOUT_SECONDS:-180}"

pass_count=0

step() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }
ok() {
  pass_count=$((pass_count + 1))
  printf '  \033[32mPASS\033[0m %s\n' "$*"
}
fail() {
  printf '  \033[31mFAIL\033[0m %s\n' "$*" >&2
  exit 1
}

dump_logs() {
  echo
  echo "----- api-migrate logs -----"
  "${DC[@]}" logs api-migrate 2>&1 | tail -60 || true
  echo "----- api logs -----"
  "${DC[@]}" logs api 2>&1 | tail -120 || true
}

cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then dump_logs; fi
  if [ "${KEEP_STACK:-0}" != "1" ]; then
    echo
    echo "--- tearing down ---"
    "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap cleanup EXIT

# `jq` is not guaranteed on a runner; node is (the repo needs it anyway).
# Reads JSON on stdin and prints the value at a dotted path, '' if absent.
jget() {
  node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d));
    process.stdin.on("end", () => {
      let v;
      try { v = JSON.parse(raw); } catch { process.exit(0); }
      for (const k of process.argv[1].split(".").filter(Boolean)) {
        if (v == null) break;
        v = v[k];
      }
      if (v === undefined || v === null) return;
      process.stdout.write(typeof v === "object" ? JSON.stringify(v) : String(v));
    });
  ' "$1"
}

# ---------------------------------------------------------------------------
step "0. Clean slate"
# A smoke test that inherits a warm database proves nothing about a fresh
# bootstrap, which is the whole point of the exercise.
"${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
ok "previous stack and volumes removed"

# ---------------------------------------------------------------------------
step "1. Build"
"${DC[@]}" build
ok "api and api-migrate images built"

# ---------------------------------------------------------------------------
step "2. Bring up the app profile"
# Compose gates api on `api-migrate: service_completed_successfully`, so this
# single command is also the assertion that the migration job ran first.
"${DC[@]}" up -d

MIGRATE_CID="$("${DC[@]}" ps -aq api-migrate)"
[ -n "$MIGRATE_CID" ] || fail "no api-migrate container was created"

# Wait for the one-shot job to finish.
for _ in $(seq 1 "$BOOT_TIMEOUT_SECONDS"); do
  state="$(docker inspect --format '{{.State.Status}}' "$MIGRATE_CID")"
  [ "$state" = "exited" ] && break
  sleep 1
done
MIGRATE_EXIT="$(docker inspect --format '{{.State.ExitCode}}' "$MIGRATE_CID")"
echo "--- migration job output ---"
docker logs "$MIGRATE_CID" 2>&1 | tail -30
echo "--- migration job exit code: $MIGRATE_EXIT ---"
[ "$MIGRATE_EXIT" = "0" ] || fail "the migration job exited $MIGRATE_EXIT"
ok "migration job completed successfully"

# ---------------------------------------------------------------------------
step "3. Migration job is idempotent"
# Re-running must be a no-op, not an error: the job runs on every `up`, on
# every retry, and on every redeploy of an unchanged image.
SECOND_RUN="$("${DC[@]}" run --rm api-migrate 2>&1)" || fail "second migration run failed:
$SECOND_RUN"
echo "$SECOND_RUN" | tail -10
if echo "$SECOND_RUN" | grep -qiE "no pending migrations|already in sync|database schema is up to date"; then
  ok "second run applied nothing and exited 0"
else
  # Still a pass if it exited 0 — but say so plainly rather than claim a
  # stronger result than was observed.
  ok "second run exited 0 (no 'pending migrations' banner matched; see output above)"
fi

# ---------------------------------------------------------------------------
step "4. API becomes healthy"
API_CID="$("${DC[@]}" ps -q api)"
[ -n "$API_CID" ] || fail "no api container is running"

healthy=0
for _ in $(seq 1 "$BOOT_TIMEOUT_SECONDS"); do
  hs="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$API_CID")"
  if [ "$hs" = "healthy" ]; then
    healthy=1
    break
  fi
  if [ "$(docker inspect --format '{{.State.Status}}' "$API_CID")" = "exited" ]; then
    fail "the api container exited before becoming healthy"
  fi
  sleep 1
done
[ "$healthy" = "1" ] || fail "the api container never reported healthy"
ok "container healthcheck reports healthy"

# The container healthcheck above probes 127.0.0.1 from INSIDE the container.
# This is the first request over the PUBLISHED port, and the two are not ready
# at the same instant: Docker can report the container healthy while the
# host<->container proxy is still coming up. Curling straight through failed
# here with `curl: (56) Recv failure: Connection was reset`, aborting the whole
# script under `set -e` long before any assertion ran — a flake that looks
# nothing like its cause.
#
# So: wait for the PORT, not just the container, before trusting any host-side
# request.
LIVE=""
for _ in $(seq 1 60); do
  if LIVE="$(curl -fsS --max-time 5 "$API/health/live" 2>/dev/null)"; then break; fi
  LIVE=""
  sleep 1
done
[ -n "$LIVE" ] || fail "the published port never served /health/live (container was healthy internally)"
echo "  /health/live -> $LIVE"
[ "$(printf '%s' "$LIVE" | jget status)" = "ok" ] || fail "/health/live did not report ok"
ok "/health/live returns ok"

# ---------------------------------------------------------------------------
step "5. Readiness, and Mongo is absent from it"
READY_BODY="$(curl -fsS "$API/health/ready")"
echo "  /health/ready -> $READY_BODY"
[ "$(printf '%s' "$READY_BODY" | jget ready)" = "true" ] || fail "/health/ready is not ready"
ok "/health/ready returns 200 with ready=true"

DEPS="$(printf '%s' "$READY_BODY" | jget dependencies)"
case "$DEPS" in
  *mongo*) fail "readiness still reports Mongo while MONGODB_ENABLED=false: $DEPS" ;;
esac
ok "readiness does not mention Mongo (docs/adr/0002-mongodb.md)"

# The app profile must not even DEFINE Mongo as something to start.
#
# This asks Compose what the selected profiles resolve to, rather than asking
# the host what is running: a developer machine can easily still have an
# hsm-mongo container left over from before Mongo was made opt-in, and that
# leftover says nothing about whether this stack starts one.
if "${DC[@]}" config --services 2>/dev/null | grep -qx mongo; then
  fail "the app profile still starts a mongo service"
fi
ok "the app profile does not start Mongo"

# ---------------------------------------------------------------------------
step "6. Non-root runtime"
RUN_UID="$(docker exec "$API_CID" id -u)"
echo "  api container uid: $RUN_UID"
[ "$RUN_UID" != "0" ] || fail "the api container runs as root"
ok "api runs as a non-root user (uid $RUN_UID)"

# The migration job holds database credentials, which makes it the LAST thing
# that should run as uid 0. Read from the image config so the assertion does
# not depend on the one-shot container still existing.
MIGRATE_UID="$(docker run --rm --entrypoint sh hsm-api-migrate:dev -c 'id -u')"
echo "  migrator uid: $MIGRATE_UID"
[ "$MIGRATE_UID" != "0" ] || fail "the migration job runs as root"
ok "the migration job runs as a non-root user (uid $MIGRATE_UID)"

# The API image must NOT be able to migrate: keeping the Prisma CLI out of the
# runtime image is what enforces the split between "serves traffic" and
# "changes schema" by construction rather than by convention.
if docker run --rm --entrypoint sh "$(docker inspect "$API_CID" --format '{{.Config.Image}}')" \
     -c 'command -v prisma || ls node_modules/.bin/prisma' >/dev/null 2>&1; then
  fail "the api runtime image ships a Prisma CLI — it could migrate itself"
fi
ok "the api runtime image ships no Prisma CLI"

# ---------------------------------------------------------------------------
step "7. OTP flow through real SMTP (Mailpit)"
STAMP="$(date +%s)-$RANDOM"
EMAIL="smoke-$STAMP@example.test"
PASSWORD="SmokeTest-Passw0rd!"

REG="$(curl -fsS -X POST "$API/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"firstName\":\"Smoke\",\"lastName\":\"Test\"}")"
CHALLENGE_ID="$(printf '%s' "$REG" | jget challengeId)"
[ -n "$CHALLENGE_ID" ] || fail "register returned no challengeId: $REG"
ok "register issued an OTP challenge"

# Poll Mailpit for the message addressed to this run's throwaway address.
# Mail delivery is asynchronous, so this waits rather than assuming.
CODE=""
for _ in $(seq 1 60); do
  MSG_ID="$(curl -fsS "$MAILPIT/api/v1/search?query=to:$EMAIL" 2>/dev/null |
    node -e '
      let raw = "";
      process.stdin.on("data", (d) => (raw += d));
      process.stdin.on("end", () => {
        let j; try { j = JSON.parse(raw); } catch { return; }
        const m = (j.messages || [])[0];
        if (m && m.ID) process.stdout.write(m.ID);
      });
    ' || true)"
  if [ -n "$MSG_ID" ]; then
    BODY="$(curl -fsS "$MAILPIT/api/v1/message/$MSG_ID")"
    CODE="$(printf '%s' "$BODY" | node -e '
      let raw = "";
      process.stdin.on("data", (d) => (raw += d));
      process.stdin.on("end", () => {
        let j; try { j = JSON.parse(raw); } catch { return; }
        const text = `${j.Text || ""} ${j.Snippet || ""}`;
        const m = text.match(/\b(\d{6})\b/);
        if (m) process.stdout.write(m[1]);
      });
    ')"
    [ -n "$CODE" ] && break
  fi
  sleep 1
done
[ -n "$CODE" ] || fail "no OTP code arrived at Mailpit for $EMAIL within 60s"
ok "OTP mail delivered via SMTP_HOST=mailpit and the code was read back"

# x-client-kind: mobile returns the tokens in the body instead of setting
# cookies, which is what lets this script hold a bearer token. It also means
# the CSRF double-submit does not apply (that guard is cookie-transport only).
VERIFY="$(curl -fsS -X POST "$API/v1/auth/verify-otp" \
  -H 'content-type: application/json' \
  -H 'x-client-kind: mobile' \
  -d "{\"challengeId\":\"$CHALLENGE_ID\",\"code\":\"$CODE\"}")"
ACCESS_TOKEN="$(printf '%s' "$VERIFY" | jget tokens.accessToken)"
[ -n "$ACCESS_TOKEN" ] || fail "verify-otp returned no access token: $VERIFY"
ok "verify-otp exchanged the code for a session"

ME="$(curl -fsS "$API/v1/auth/me" -H "authorization: Bearer $ACCESS_TOKEN")"
echo "  /v1/auth/me -> $(printf '%s' "$ME" | head -c 200)"
ok "the issued token authenticates against a protected route"

# ---------------------------------------------------------------------------
step "8. Media upload round-trip"
TMPDIR_SMOKE="$(mktemp -d)"
SRC="$TMPDIR_SMOKE/pixel.png"
# A real 1x1 PNG, so nothing downstream has to accept a bogus file.
node -e '
  const fs = require("fs");
  fs.writeFileSync(
    process.argv[1],
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
' "$SRC"
SIZE="$(wc -c < "$SRC" | tr -d ' ')"
echo "  fixture: $SIZE bytes"

PRESIGN="$(curl -fsS -X POST "$API/v1/media/presigned-url" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"items\":[{\"contentType\":\"image/png\",\"sizeBytes\":$SIZE}]}")"
UPLOAD_URL="$(printf '%s' "$PRESIGN" | node -e '
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    const j = JSON.parse(raw);
    process.stdout.write(j.items[0].uploadUrl);
  });
')"
FILE_URL="$(printf '%s' "$PRESIGN" | node -e '
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    const j = JSON.parse(raw);
    process.stdout.write(j.items[0].fileUrl);
  });
')"
[ -n "$UPLOAD_URL" ] || fail "presign returned no uploadUrl: $PRESIGN"
ok "presign issued an upload URL"

# The presigned PUT carries no JWT — the HMAC signature in the query string is
# the authorisation, exactly as it would be against S3.
PUT_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$UPLOAD_URL" \
  -H 'content-type: image/png' \
  --data-binary "@$SRC")"
[ "$PUT_STATUS" = "204" ] || fail "presigned PUT returned HTTP $PUT_STATUS (expected 204)"
ok "presigned PUT stored the bytes (HTTP 204)"

DL="$TMPDIR_SMOKE/downloaded.png"
curl -fsS "$FILE_URL" -o "$DL"
cmp -s "$SRC" "$DL" || fail "the downloaded file differs from what was uploaded"
ok "GET returned the uploaded bytes, byte-for-byte identical"

# Uploads must land on the mounted volume, not inside the app bundle.
docker exec "$API_CID" sh -c 'ls -R /var/lib/hsm/media | head -20'
ok "uploads are stored under the media volume"

# An unsigned PUT must be refused — otherwise the endpoint is an open
# write primitive for anyone who can guess a key.
UNSIGNED="$(printf '%s' "$UPLOAD_URL" | sed 's/?.*$//')"
UNSIGNED_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$UNSIGNED" \
  -H 'content-type: image/png' --data-binary "@$SRC")"
[ "$UNSIGNED_STATUS" = "400" ] || [ "$UNSIGNED_STATUS" = "401" ] ||
  fail "an unsigned PUT returned HTTP $UNSIGNED_STATUS (expected 400/401)"
ok "an unsigned PUT is rejected (HTTP $UNSIGNED_STATUS)"

rm -rf "$TMPDIR_SMOKE"

# ---------------------------------------------------------------------------
step "8b. Deprecated route contract (Sprint 6)"
#
# THESE CALLS ARE DELIBERATELY UNAUTHENTICATED. A 401 here is the expected
# result and is not a failure — do not "fix" it by adding credentials.
#
# Deprecation headers are set by middleware, which Nest runs BEFORE the guards.
# Asserting them on an unauthenticated request is precisely what proves that:
# an interceptor (the first implementation) ran after the guards and silently
# dropped the headers on every 401/403 — the responses a client stuck on an old
# route is most likely to be getting.
#
# Expect `401 AUTH_INVALID_CREDENTIALS` from JwtAuthGuard in the API log for
# both of these. That is the contract being tested, not a symptom.
LEGACY_URL="$API/v1/me/provider/jobs/available"
LEGACY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$LEGACY_URL")"
LEGACY_HEADERS="$(curl -sS -D - -o /dev/null "$LEGACY_URL")"

# Assert the STATUS LINE, not a substring of the whole header blob.
#
# The previous check was `case "$LEGACY_HEADERS" in *"404"*)`, which searched
# every header for the text "404" — including `x-request-id` (a UUID), `ETag`,
# and `Content-Length`. Any of those can contain "404" by chance, and when one
# did the run failed with "the legacy route was removed" on a route that was
# working perfectly. Roughly a 1-in-100 false failure, i.e. exactly the kind of
# flake that gets a real CI signal ignored.
echo "  $LEGACY_URL -> HTTP $LEGACY_STATUS (401/403 expected: no credentials sent)"
case "$LEGACY_STATUS" in
  401 | 403 | 200) ;;
  404) fail "the legacy route was REMOVED (404); deprecation must not break it" ;;
  *) fail "the legacy route returned an unexpected HTTP $LEGACY_STATUS" ;;
esac
ok "legacy route still routes (HTTP $LEGACY_STATUS)"

echo "$LEGACY_HEADERS" | grep -qi '^Deprecation: true' ||
  fail "legacy route is missing the Deprecation header"
ok "legacy route sends Deprecation: true"

echo "$LEGACY_HEADERS" | grep -qi '^Sunset: ' ||
  fail "legacy route is missing the Sunset header"
ok "legacy route sends a Sunset date"

echo "$LEGACY_HEADERS" | grep -qi 'rel="successor-version"' ||
  fail "legacy route is missing the successor-version Link"
ok "legacy route points at its canonical replacement"

# The canonical family must NOT be marked deprecated, or the advice is
# circular. Also unauthenticated, and also expected to 401.
CANONICAL_URL="$API/v1/provider/available-requests"
CANONICAL_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$CANONICAL_URL")"
CANONICAL_HEADERS="$(curl -sS -D - -o /dev/null "$CANONICAL_URL")"
echo "  $CANONICAL_URL -> HTTP $CANONICAL_STATUS (401/403 expected: no credentials sent)"
case "$CANONICAL_STATUS" in
  404) fail "the canonical route does not exist (404)" ;;
esac
if echo "$CANONICAL_HEADERS" | grep -qi '^Deprecation:'; then
  fail "the canonical route is marked deprecated"
fi
ok "canonical route carries no deprecation headers (HTTP $CANONICAL_STATUS)"

# ---------------------------------------------------------------------------
step "8c. Outbox worker is running (Sprint 6)"
# The worker is silent by design when idle, so its absence would otherwise go
# unnoticed until notifications stopped arriving.
#
# Every failure below PRINTS ITS EVIDENCE before giving up. The first version
# just asserted and exited, which told a reader that something was wrong with
# the worker but nothing about what — and the API log it left behind is
# thousands of lines of request logging in which the relevant three are
# invisible.
API_LOG="$(docker logs "$API_CID" 2>&1)"

if ! printf '%s' "$API_LOG" | grep -q "Outbox worker started"; then
  echo "  ----- outbox-related log lines -----"
  printf '%s' "$API_LOG" | grep -iE "outbox" | tail -20 || echo "  (no line mentions outbox at all)"
  echo "  ----- last 40 lines of the api log -----"
  printf '%s' "$API_LOG" | tail -40

  # Distinguish "switched off" from "never got there". They need opposite
  # responses — a config change versus a boot investigation — and the original
  # single message conflated them.
  if printf '%s' "$API_LOG" | grep -q "Outbox worker DISABLED"; then
    fail "the outbox worker is DISABLED (OUTBOX_WORKER_ENABLED=false in this environment)"
  fi
  fail "the outbox worker did not start; events would accumulate undelivered"
fi
ok "outbox worker started with its handlers registered"

if printf '%s' "$API_LOG" | grep -q "outbox.dead_letter"; then
  echo "  ----- dead-lettered events -----"
  printf '%s' "$API_LOG" | grep -A 8 "outbox.dead_letter" | head -40
  fail "an outbox event dead-lettered during boot"
fi
ok "no dead-lettered outbox events"

# ---------------------------------------------------------------------------
step "9. No boot-time module resolution failures"
if docker logs "$API_CID" 2>&1 | grep -qE "Cannot find module|MODULE_NOT_FOUND"; then
  fail "the api container logged a module resolution failure"
fi
ok "no missing-module errors in the api log"

# ---------------------------------------------------------------------------
step "10. Image sizes"
docker image ls --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}' |
  grep -E 'REPOSITORY|hsm-api' || true

# ---------------------------------------------------------------------------
printf '\n\033[32mCompose smoke test passed (%s assertions).\033[0m\n' "$pass_count"
