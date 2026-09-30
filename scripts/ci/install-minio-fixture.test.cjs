'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, 'install-minio-fixture.sh');

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
  success-wrong-version)
    ;;
  *)
    echo 'unknown fake mode' >&2
    exit 92
    ;;
esac
mkdir -p "$GOBIN"
cat > "$GOBIN/minio" <<'MINIO'
#!/usr/bin/env bash
if [[ "\${FAKE_GO_MODE:-}" == "success-wrong-version" ]]; then
  echo 'minio RELEASE.wrong'
else
  echo 'minio RELEASE.2025-10-15T17-29-55Z'
fi
MINIO
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

test('one recognized transport failure may retry and then succeed', (t) => {
  const { result, attempts } = run(t, 'transient-then-success');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(attempts, 2);
  assert.match(result.stdout, /checksum-verified MinIO source release/);
});

test('recognized transport failures remain bounded to three attempts', (t) => {
  const { result, attempts } = run(t, 'transient-always');
  assert.equal(result.status, 1);
  assert.equal(attempts, 3);
  assert.match(result.stderr, /after three checksum-verified network attempts/);
});

test('a successful command with the wrong binary identity still fails', (t) => {
  const { result, attempts } = run(t, 'success-wrong-version');
  assert.equal(result.status, 1);
  assert.equal(attempts, 1);
  assert.match(result.stderr, /does not report the pinned release/);
});

test('an unexpected Go toolchain fails before any install attempt', (t) => {
  const { result, attempts } = run(t, 'transient-then-success', 'go1.24.7');
  assert.equal(result.status, 1);
  assert.equal(attempts, 0);
  assert.match(result.stderr, /Expected go1\.24\.8/);
});
