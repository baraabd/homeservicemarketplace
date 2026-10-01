'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, 'install-minio-fixture.sh');
const resolvedVersion = 'v0.0.0-20251015172955-fixturecommit';

function fixture(t, mode, version = 'go1.24.8') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-minio-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const dest = path.join(root, 'dest');
  const count = path.join(root, 'count');
  fs.mkdirSync(bin, { recursive: true });

  const fakeGo = `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "env" && "\${2:-}" == "GOVERSION" ]]; then
  printf '%s\\n' "\${FAKE_GO_VERSION:-go1.24.8}"
  exit 0
fi
if [[ "\${1:-}" == "list" ]]; then
  if [[ "\${FAKE_GO_MODE:-}" == "transient-list-then-success" ]]; then
    n=0
    if [[ -f "$COUNT_FILE.list" ]]; then n="$(cat "$COUNT_FILE.list")"; fi
    n=$((n + 1))
    printf '%s' "$n" > "$COUNT_FILE.list"
    if [[ "$n" -eq 1 ]]; then
      echo 'sum.golang.org: stream error: stream ID 7; INTERNAL_ERROR' >&2
      exit 1
    fi
  fi
  printf '%s\\n' "$RESOLVED_VERSION"
  exit 0
fi
if [[ "\${1:-}" == "version" && "\${2:-}" == "-m" ]]; then
  embedded="$RESOLVED_VERSION"
  if [[ "\${FAKE_GO_MODE:-}" == "success-wrong-module" ]]; then
    embedded='v0.0.0-wrong'
  fi
  printf '%s\\n' "/fixture/minio: go1.24.8"
  printf '\\tpath\\tgithub.com/minio/minio\\n'
  printf '\\tmod\\tgithub.com/minio/minio\\t%s\\th1:fixture\\n' "$embedded"
  exit 0
fi
if [[ "\${1:-}" != "install" ]]; then
  echo "unexpected fake-go command: $*" >&2
  exit 91
fi
n=0
if [[ -f "$COUNT_FILE" ]]; then n="$(cat "$COUNT_FILE")"; fi
n=$((n + 1))
printf '%s' "$n" > "$COUNT_FILE"
case "$FAKE_GO_MODE" in
  nonnetwork)
    echo 'compile: undefined fixture symbol' >&2
    exit 2
    ;;
  transient-then-success)
    if [[ "$n" -eq 1 ]]; then
      echo 'sum.golang.org: stream error: stream ID 7; INTERNAL_ERROR' >&2
      exit 1
    fi
    ;;
  transient-always)
    echo 'proxy.golang.org: 503 Service Unavailable' >&2
    exit 1
    ;;
  transient-list-then-success|success-wrong-module)
    ;;
  *)
    echo 'unknown fake mode' >&2
    exit 92
    ;;
esac
mkdir -p "$GOBIN"
printf '#!/usr/bin/env bash\\nexit 0\\n' > "$GOBIN/minio"
chmod +x "$GOBIN/minio"
`;
  fs.writeFileSync(path.join(bin, 'go'), fakeGo, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

  return {
    root,
    dest,
    count,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      COUNT_FILE: count,
      FAKE_GO_MODE: mode,
      FAKE_GO_VERSION: version,
      RESOLVED_VERSION: resolvedVersion,
    },
  };
}

function run(t, mode, version) {
  const f = fixture(t, mode, version);
  const result = spawnSync('bash', [script, f.dest], {
    env: f.env,
    encoding: 'utf8',
    timeout: 10_000,
  });
  const attempts = fs.existsSync(f.count) ? Number(fs.readFileSync(f.count, 'utf8')) : 0;
  return { ...f, result, attempts };
}

test('a non-network build failure is never retried', (t) => {
  const { result, attempts } = run(t, 'nonnetwork');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(attempts, 1);
  assert.match(result.stderr, /non-network reason/);
});

test('one recognized install transport failure may retry and then succeed', (t) => {
  const { result, attempts } = run(t, 'transient-then-success');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(attempts, 2);
  assert.match(result.stdout, /checksum-verified MinIO source/);
  assert.match(result.stdout, new RegExp(resolvedVersion));
});

test('a recognized module-resolution transport failure may retry and then succeed', (t) => {
  const { result, attempts, count } = run(t, 'transient-list-then-success');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(attempts, 1);
  assert.equal(Number(fs.readFileSync(`${count}.list`, 'utf8')), 2);
});

test('recognized transport failures remain bounded to three install attempts', (t) => {
  const { result, attempts } = run(t, 'transient-always');
  assert.equal(result.status, 1);
  assert.equal(attempts, 3);
  assert.match(result.stderr, /after three checksum-verified network attempts/);
});

test('a successful build with mismatched embedded module metadata still fails', (t) => {
  const { result, attempts } = run(t, 'success-wrong-module');
  assert.equal(result.status, 1);
  assert.equal(attempts, 1);
  assert.match(result.stderr, /module metadata does not match/);
});

test('an unexpected Go toolchain fails before module resolution or install', (t) => {
  const { result, attempts } = run(t, 'transient-then-success', 'go1.24.7');
  assert.equal(result.status, 1);
  assert.equal(attempts, 0);
  assert.match(result.stderr, /Expected go1\.24\.8/);
});
