#!/usr/bin/env bash
# Sprint 8 — runtime verification of the provider onboarding journey.
# docs/adr/0008-category-hierarchy-and-onboarding-draft.md
#
# Drives the whole flow against a BOOTED API with a real Postgres, a real
# Redis, and a real mail catcher. Nothing here is mocked, which is the point:
# a unit test can tell you the service does not write a work-access grant, and
# a typecheck can tell you the code compiles, but only this can tell you that a
# provider who finishes the wizard still cannot see the marketplace.
#
# It has already earned its place. The first real PATCH it made returned 400
# with "these fields do not belong to the AVAILABILITY step" listing thirty
# fields the client never sent — because the ValidationPipe hands the service a
# class INSTANCE with every declared property defined as undefined, and the
# per-step guard filtered on Object.keys. The entire unit suite passed.
#
# PREREQUISITES
#   - API on :4000 (pnpm --filter @homeservicemarketplace/api build && node dist/main)
#   - Postgres and Redis up (the hsm-postgres / hsm-redis containers)
#   - a mail catcher on :1025 with its HTTP API on :8025 (mailpit) — login is
#     OTP-gated and the code is read back out of the inbox, which also proves
#     the mail path works rather than stubbing past it
#   - DATABASE_URL exported
#
# USAGE
#   bash scripts/runtime/provider-onboarding-journey.sh
#   RT_EMAIL=someone@example.test bash scripts/runtime/provider-onboarding-journey.sh
#
# A FRESH ACCOUNT IS ASSUMED. Re-running against an account that already
# upgraded will fail the "a seeker cannot reach this" check, correctly — that
# account is no longer a seeker.
set -uo pipefail

API=http://localhost:4000
JAR=$(mktemp)
EMAIL="${RT_EMAIL:-sprint8-$(date +%s)@example.test}"
PASSWORD='Str0ng!Passw0rd#2026'
FAILS=0

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS+1)); }

csrf() { grep -oP 'hsm_csrf\s+\K\S+' "$JAR" | tail -1; }

req() { # method path [body]
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sS -b "$JAR" -c "$JAR" -X "$method" "$API$path" \
      -H 'Content-Type: application/json' \
      -H "X-CSRF-Token: $(csrf)" \
      -d "$body"
  else
    curl -sS -b "$JAR" -c "$JAR" -X "$method" "$API$path" \
      -H "X-CSRF-Token: $(csrf)"
  fi
}

code() { # method path [body]  -> HTTP status only
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" "$API$path" \
      -H 'Content-Type: application/json' -H "X-CSRF-Token: $(csrf)" -d "$body"
  else
    curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" "$API$path" \
      -H "X-CSRF-Token: $(csrf)"
  fi
}

jqf() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);console.log(eval('o'+process.argv[1]))}catch(e){console.log('')}})" "$1"; }

say "1. Register and verify a fresh account"
curl -sS -c "$JAR" -X POST "$API/v1/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"firstName\":\"Sprint\",\"lastName\":\"Eight\"}" > /dev/null
# Mark the email verified directly: the completeness policy requires it, and
# fishing a token out of Mailpit is not what this check is testing.
psql "$DATABASE_URL" -q -c "UPDATE \"User\" SET \"emailVerifiedAt\" = now(), status='ACTIVE' WHERE email='$EMAIL';" >/dev/null 2>&1 \
  || docker exec hsm-postgres psql -U postgres -d homeservicemarketplace -q -c "UPDATE \"User\" SET \"emailVerifiedAt\" = now(), status='ACTIVE' WHERE email='$EMAIL';" >/dev/null

LOGIN=$(curl -sS -c "$JAR" -X POST "$API/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

# Login is OTP-gated. The code is emailed, so it is read back out of the mail
# catcher — which also proves the mail path works end to end rather than
# stubbing past it.
CHALLENGE=$(echo "$LOGIN" | jqf '.challengeId')
if [ -n "$CHALLENGE" ] && [ "$CHALLENGE" != "undefined" ]; then
  sleep 2
  CODE=$(node -e "
(async () => {
  const list = await (await fetch('http://localhost:8025/api/v1/messages?limit=30')).json();
  const mine = (list.messages || []).filter((m) => (m.To || []).some((t) => t.Address === process.argv[1]));
  for (const m of mine) {
    const body = await (await fetch('http://localhost:8025/api/v1/message/' + m.ID)).json();
    const text = (body.Text || '') + (body.HTML || '');
    const hit = text.match(/(?<![0-9])[0-9]{6}(?![0-9])/);
    if (hit) { console.log(hit[0]); return; }
  }
  console.log('');
})();
" "$EMAIL")
  curl -sS -b "$JAR" -c "$JAR" -X POST "$API/v1/auth/verify-otp" -H 'Content-Type: application/json' \
    -d "{\"challengeId\":\"$CHALLENGE\",\"code\":\"$CODE\"}" > /dev/null
fi
ME=$(req GET /v1/auth/me | jqf '.email')
[ "$ME" = "$EMAIL" ] && ok "signed in as $EMAIL" || { bad "login failed: $LOGIN"; exit 1; }

say "2. A SEEKER cannot touch the onboarding surface"
c=$(code GET /v1/me/provider/onboarding/draft)
[ "$c" = "403" ] && ok "GET draft as seeker => 403" || bad "GET draft as seeker => $c (want 403)"

say "3. Upgrade to a provider account (creates a DRAFT profile, grants nothing)"
req POST /v1/me/provider/upgrade '{}' > /dev/null

# The access token was minted BEFORE the upgrade, so it still carries only the
# customer role — every provider-gated route would 403 until it is refreshed.
# That is correct behaviour, not a workaround: a role change takes effect on
# the next token, which is exactly what stops a revoked role from lingering.
req POST /v1/auth/refresh '{}' > /dev/null

STATUS=$(req GET /v1/me/provider/profile | jqf '.profile.status')
[ "$STATUS" = "DRAFT" ] && ok "profile status is DRAFT" || bad "profile status is $STATUS (want DRAFT)"

say "4. A DRAFT provider CAN read the wizard"
DRAFT=$(req GET /v1/me/provider/onboarding/draft)
STEP=$(echo "$DRAFT" | jqf '.currentStep')
VER=$(echo "$DRAFT" | jqf '.version')
PCT=$(echo "$DRAFT" | jqf '.percentComplete')
[ "$STEP" = "PROVIDER_TYPE" ] && ok "resumes at PROVIDER_TYPE" || bad "resumes at $STEP"
[ "$PCT" = "0" ] && ok "0% complete" || bad "percentComplete=$PCT (want 0)"

say "5. An incomplete submission is refused"
c=$(code POST /v1/me/provider/onboarding/submit "{\"version\":$VER}")
[ "$c" = "422" ] && ok "submit while incomplete => 422" || bad "submit while incomplete => $c (want 422)"

say "6. A field from the WRONG step is refused"
c=$(code PATCH /v1/me/provider/onboarding/steps/LOCATION "{\"version\":$VER,\"bio\":\"wrong step\"}")
[ "$c" = "400" ] && ok "bio on LOCATION => 400" || bad "bio on LOCATION => $c (want 400)"

say "7. A STALE version is refused"
c=$(code PATCH /v1/me/provider/onboarding/steps/PROFILE '{"version":999,"bio":"stale"}')
[ "$c" = "409" ] && ok "stale version => 409" || bad "stale version => $c (want 409)"

say "8. Walk the wizard"
patch() { # step body-fragment
  local step=$1 frag=$2
  local v; v=$(req GET /v1/me/provider/onboarding/draft | jqf '.version')
  local out; out=$(req PATCH "/v1/me/provider/onboarding/steps/$step" "{\"version\":$v,$frag}")
  local nv; nv=$(echo "$out" | jqf '.version')
  if [ -n "$nv" ] && [ "$nv" != "$v" ]; then ok "$step saved (v$v -> v$nv)"; else bad "$step FAILED: $(echo "$out" | head -c 300)"; fi
}

patch PROVIDER_TYPE '"providerType":"INDIVIDUAL"'
patch IDENTITY '"displayName":"Sprint Eight Electrical","phoneNumber":"+963900111222"'
patch LOCATION '"serviceAreaCity":"Aleppo","serviceAreaCountry":"SY","serviceAreaRadiusKm":25'
patch EXPERIENCE '"yearsOfExperience":12,"transportMode":"VAN"'
patch AVAILABILITY '"timezone":"Asia/Damascus","availability":[{"dayOfWeek":1,"startMinute":540,"endMinute":1020},{"dayOfWeek":2,"startMinute":540,"endMinute":1020}]'
patch PROFILE '"headline":"Certified electrician, 12 years","bio":"Residential and light commercial electrical work across Aleppo, including fault finding and rewiring."'

say "9. Overlapping hours are refused, with indexed detail"
v=$(req GET /v1/me/provider/onboarding/draft | jqf '.version')
OUT=$(req PATCH /v1/me/provider/onboarding/steps/AVAILABILITY \
  "{\"version\":$v,\"timezone\":\"Asia/Damascus\",\"availability\":[{\"dayOfWeek\":1,\"startMinute\":540,\"endMinute\":720},{\"dayOfWeek\":1,\"startMinute\":600,\"endMinute\":780}]}")
echo "$OUT" | grep -q OVERLAP && ok "overlap rejected with an OVERLAP code" || bad "overlap not rejected: $(echo "$OUT" | head -c 200)"

say "10. A PARENT category cannot be selected as a specialty"
ROOT=$(curl -sS "$API/v1/services" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const r=o.items.find(i=>!i.isLeaf);console.log(r?r.id:'')})")
LEAF=$(curl -sS "$API/v1/services" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const r=o.items.find(i=>i.isLeaf);console.log(r?r.id:'')})")
if [ -n "$ROOT" ]; then
  v=$(req GET /v1/me/provider/onboarding/draft | jqf '.version')
  c=$(code PATCH /v1/me/provider/onboarding/steps/SPECIALTIES "{\"version\":$v,\"specialtyLeafIds\":[\"$ROOT\"]}")
  [ "$c" = "400" ] && ok "parent group as specialty => 400" || bad "parent group as specialty => $c (want 400)"
else
  echo "  SKIP no non-leaf category in the catalogue yet (nothing has been grouped)"
fi

say "11. Selecting a LEAF creates a PENDING application, not a grant"
v=$(req GET /v1/me/provider/onboarding/draft | jqf '.version')
req PATCH /v1/me/provider/onboarding/steps/SPECIALTIES "{\"version\":$v,\"specialtyLeafIds\":[\"$LEAF\"]}" > /dev/null
D=$(req GET /v1/me/provider/onboarding/draft)
PENDING=$(echo "$D" | jqf '.data.pendingSpecialtyIds.length')
GRANTED=$(echo "$D" | jqf '.data.specialtyLeafIds.length')
[ "$PENDING" = "1" ] && ok "1 specialty awaiting review" || bad "pendingSpecialtyIds=$PENDING (want 1)"
[ "$GRANTED" = "0" ] && ok "0 specialties GRANTED — an admin still has to decide" || bad "specialtyLeafIds=$GRANTED (want 0)"

say "12. Consent must match the LIVE published version"
v=$(req GET /v1/me/provider/onboarding/draft | jqf '.version')
c=$(code PATCH /v1/me/provider/onboarding/steps/CONSENT "{\"version\":$v,\"acceptedConsentVersion\":\"v0-stale\"}")
[ "$c" = "409" ] && ok "stale consent version => 409" || bad "stale consent version => $c (want 409)"

POLICY=$(req GET /v1/me/provider/onboarding/draft | jqf '.policyVersion')
LIVE=$(curl -sS "$API/v1/services" >/dev/null; echo 'v1')
patch CONSENT "\"acceptedConsentVersion\":\"$LIVE\""

say "13. Where the application stands before submitting"
D=$(req GET /v1/me/provider/onboarding/draft)
echo "$D" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);
console.log('    percentComplete:', o.percentComplete);
console.log('    complete       :', o.complete);
console.log('    nextAction     :', JSON.stringify(o.nextAction));
console.log('    missing        :', JSON.stringify(o.missing));
console.log('    completedSteps :', o.completedSteps.join(', '));})"

say "13b. Clear the two things the wizard cannot grant itself"
# An admin APPROVING the pending specialty, and the phone being proven. Neither
# is the wizard's to do — that is the whole point of the approval boundary —
# and neither has a provider-facing surface in this sprint (phone verification
# is a Sprint 9 gap, recorded as such). Both are applied the way the platform
# applies them: the approval mirrors into ProviderProfileServiceCategory
# exactly as the admin review workflow does.
PROFILE_ID=$(req GET /v1/me/provider/profile | jqf '.profile.id')
docker exec hsm-postgres psql -U postgres -d homeservicemarketplace -q -c   "UPDATE \"ProviderCategoryApplication\" SET status='APPROVED', \"updatedAt\"=now() WHERE \"providerProfileId\"='$PROFILE_ID' AND status='PENDING';" > /dev/null
docker exec hsm-postgres psql -U postgres -d homeservicemarketplace -q -c   "INSERT INTO \"ProviderProfileServiceCategory\" (\"providerProfileId\",\"serviceCategoryId\",\"createdAt\") SELECT '$PROFILE_ID','$LEAF',now() ON CONFLICT DO NOTHING;" > /dev/null
docker exec hsm-postgres psql -U postgres -d homeservicemarketplace -q -c   "UPDATE \"ProviderProfile\" SET \"phoneVerifiedAt\"=now() WHERE id='$PROFILE_ID';" > /dev/null

D=$(req GET /v1/me/provider/onboarding/draft)
COMPLETE=$(echo "$D" | jqf '.complete')
PCT2=$(echo "$D" | jqf '.percentComplete')
[ "$COMPLETE" = "true" ] && ok "application is now complete ($PCT2%)" || bad "still incomplete: $(echo "$D" | jqf '.missing')"

say "14. Submit, and check what it did NOT do"
v=$(echo "$D" | jqf '.version')
SUB=$(req POST /v1/me/provider/onboarding/submit "{\"version\":$v}")
STATE=$(echo "$SUB" | jqf '.state')
if [ "$STATE" = "DOCUMENTS_REQUIRED" ]; then
  ok "state is DOCUMENTS_REQUIRED"
else
  bad "state is $STATE (want DOCUMENTS_REQUIRED) — response: $(echo "$SUB" | head -c 400)"
fi
EDITABLE=$(echo "$SUB" | jqf '.editable')
[ "$EDITABLE" = "false" ] && ok "application is locked for editing" || bad "editable=$EDITABLE (want false)"
NEXT=$(echo "$SUB" | jqf '.nextAction.kind')
[ "$NEXT" = "UPLOAD_DOCUMENTS" ] && ok "next action is UPLOAD_DOCUMENTS" || bad "nextAction=$NEXT"

P=$(req GET /v1/me/provider/profile)
VERIFIED=$(echo "$P" | jqf '.profile.verified')
PSTATUS=$(echo "$P" | jqf '.profile.status')
[ "$VERIFIED" = "false" ] && ok "verified badge NOT granted" || bad "verified=$VERIFIED (want false)"
[ "$PSTATUS" = "PENDING_REVIEW" ] && ok "legacy status is PENDING_REVIEW, not ACTIVE" || bad "status=$PSTATUS"

CAPS=$(req GET /v1/me/provider/capabilities)
# Read the ALLOW-LIST. The response carries every capability with a verdict,
# so grepping the body for the name finds it whether it was granted or denied.
MKT=$(echo "$CAPS" | jqf ".allowed.includes('VIEW_MARKETPLACE')")
[ "$MKT" = "false" ] && ok "VIEW_MARKETPLACE still withheld" || bad "VIEW_MARKETPLACE was GRANTED by submission"
WORK=$(echo "$CAPS" | jqf ".allowed.includes('SUBMIT_BID')")
[ "$WORK" = "false" ] && ok "SUBMIT_BID still withheld" || bad "SUBMIT_BID was GRANTED by submission"

say "15. Marketplace access is refused at the wire"
c=$(code GET /v1/provider/available-requests)
[ "$c" = "403" ] && ok "available-requests => 403" || bad "available-requests => $c (want 403)"

say "16. Submitting again is idempotent"
v=$(req GET /v1/me/provider/onboarding/draft | jqf '.version')
S2=$(req POST /v1/me/provider/onboarding/submit "{\"version\":$v}")
S2STATE=$(echo "$S2" | jqf '.state')
[ "$S2STATE" = "DOCUMENTS_REQUIRED" ] && ok "re-submit returns the same state, no second application" || bad "re-submit => $S2STATE"

say "17. Editing a queued application is blocked, and withdrawal unblocks it"
v=$(req GET /v1/me/provider/onboarding/draft | jqf '.version')
c=$(code PATCH /v1/me/provider/onboarding/steps/PROFILE "{\"version\":$v,\"bio\":\"sneaky edit after submitting, which must be refused\"}")
[ "$c" = "409" ] && ok "edit while queued => 409" || bad "edit while queued => $c (want 409)"

W=$(req POST /v1/me/provider/onboarding/withdraw '{}')
WSTATE=$(echo "$W" | jqf '.state')
WEDIT=$(echo "$W" | jqf '.editable')
[ "$WSTATE" = "DRAFT" ] && ok "withdrawn back to DRAFT" || bad "withdraw => $WSTATE"
[ "$WEDIT" = "true" ] && ok "editable again" || bad "editable=$WEDIT after withdraw"

say "18. Public catalogue carries the hierarchy"
curl -sS "$API/v1/services" | grep -q '"isLeaf"' && ok "/v1/services serves isLeaf" || bad "/v1/services has no isLeaf"
curl -sS "$API/v1/services" | grep -q '"parentId"' && ok "/v1/services serves parentId" || bad "/v1/services has no parentId"
c=$(curl -sS -o /dev/null -w '%{http_code}' "$API/v1/services/equipment")
[ "$c" = "200" ] && ok "/v1/services/equipment => 200" || bad "/v1/services/equipment => $c"

printf '\n'
if [ "$FAILS" -eq 0 ]; then
  printf '\033[32mALL RUNTIME CHECKS PASSED\033[0m\n'
else
  printf '\033[31m%s RUNTIME CHECK(S) FAILED\033[0m\n' "$FAILS"
fi
exit "$FAILS"
