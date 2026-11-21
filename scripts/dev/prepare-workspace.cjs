'use strict';

// Development startup may refresh derived Prisma code after a pull/schema
// change. It never repairs dependencies, changes configuration or touches a
// database. The read-only doctor/preflight remain separate entry points.
const fs = require('node:fs/promises');
const path = require('node:path');
const { ROOT, toolchainProblems } = require('../runtime/toolchain.cjs');
const { inspectWorkspaceState } = require('./workspace-state.cjs');
const { pnpmInvocation, executePnpm, RepairError } = require('./repair.cjs');
const { apiPort, availablePort } = require('./preflight.cjs');

class PreparationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function blocked(issues) {
  return new PreparationError(
    issues.map((entry) => entry.message).join('\n') +
      '\nDevelopment startup stopped. Stop related watchers and run pnpm dev:repair for dependency recovery; no packages were installed.',
  );
}

async function assertApiStopped(root, environment) {
  const port = await apiPort(root, environment);
  if (!(await availablePort(port))) {
    throw new PreparationError(
      `API port ${port} is occupied or unavailable. Stop the related API watcher before regenerating Prisma. No process was killed and nothing was regenerated.`,
    );
  }
}

async function prepareWorkspace({
  root = ROOT,
  environment = process.env,
  args = [],
  checkToolchain = toolchainProblems,
  inspect = inspectWorkspaceState,
  checkApiStopped = assertApiStopped,
  execute = executePnpm,
  log = console.log,
} = {}) {
  if (args.length) throw new PreparationError('Dev workspace preparation takes no arguments.');
  if (
    environment.NODE_ENV === 'production' ||
    ['prod', 'production'].includes(environment.APP_ENV)
  ) {
    throw new PreparationError('Development preparation must not run in a production environment.');
  }
  const runtimeProblems = await checkToolchain(root);
  if (runtimeProblems.length) throw new PreparationError(runtimeProblems.join('; '));
  // Reuse the exact invoking pnpm without a shell, including Windows paths
  // with spaces. This never resolves/downloads another package manager.
  const invocation = pnpmInvocation(environment);
  const initial = await inspect(root);
  if (!initial.issues.length) {
    log('PASS dev workspace is current. No generation or dependency changes were needed.');
    return { generated: false };
  }
  if (!initial.canRegenerate) throw blocked(initial.issues);
  const eligible = await inspect(root, { forGeneration: true });
  // Another guarded generator may have finished between the two inspections.
  if (!eligible.issues.length) return { generated: false };
  if (!eligible.canRegenerate) throw blocked(eligible.issues);
  await checkApiStopped(root, environment);

  const lockfile = path.join(root, 'pnpm-lock.yaml');
  let locked;
  try {
    locked = await fs.readFile(lockfile);
  } catch {
    throw new PreparationError(
      'Restore pnpm-lock.yaml from the selected revision before starting.',
    );
  }
  async function assertLockfile() {
    let current;
    try {
      current = await fs.readFile(lockfile);
    } catch {
      throw new PreparationError(
        'The lockfile became unreadable during preparation. Stop and inspect it.',
      );
    }
    if (!locked.equals(current)) {
      throw new PreparationError(
        'The lockfile changed during preparation. Stop and inspect it; no changes were reverted.',
      );
    }
  }
  async function step(label, args) {
    log(label);
    try {
      await execute(invocation, args, { root, environment });
    } catch (error) {
      throw new PreparationError(
        'Development preparation failed; startup and later steps were not run. Fix the command error above before starting again.',
        error instanceof RepairError ? error.exitCode : 1,
      );
    }
    await assertLockfile();
  }
  async function assertFresh() {
    const current = await inspect(root);
    if (current.issues.length) throw blocked(current.issues);
  }

  log(
    'Prisma artifacts need regeneration. Preparing with installed pinned dependencies; no installation or migrations will run.',
  );
  await step('1/2 Generate the current Prisma Client with its engine/lock guards', [
    '--filter',
    '@homeservicemarketplace/database',
    'generate',
  ]);
  await assertFresh();
  await step('2/2 Typecheck the API and build its workspace dependencies', [
    '--filter',
    '@homeservicemarketplace/api',
    'typecheck',
  ]);
  await assertFresh();
  log(
    'PASS dev workspace preparation and API typecheck. API, database and browser readiness are checked separately.',
  );
  return { generated: true };
}

module.exports = { PreparationError, prepareWorkspace, assertApiStopped };

if (require.main === module) {
  prepareWorkspace({ args: process.argv.slice(2) }).catch((error) => {
    const controlled = error instanceof PreparationError || error instanceof RepairError;
    console.error(
      `FAIL ${controlled ? error.message : 'Dev workspace preparation failed. Inspect the local command output; startup was stopped.'}`,
    );
    process.exitCode = controlled ? error.exitCode : 1;
  });
}
