'use strict';

// Shared, read-only knowledge about a generated Prisma Client.
//
// `prisma generate` writes the JavaScript client first and installs the query
// engine last, by copying it to `<engine>.tmp<N>` and renaming that over the
// engine. On Windows the rename fails with EPERM while any process has the
// engine loaded, which leaves a NEW index.js/schema.prisma/package.json next to
// the OLD engine. Those three files are therefore not evidence that generation
// finished. Only the guarded generator (generate-client.cjs) writes the
// completion record defined here, after the engine has been checked; every
// failed or interrupted attempt removes it first.
//
// Nothing in this module installs, generates, loads an engine, connects to a
// database or prints file contents.

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const RECORD_FILE = '.hsm-generation.json';
const RECORD_SCHEMA_VERSION = 1;
const LOCK_SUFFIX = '.generate-lock';
const REQUIRED_OUTPUTS = ['index.js', 'index.d.ts', 'schema.prisma', 'package.json', 'default.js'];
// Prisma's own in-flight copy, e.g. query_engine-windows.dll.node.tmp35664.
const PRISMA_ENGINE_TEMP = /^(?:lib)?query_engine-[A-Za-z0-9._-]+\.node\.tmp\d+$/u;

function schemaFingerprint(schema) {
  // Prisma reformats field-column whitespace in its generated schema copy.
  // Compare lexical tokens, keeping quoted values and comments exactly, and
  // normalize CRLF because Windows checkouts can differ from generated LF.
  const tokens = schema
    .replace(/\r\n/gu, '\n')
    .match(
      /"(?:\\[\s\S]|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\.[0-9]+)?|[^\s]/gu,
    );
  return createHash('sha256')
    .update(JSON.stringify(tokens ?? []))
    .digest('hex');
}

/** The `output` of the `generator client` block, resolved from the schema. */
function generatorOutput(schemaPath, schemaText) {
  const block = /generator\s+client\s*\{([\s\S]*?)\}/u.exec(schemaText.replace(/\r\n/gu, '\n'));
  if (!block) throw new GenerationStateError('The schema has no generator client block.');
  const body = block[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
  const output = /^\s*output\s*=\s*"([^"]+)"\s*$/mu.exec(body);
  if (!output) {
    throw new GenerationStateError(
      'The generator client block has no output path; the guard needs an explicit output.',
    );
  }
  return path.resolve(path.dirname(schemaPath), output[1]);
}

class GenerationStateError extends Error {}

/**
 * Facts the generated index.js states about itself: client and engine
 * versions, engine type and the native binary target. Read as text; the
 * client is never required here.
 */
function clientFacts(indexJs) {
  const pick = (pattern) => pattern.exec(indexJs)?.[1] ?? null;
  const nativeTarget =
    /\{\s*"fromEnvVar":\s*[^,]+,\s*"value":\s*"([A-Za-z0-9._-]+)",\s*"native":\s*true\s*\}/u.exec(
      indexJs,
    )?.[1] ?? null;
  const engines = [
    ...new Set(
      [...indexJs.matchAll(/["']((?:lib)?query_engine-[A-Za-z0-9._-]+\.node)["']/gu)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
  return {
    clientVersion: pick(/"clientVersion":\s*"([^"]+)"/u),
    engineVersion: pick(/"engineVersion":\s*"([0-9a-f]{40})"/u),
    engineType: pick(/"engineType":\s*"([a-z]+)"/u),
    nativeTarget,
    engines,
  };
}

/** Library-engine file name Prisma uses for a binary target. */
function libraryEngineFile(target) {
  if (target === 'windows') return 'query_engine-windows.dll.node';
  if (target.startsWith('darwin')) return `libquery_engine-${target}.dylib.node`;
  return `libquery_engine-${target}.so.node`;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close().catch(() => {});
  }
  return hash.digest('hex');
}

async function isRegularFile(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

function lockPath(output) {
  return `${output}${LOCK_SUFFIX}`;
}

/**
 * Is `file` mapped or held exclusively by another process? Opening for
 * read/write without writing changes nothing; Windows refuses it with EBUSY
 * while the engine is loaded (the same condition that makes Prisma's rename
 * fail with EPERM). Returns 'free', 'missing', 'busy' or 'denied'.
 */
async function engineAccess(file) {
  let handle;
  try {
    handle = await fs.open(file, 'r+');
    return 'free';
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    if (error.code === 'EBUSY') return 'busy';
    if (error.code === 'EPERM' || error.code === 'EACCES') return 'denied';
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Read-only verification of a generated client against its completion
 * record. Returns a list of controlled problem codes (empty when complete).
 */
async function generationProblems({
  schemaPath,
  expectedClientVersion,
  platform = process.platform,
  arch = process.arch,
}) {
  let schemaText;
  try {
    schemaText = await fs.readFile(schemaPath, 'utf8');
  } catch {
    return ['schema-unreadable'];
  }
  let output;
  try {
    output = generatorOutput(schemaPath, schemaText);
  } catch {
    return ['generator-output-unknown'];
  }
  const problems = [];
  try {
    await fs.access(lockPath(output));
    problems.push('generation-in-progress-or-interrupted');
  } catch {
    // No lock: no generation is running or was cut off mid-way.
  }
  const missing = [];
  for (const file of REQUIRED_OUTPUTS) {
    if (!(await isRegularFile(path.join(output, file)))) missing.push(file);
  }
  if (missing.length) return [...problems, 'outputs-incomplete'];

  let record;
  try {
    record = JSON.parse(await fs.readFile(path.join(output, RECORD_FILE), 'utf8'));
  } catch {
    return [...problems, 'record-missing'];
  }
  if (record?.schemaVersion !== RECORD_SCHEMA_VERSION || record.state !== 'complete') {
    return [...problems, 'record-invalid'];
  }
  if (record.schema !== schemaFingerprint(schemaText)) problems.push('record-schema-stale');
  if (expectedClientVersion && record.clientVersion !== expectedClientVersion) {
    problems.push('record-version-stale');
  }
  if (record.platform !== platform || record.arch !== arch)
    problems.push('record-platform-differs');

  let facts;
  try {
    facts = clientFacts(await fs.readFile(path.join(output, 'index.js'), 'utf8'));
  } catch {
    return [...problems, 'client-unreadable'];
  }
  if (
    facts.clientVersion !== record.clientVersion ||
    facts.engineVersion !== record.engineVersion
  ) {
    // The JS client was rewritten after the record: a later, unfinished run.
    problems.push('client-differs-from-record');
  }
  const recorded = record.engines && typeof record.engines === 'object' ? record.engines : {};
  if (record.engineType === 'library') {
    if (!record.nativeEngine || !Object.hasOwn(recorded, record.nativeEngine)) {
      problems.push('native-engine-unrecorded');
    }
    for (const [name, digest] of Object.entries(recorded)) {
      const file = path.join(output, name);
      if (!(await isRegularFile(file))) {
        problems.push('engine-missing');
        break;
      }
      if ((await sha256File(file)) !== digest) {
        problems.push('engine-differs-from-record');
        break;
      }
    }
  }
  return problems;
}

module.exports = {
  RECORD_FILE,
  RECORD_SCHEMA_VERSION,
  LOCK_SUFFIX,
  REQUIRED_OUTPUTS,
  PRISMA_ENGINE_TEMP,
  GenerationStateError,
  schemaFingerprint,
  generatorOutput,
  clientFacts,
  libraryEngineFile,
  sha256File,
  lockPath,
  engineAccess,
  generationProblems,
};
