'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const {
  schemaFingerprint,
  generationProblems,
} = require('../../packages/database/scripts/prisma-generation.cjs');

const ROOT = path.resolve(__dirname, '../..');
const INSTALL = 'pnpm install --frozen-lockfile';
const GENERATE = 'pnpm --filter @homeservicemarketplace/database generate';
const TYPECHECK = 'pnpm --filter @homeservicemarketplace/api typecheck';
const GENERATED_OUTPUTS = ['index.js', 'index.d.ts', 'schema.prisma', 'package.json'];
const RELEASE =
  'Stop the API dev server, Prisma Studio and test runs that use this checkout (they keep the query engine loaded)';

// Controlled text for each code from prisma-generation.cjs. Never a path
// outside the repository, file contents or an environment value.
const GENERATION_MESSAGES = {
  'generation-in-progress-or-interrupted': `A Prisma generation is running for this checkout, or the last one was interrupted. Wait for a running generation to finish; otherwise run ${GENERATE}, then ${TYPECHECK}.`,
  'outputs-incomplete': `Generated Prisma client is incomplete. ${RELEASE}, run ${GENERATE}, then ${TYPECHECK}.`,
  'record-missing': `Generated Prisma client has no completion record: the last generation failed or was interrupted (for example EPERM on the query engine), or it predates this check. ${RELEASE}, run ${GENERATE}, then ${TYPECHECK}.`,
  'record-invalid': `Generated Prisma client completion record is not valid. ${RELEASE}, run ${GENERATE}, then ${TYPECHECK}.`,
  'record-schema-stale': `Generated Prisma client was completed for a different schema. ${RELEASE}, run ${GENERATE}, then ${TYPECHECK}.`,
  'record-version-stale': `Generated Prisma client was completed for a different Prisma version. Run ${INSTALL}, then ${GENERATE} and ${TYPECHECK}.`,
  'record-platform-differs': `Generated Prisma client was completed on a different platform or architecture. Run ${GENERATE} on this machine, then ${TYPECHECK}.`,
  'client-unreadable': `Generated Prisma client is unreadable. ${RELEASE}, run ${GENERATE}, then ${TYPECHECK}.`,
  'client-differs-from-record': `Generated Prisma client was rewritten by a generation that did not complete; its engine may be older than the client. ${RELEASE}, run ${GENERATE}, then ${TYPECHECK}.`,
  'native-engine-unrecorded': `Generated Prisma client records no engine for this platform. ${RELEASE}, run ${GENERATE}, then ${TYPECHECK}.`,
  'engine-missing': `The generated Prisma query engine is missing. ${RELEASE}, run ${GENERATE}, then ${TYPECHECK}.`,
  'engine-differs-from-record': `The generated Prisma query engine is not the one its completion record names. ${RELEASE}, run ${GENERATE}, then ${TYPECHECK}.`,
  'schema-unreadable':
    'Prisma source schema is missing or unreadable. Restore packages/database/prisma/schema.prisma from the selected revision before generating the client.',
  'generator-output-unknown':
    'The Prisma schema does not name the generated client output. Restore packages/database/prisma/schema.prisma from the selected revision.',
};

async function json(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function readableFile(file) {
  try {
    if (!(await fs.stat(file)).isFile()) return false;
    await fs.access(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function installedPackage(consumer, name) {
  const resolve = createRequire(path.join(consumer, 'package.json')).resolve;
  // Resolution checks that an entry exists but never evaluates it. In
  // particular, sharp's native decoder must remain lazy during API startup.
  const entry = resolve(name);
  if (!(await readableFile(entry))) throw new Error('dependency-entry-unavailable');
  // sharp exports its entry but not ./package.json. Walk from the resolved
  // entry to its owning package instead of requiring an unexported subpath.
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    try {
      const metadata = await json(path.join(directory, 'package.json'));
      if (typeof metadata.name === 'string') return metadata;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    directory = path.dirname(directory);
  }
  throw new Error('dependency-metadata-unavailable');
}

async function prismaProblems(root) {
  const database = path.join(root, 'packages/database');
  const generated = path.join(database, 'generated/prisma');
  const problems = [];
  let declaredVersion;
  let installedVersion;
  let sourceSchema;

  try {
    const manifest = await json(path.join(database, 'package.json'));
    declaredVersion = manifest.dependencies?.['@prisma/client'];
    if (typeof declaredVersion !== 'string' || !declaredVersion) throw new Error('missing-pin');
  } catch {
    problems.push(
      `Database workspace metadata is missing or invalid. Restore packages/database/package.json from the selected revision, then run ${INSTALL}.`,
    );
  }
  try {
    const installed = await installedPackage(database, '@prisma/client');
    if (installed.name !== '@prisma/client' || typeof installed.version !== 'string') {
      throw new Error('invalid-dependency-metadata');
    }
    installedVersion = installed.version;
    if (declaredVersion && installedVersion !== declaredVersion) {
      problems.push(
        `Installed Prisma client does not match the workspace pin. Stop the API watcher, run ${INSTALL}, then ${GENERATE} and ${TYPECHECK}.`,
      );
    }
  } catch {
    problems.push(
      `Prisma client dependency is missing or unreadable from packages/database. Run ${INSTALL}, then ${GENERATE} and ${TYPECHECK}.`,
    );
  }

  try {
    sourceSchema = await fs.readFile(path.join(database, 'prisma/schema.prisma'), 'utf8');
    if (!sourceSchema.trim()) throw new Error('empty-schema');
  } catch {
    problems.push(
      'Prisma source schema is missing or unreadable. Restore packages/database/prisma/schema.prisma from the selected revision before generating the client.',
    );
  }

  const complete = await Promise.all(
    GENERATED_OUTPUTS.map((file) => readableFile(path.join(generated, file))),
  );
  if (complete.some((exists) => !exists)) {
    problems.push(
      `Generated Prisma client is incomplete. Stop the API watcher, run ${GENERATE}, then ${TYPECHECK}.`,
    );
    return problems;
  }

  try {
    const generatedSchema = await fs.readFile(path.join(generated, 'schema.prisma'), 'utf8');
    if (sourceSchema && schemaFingerprint(sourceSchema) !== schemaFingerprint(generatedSchema)) {
      problems.push(
        `Generated Prisma client is stale for the current schema. Stop the API watcher, run ${GENERATE}, then ${TYPECHECK}.`,
      );
    }
    const metadata = await json(path.join(generated, 'package.json'));
    if (
      typeof metadata.version !== 'string' ||
      (declaredVersion && metadata.version !== declaredVersion) ||
      (installedVersion && metadata.version !== installedVersion)
    ) {
      problems.push(
        `Generated Prisma client version does not match its dependency. Run ${INSTALL}, stop the API watcher, then run ${GENERATE} and ${TYPECHECK}.`,
      );
    }
  } catch {
    problems.push(
      `Generated Prisma client metadata is unreadable. Stop the API watcher, run ${GENERATE}, then ${TYPECHECK}.`,
    );
  }
  if (problems.length) return problems;
  // The files above are written before Prisma installs the query engine, so
  // they are not evidence that generation finished (see prisma-generation.cjs).
  const codes = await generationProblems({
    schemaPath: path.join(database, 'prisma/schema.prisma'),
    expectedClientVersion: installedVersion ?? declaredVersion,
  });
  return [
    ...new Set(
      codes.map((code) => GENERATION_MESSAGES[code] ?? GENERATION_MESSAGES['record-invalid']),
    ),
  ];
}

async function sharpProblems(root) {
  try {
    const api = path.join(root, 'apps/api');
    const declared = (await json(path.join(api, 'package.json'))).dependencies?.sharp;
    const installed = await installedPackage(api, 'sharp');
    if (
      typeof declared !== 'string' ||
      !declared ||
      installed.name !== 'sharp' ||
      installed.version !== declared
    ) {
      throw new Error('dependency-pin-mismatch');
    }
    return [];
  } catch {
    return [
      `API sharp dependency is missing, unreadable or does not match its workspace pin. Run ${INSTALL}, then ${TYPECHECK}.`,
    ];
  }
}

/** Read-only diagnostics. No module loading, generation, installation, cache
 * repair, environment loading, database connection or migration occurs here.
 * Every message is controlled text; raw filesystem/package errors stay private. */
async function workspaceStateProblems(root = ROOT) {
  const results = await Promise.all([prismaProblems(root), sharpProblems(root)]);
  return results.flat();
}

module.exports = { workspaceStateProblems };

if (require.main === module) {
  if (process.argv.length > 2) {
    console.error('Usage: node scripts/dev/workspace-state.cjs');
    process.exitCode = 1;
  } else {
    workspaceStateProblems()
      .then((problems) => {
        for (const problem of problems) console.error(`FAIL ${problem}`);
        if (problems.length) process.exitCode = 1;
        else {
          console.log(
            'PASS workspace dependency metadata and generated Prisma freshness. This is not native-module, database or application readiness.',
          );
        }
      })
      .catch(() => {
        console.error(
          'FAIL Workspace dependency state could not be checked. No files were changed.',
        );
        process.exitCode = 1;
      });
  }
}
