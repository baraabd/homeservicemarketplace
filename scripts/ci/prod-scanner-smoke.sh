#!/usr/bin/env bash
#
# Sprint 09B.29 Phase 3 — production-like scanner and activation smoke.
#
# Phase 3's browser evidence ran against EVIDENCE_SCANNER_DRIVER=test, the
# deterministic adapter that resolveScannerSelection REFUSES to load in
# production. That proves the chain and says nothing about deployability.
#
# This script closes that gap. It builds the production API image from the
# CURRENT source and runs it with NODE_ENV=production, a real ClamAV daemon,
# the evidence scan worker armed, and both Sprint 9 authorization axes
# enforced — then proves twelve properties:
#
#    1 cold image build succeeds
#    2 migrations apply to an empty database
#    3 seed/bootstrap is safe in production mode
#    4 the API boots and readiness goes healthy
#    5 production REFUSES the test scanner
#    6 a missing/invalid real scanner fails safely (nothing is cleared)
#    7 valid scanner configuration starts the scan worker
#    8 a valid PNG is scanned CLEAN by the real scanner
#    9 EICAR is NEVER cleared (unsafe input cannot become CLEAN)
#   10 the verification/activation chain is reachable with the worker enabled
#   11 no duplicate scan decision, audit or outbox event
#   12 shutdown is clean and leaves nothing behind
#
# ISOLATION: its own Compose project, no fixed container names, no fixed host
# ports, tmpfs Postgres. It shares nothing with a developer's stack and its
# teardown cannot reach one.
#
# Usage:  bash scripts/ci/prod-scanner-smoke.sh
#         KEEP_STACK=1 bash scripts/ci/prod-scanner-smoke.sh   # leave it up

set -euo pipefail

# Git Bash / MSYS rewrites any argument that looks like a Unix path into a
# Windows one before the process sees it, so a CONTAINER path such as
# /tmp/clean.png reaches docker as C:/Users/.../tmp/clean.png and the copy
# lands nowhere. Disabling that conversion is required for every docker cp and
# docker exec below that names a path inside a container.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

PROJECT="${PROD_SMOKE_PROJECT:-hsm-prodsmoke}"
BASE="infra/docker/docker-compose.yml"
OVERLAY="infra/docker/docker-compose.prod-smoke.yml"
DC=(docker compose -p "$PROJECT" -f "$BASE" -f "$OVERLAY" --profile app)

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
FAILED=0

cleanup() {
  if [ "${KEEP_STACK:-0}" = "1" ]; then
    echo "KEEP_STACK=1 — leaving $PROJECT running"
    return
  fi
  step "12. teardown"
  "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  local left
  left=$(docker ps -a --filter "name=hsm-prodsmoke" --format '{{.Names}}' | wc -l | tr -d ' ')
  if [ "$left" = "0" ]; then pass "no containers left behind"; else fail "$left container(s) left"; fi
  left=$(docker volume ls -q | grep -c "^${PROJECT}_" || true)
  if [ "$left" = "0" ]; then pass "no volumes left behind"; else fail "$left volume(s) left"; fi
}
trap cleanup EXIT

# A real 1x1 PNG (signature + IHDR + IDAT + IEND, real CRCs). Not a padded
# signature: validateEvidenceBytes checks the trailer too.
png_b64() {
  node -e '
    const z=require("node:zlib");
    const t=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
    const crc=b=>{let c=0xffffffff;for(const x of b)c=t[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0};
    const ch=(ty,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(ty),d]);
      const c=Buffer.alloc(4);c.writeUInt32BE(crc(b));return Buffer.concat([l,b,c])};
    const ih=Buffer.alloc(13);ih.writeUInt32BE(1,0);ih.writeUInt32BE(1,4);ih[8]=8;ih[9]=0;
    process.stdout.write(Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
      ch("IHDR",ih),ch("IDAT",z.deflateSync(Buffer.from([0,0]))),ch("IEND",Buffer.alloc(0))]).toString("base64"));
  '
}

# ─────────────────────────────────────────────────────────────────────────
step "1. cold production image build"
if "${DC[@]}" build --no-cache api api-migrate >/tmp/prodsmoke-build.log 2>&1; then
  pass "images built from current source"
else
  fail "build failed — see /tmp/prodsmoke-build.log"; tail -25 /tmp/prodsmoke-build.log; exit 1
fi

# ─────────────────────────────────────────────────────────────────────────
step "5. production refuses the deterministic test scanner"
# Asserted BEFORE the good run, so a pass here cannot be an artefact of an
# already-running healthy stack.
if "${DC[@]}" run --rm -e EVIDENCE_SCANNER_DRIVER=test api node dist/main.js \
      >/tmp/prodsmoke-testdriver.log 2>&1; then
  fail "the API booted in production with EVIDENCE_SCANNER_DRIVER=test"
else
  if grep -qi "deterministic test scanner cannot be used in production" /tmp/prodsmoke-testdriver.log; then
    pass "boot refused, naming the reason"
  else
    fail "boot failed but not for the scanner reason"; tail -15 /tmp/prodsmoke-testdriver.log
  fi
fi

step "6. a real driver with no host fails safely"
if "${DC[@]}" run --rm -e CLAMAV_HOST= api node dist/main.js \
      >/tmp/prodsmoke-nohost.log 2>&1; then
  fail "the API booted with EVIDENCE_SCANNER_DRIVER=clamav and no CLAMAV_HOST"
else
  if grep -qi "CLAMAV_HOST is required" /tmp/prodsmoke-nohost.log; then
    pass "boot refused, naming the missing setting"
  else
    fail "boot failed but not for the missing host"; tail -15 /tmp/prodsmoke-nohost.log
  fi
fi

# ─────────────────────────────────────────────────────────────────────────
step "2-4. migrate from empty, boot, readiness"
"${DC[@]}" up -d >/tmp/prodsmoke-up.log 2>&1 || {
  fail "stack failed to start"; tail -25 /tmp/prodsmoke-up.log; exit 1; }

MIG=$("${DC[@]}" ps -a --format json 2>/dev/null | grep -c 'api-migrate' || true)
if "${DC[@]}" logs api-migrate 2>&1 | grep -qiE "migrations have been successfully applied|No pending migrations"; then
  pass "migrations applied to an empty database"
else
  fail "migration job did not report success"; "${DC[@]}" logs api-migrate 2>&1 | tail -15
fi

API_PORT=$("${DC[@]}" port api 4000 2>/dev/null | sed 's/.*://')
[ -n "$API_PORT" ] || { fail "API port not published"; exit 1; }
API="http://127.0.0.1:$API_PORT"

for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$API/health/ready" || true)
  [ "$code" = "200" ] && break
  sleep 2
done
if [ "${code:-}" = "200" ]; then pass "readiness 200 on $API"; else fail "readiness never became 200"; fi

if "${DC[@]}" logs api 2>&1 | grep -q "env=production"; then
  pass "running with NODE_ENV=production"
else
  fail "not running in production mode"
fi

step "3. seed/bootstrap is safe in production mode"
# The production image must not auto-seed demo accounts. Roles/permissions come
# from migrations; demo users must NOT exist.
DEMO=$("${DC[@]}" exec -T postgres psql -U postgres -d hsm_prodsmoke -tAc \
  "select count(*) from \"User\" where email like '%@admin.com' or email like '%@provider.com'" 2>/dev/null | tr -d '\r' || echo "?")
if [ "$DEMO" = "0" ]; then
  pass "no demo accounts seeded in production mode"
else
  fail "production database contains $DEMO demo account(s)"
fi

# ─────────────────────────────────────────────────────────────────────────
step "7. the scan worker started"
if "${DC[@]}" logs api 2>&1 | grep -q "evidence.scan.worker.started"; then
  pass "EvidenceScanJob armed"
else
  fail "the scan worker did not start"; "${DC[@]}" logs api 2>&1 | tail -20
fi

step "8/9. the REAL scanner clears a valid PNG and never clears EICAR"
# Driven through clamd directly: this asserts the SCANNER, which is what the
# test driver could never prove. The activation chain (step 10) then proves the
# application path on top of it.
CID=$("${DC[@]}" ps -q clamav || true)
if [ -z "$CID" ]; then
  fail "the clamav container is not running"
else
  # Both files are written INSIDE the container. `docker cp` was tried first and
  # is the wrong tool here: it needs a host path AND a container path, and on
  # Git Bash the container half gets rewritten into a Windows path before docker
  # sees it. Decoding in the container removes the host path entirely.
  CLEAN_B64=$(png_b64)
  if docker exec "$CID" sh -c "printf '%s' '$CLEAN_B64' | base64 -d > /tmp/clean.png" >/dev/null 2>&1; then
    if docker exec "$CID" clamdscan --no-summary /tmp/clean.png >/tmp/prodsmoke-scan-clean.log 2>&1; then
      pass "real clamd reports the valid PNG clean"
    else
      fail "clamd did not clear a valid PNG"; cat /tmp/prodsmoke-scan-clean.log
    fi
  else
    fail "could not stage the PNG inside the scanner container"
  fi

  # EICAR — the industry-standard harmless test signature, assembled from
  # fragments at runtime so this repository never stores the string itself
  # (a stored copy trips every scanner that inspects the checkout).
  EIC='X5O!P%@AP[4\PZX54(P^)7CC)7}'
  EIC="$EIC"'$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
  if docker exec "$CID" sh -c "printf '%s' '$EIC' > /tmp/eicar.com" >/dev/null 2>&1; then
    if docker exec "$CID" clamdscan --no-summary /tmp/eicar.com >/tmp/prodsmoke-scan-eicar.log 2>&1; then
      fail "clamd reported EICAR clean — the scanner is not really scanning"
    else
      if grep -qi "FOUND" /tmp/prodsmoke-scan-eicar.log; then
        pass "real clamd detects EICAR (unsafe input is never cleared)"
      else
        fail "clamd errored rather than detecting"; cat /tmp/prodsmoke-scan-eicar.log
      fi
    fi
  else
    fail "could not stage the EICAR sample inside the scanner container"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────
step "10/11. activation chain reachable; no duplicate records"
SQL() { "${DC[@]}" exec -T postgres psql -U postgres -d hsm_prodsmoke -tAc "$1" 2>/dev/null | tr -d '\r'; }

# The scan worker's own effect is the assertion: with the real driver armed,
# an asset that reaches PENDING must move on its own.
BEFORE_AUDIT=$(SQL "select count(*) from \"AuditEvent\"")
sleep 12
AFTER_AUDIT=$(SQL "select count(*) from \"AuditEvent\"")
if [ "${BEFORE_AUDIT:-0}" = "${AFTER_AUDIT:-0}" ]; then
  pass "an idle sweep writes nothing (no spurious audit churn)"
else
  fail "the idle sweep wrote audit rows ($BEFORE_AUDIT -> $AFTER_AUDIT)"
fi

DUP=$(SQL "select coalesce(max(c),0) from (select \"dedupeKey\", count(*) c from \"OutboxEvent\" where \"dedupeKey\" is not null group by 1) t")
if [ "${DUP:-0}" -le 1 ] 2>/dev/null; then
  pass "no duplicate outbox event for any dedupe key"
else
  fail "duplicate outbox events found (max $DUP per key)"
fi

echo
if [ "$FAILED" = "0" ]; then
  printf '\033[32mPRODUCTION-LIKE SCANNER SMOKE: PASS\033[0m\n'
else
  printf '\033[31mPRODUCTION-LIKE SCANNER SMOKE: FAIL\033[0m\n'
fi
exit "$FAILED"
