import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Sprint 09B.29 Phase 5 — the gate runner is reusable infrastructure, so it is
// tested like any other.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §4
//
// It exists because this sprint twice reported a green result over a red
// command — once in Phase 4 (`grep | tee` swallowed Jest's exit 1) and once in
// Phase 5 (`| tail -1 && echo OK` swallowed two compile errors). The whole
// value of the script is the ONE property asserted below: the code it prints
// and exits with belongs to the command it ran, not to anything downstream.
//
// A helper that is trusted to report failure and is never tested on a FAILING
// command is exactly the shape of the defect it was written to prevent.

const SCRIPT = join(__dirname, '..', '..', '..', '..', 'scripts', 'ci', 'run-gate.sh');

function runGate(
  name: string,
  args: string[],
  logDir: string,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('bash', [SCRIPT, name, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GATE_LOG_DIR: logDir },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('run-gate.sh reports the command’s own exit code', () => {
  let logDir: string;

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'hsm-gate-spec-'));
  });
  afterEach(() => {
    rmSync(logDir, { recursive: true, force: true });
  });

  it('exits 0 and prints rc=0 for a succeeding command', () => {
    const { status, stdout } = runGate('ok', ['true'], logDir);

    expect(status).toBe(0);
    expect(stdout).toContain('GATE ok rc=0');
  });

  it('exits NON-ZERO and prints the real code for a failing command', () => {
    // The assertion the two historical defects would both have failed.
    const { status, stdout } = runGate('fails', ['bash', '-c', 'exit 3'], logDir);

    expect(status).toBe(3);
    expect(stdout).toContain('GATE fails rc=3');
  });

  it('is not fooled by a command that writes a great deal to stdout first', () => {
    // The Phase 4 shape: lots of output, then a failure. A pipeline would have
    // reported the status of whatever consumed that output.
    const { status, stdout } = runGate(
      'noisy',
      ['bash', '-c', 'for i in $(seq 1 500); do echo line $i; done; exit 1'],
      logDir,
    );

    expect(status).toBe(1);
    expect(stdout).toContain('GATE noisy rc=1');
  });

  it('is not fooled by a command that fails on STDERR only', () => {
    const { status, stdout } = runGate('stderr', ['bash', '-c', 'echo boom >&2; exit 2'], logDir);

    expect(status).toBe(2);
    expect(stdout).toContain('rc=2');
  });

  it('captures the command’s output to a log rather than the terminal', () => {
    // Output is logged so a caller can summarise without a pipe — which is the
    // habit that caused the defect in the first place.
    runGate('logged', ['bash', '-c', 'echo hello-from-the-gate'], logDir);

    expect(readFileSync(join(logDir, 'logged.log'), 'utf8')).toContain('hello-from-the-gate');
  });

  it('names the log on failure, and only on failure', () => {
    const failed = runGate('bad', ['bash', '-c', 'exit 1'], logDir);
    const passed = runGate('good', ['true'], logDir);

    expect(failed.stderr).toContain('FAILED');
    expect(failed.stderr).toContain('bad.log');
    expect(passed.stderr).toBe('');
  });

  it('refuses to report success when given no command', () => {
    // A typo in a caller must not silently become a passing gate.
    const { status } = runGate('empty', [], logDir);

    expect(status).not.toBe(0);
  });

  it('sanitises the gate name into a safe log filename', () => {
    // Gate names carry spaces and slashes ("web typecheck:e2e"), and a name is
    // not a path.
    runGate('web typecheck:e2e', ['true'], logDir);

    expect(() => readFileSync(join(logDir, 'web-typecheck-e2e.log'), 'utf8')).not.toThrow();
  });

  it('is executable through bash on this platform', () => {
    // The repository's other CI scripts are invoked the same way; this asserts
    // the file is at the path the runner expects.
    expect(() =>
      execFileSync('bash', [SCRIPT, 'smoke', 'true'], { encoding: 'utf8' }),
    ).not.toThrow();
  });
});
