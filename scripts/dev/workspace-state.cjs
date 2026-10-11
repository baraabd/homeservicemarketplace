'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const INSTALL = 'pnpm install --frozen-lockfile';
const GENERATE = 'pnpm --filter @homeservicemarketplace/database generate';
const TYPECHECK = 'pnpm --filter @homeservicemarketplace/api typecheck';
const GENERATED_OUTPUTS = ['index.js', 'index.d.ts', 'schema.prisma', 'package.json'];

async function json(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function schemaFingerprint(schema) {
  // Prisma formats field-column whitespace in the generated schema copy.
  // Compare lexical tokens, preserving quoted values and comments exactly;
  // blindly stripping whitespace would miss changes such as "a b" -> "ab".
  // Normalize CRLF because Windows checkouts can differ from generated LF.
  const tokens = schema
    .replace(/\r\n/gu, '\n')
    .match(
      /"(?:\\[\s\S]|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\.[0-9]+)?|[^\s]/gu,
    );
  return createHash('sha256')
    .update(JSON.stringify(tokens ?? []))
    .digest('hex');
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
  return problems;
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
