'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, PNPM_VERSION, toolchainProblems } = require('../runtime/toolchain.cjs');
const {
  generatorOutput,
  engineAccess,
} = require('../../packages/database/scripts/prisma-generation.cjs');

class RepairError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function pnpmInvocation(environment = process.env, platform = process.platform) {
  const version = /^pnpm\/([^ ]+)(?: |$)/u.exec(environment.npm_config_user_agent ?? '')?.[1];
  if (version !== PNPM_VERSION) {
    throw new RepairError(`Run pnpm dev:repair with the pinned pnpm ${PNPM_VERSION}.`);
  }
  const entry = environment.npm_execpath;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (typeof entry !== 'string' || !paths.isAbsolute(entry)) {
    throw new RepairError('Run pnpm dev:repair from the repository root.');
  }
  // Reuse the invoking pnpm, not a different global resolver. Execute JS
  // through Node without a shell: Windows .cmd shims and paths with spaces
  // must not be interpolated into a command string.
  if (/\.(?:cjs|mjs|js)$/iu.test(entry)) {
    return { file: process.execPath, prefix: [entry] };
  }
  if (/^pnpm(?:\.exe)?$/iu.test(paths.basename(entry))) {
    return { file: entry, prefix: [] };
  }
  throw new RepairError('Unsupported pnpm launcher. Run corepack pnpm dev:repair.');
}

function executePnpm(invocation, args, { root, environment }) {
  const result = spawnSync(invocation.file, [...invocation.prefix, ...args], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new RepairError(
      'Recovery command failed; later steps were not run. Fix the command error above and retry.',
      Number.isInteger(result.status) && result.status > 0 ? result.status : 1,
    );
  }
}

/**
 * Refuse before any install if this checkout's generated query engine is
 * loaded by a running process: install and generation would both fail part-way
 * on Windows. Read-only; it opens the engine for writing and closes it.
 */
async function busyEngines(root) {
  const schemaPath = path.join(root, 'packages/database/prisma/schema.prisma');
  let output;
  try {
    output = generatorOutput(schemaPath, await fs.readFile(schemaPath, 'utf8'));
  } catch {
    return [];
  }
  let names;
  try {
    names = (await fs.readdir(output)).filter((name) =>
      /^(?:lib)?query_engine-[A-Za-z0-9._-]+\.node$/u.test(name),
    );
  } catch {
    return [];
  }
  const busy = [];
  for (const name of names) {
    if ((await engineAccess(path.join(output, name))) === 'busy')
      busy.push(path.join(output, name));
  }
  return busy;
}

function engineHolders(engine) {
  // Loaded lazily: only needed for the message, and only on Windows.
  return require('../../packages/database/scripts/generate-client.cjs').windowsEngineHolders(
    engine,
  );
}

async function repairWorkspace({
  root = ROOT,
  environment = process.env,
  args = [],
  checkToolchain = toolchainProblems,
  execute = executePnpm,
  log = console.log,
  findBusyEngines = busyEngines,
  listHolders = engineHolders,
} = {}) {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--force')) {
    throw new RepairError('Usage: pnpm dev:repair [--force]');
  }
  if (environment.NODE_ENV === 'production' || environment.APP_ENV === 'production') {
    throw new RepairError('Development recovery must not run in a production environment.');
  }
  const runtimeProblems = await checkToolchain(root);
  if (runtimeProblems.length) throw new RepairError(runtimeProblems.join('; '));
  const invocation = pnpmInvocation(environment);
  const lockfile = path.join(root, 'pnpm-lock.yaml');
  let locked;
  try {
    locked = await fs.readFile(lockfile);
  } catch {
    throw new RepairError('Restore pnpm-lock.yaml from the selected revision before recovery.');
  }
  async function assertLockfile() {
    let current;
    try {
      current = await fs.readFile(lockfile);
    } catch {
      throw new RepairError('The lockfile became unreadable during recovery. Stop and inspect it.');
    }
    if (!locked.equals(current)) {
      throw new RepairError(
        'The lockfile changed during recovery. Stop and inspect it; no changes were reverted.',
      );
    }
  }
  async function step(label, command) {
    log(label);
    await execute(invocation, command, { root, environment });
    await assertLockfile();
  }
  const busy = await findBusyEngines(root);
  if (busy.length) {
    const holders = listHolders(busy[0]);
    throw new RepairError(
      [
        `The Prisma query engine ${path.relative(root, busy[0])} is loaded by a running process, so recovery would fail part-way.`,
        ...(holders?.length
          ? [
              `Processes that have it loaded: ${holders.map((h) => `${h.name} (PID ${h.pid})`).join(', ')}.`,
            ]
          : []),
        'Stop the API dev server (Ctrl+C in its terminal), Prisma Studio and test runs that use this checkout, then run pnpm dev:repair again. Nothing was changed.',
      ].join('\n'),
    );
  }
  log('Stop API and web watchers before recovery, especially on Windows.');
  log(
    'Recovery installs locked dependencies and regenerates code; it does not run migrations or start services.',
  );
  const install = ['install', '--frozen-lockfile', '--prod=false'];
  if (args.includes('--force')) install.push('--force');
  await step('1/4 Install locked workspace dependencies', install);
  await step('2/4 Generate Prisma Client for this checkout', [
    '--filter',
    '@homeservicemarketplace/database',
    'generate',
  ]);
  // Inspect in a fresh child process. Reusing module resolution after an
  // install can otherwise retain paths from the previous dependency tree.
  await step('3/4 Verify installed pins and generated schema', [
    'exec',
    'node',
    'scripts/dev/workspace-state.cjs',
  ]);
  await step('4/4 Typecheck the API and build its workspace dependencies', [
    '--filter',
    '@homeservicemarketplace/api',
    'typecheck',
  ]);
  log(
    'PASS workspace recovery and API typecheck. This is not native-module, database or application readiness.',
  );
  log('Next: pnpm --filter @homeservicemarketplace/api dev');
}

module.exports = { RepairError, pnpmInvocation, executePnpm, repairWorkspace };

if (require.main === module) {
  repairWorkspace({ args: process.argv.slice(2) }).catch((error) => {
    console.error(
      `FAIL ${error instanceof RepairError ? error.message : 'Workspace recovery failed; inspect permissions and the command output. No rollback was attempted.'}`,
    );
    process.exitCode = error instanceof RepairError ? error.exitCode : 1;
  });
}
