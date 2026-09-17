'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Accept only an unfiltered, successful, complete zero-finding audit. */
function validateReport(text, status) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error('The registry audit did not return valid JSON.');
  }
  if (!isObject(report) || report.error || !isObject(report.metadata)) {
    throw new Error('Missing or unsuccessful registry audit response.');
  }
  const counts = report.metadata.vulnerabilities;
  if (
    !isObject(counts) ||
    SEVERITIES.some((severity) => !Number.isSafeInteger(counts[severity]) || counts[severity] < 0) ||
    Object.keys(counts).some((severity) => !SEVERITIES.includes(severity)) ||
    !Number.isSafeInteger(report.metadata.totalDependencies) ||
    report.metadata.totalDependencies <= 0 ||
    !isObject(report.advisories)
  ) {
    throw new Error('Incomplete audit schema; an empty or unknown response is not a clean audit.');
  }
  if (report.muted !== undefined && (!Array.isArray(report.muted) || report.muted.length > 0)) {
    throw new Error('Muted advisories are not allowed by the zero-finding policy.');
  }
  if (Object.values(counts).some((count) => count !== 0) || Object.keys(report.advisories).length > 0) {
    throw new Error(`Dependency vulnerabilities remain: ${JSON.stringify(counts)}`);
  }
  if (status !== 0) {
    throw new Error(`Audit process failed (exit ${status}); its output cannot establish success.`);
  }
  return report;
}

/** Do not allow a future config exception to turn hidden findings into zero. */
function assertNoExceptions(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.pnpm?.auditConfig && Object.keys(manifest.pnpm.auditConfig).length > 0) {
    throw new Error('pnpm.auditConfig exceptions are not permitted by this audit policy.');
  }
  for (const filename of ['pnpm-workspace.yaml', '.npmrc']) {
    const file = path.join(root, filename);
    if (!fs.existsSync(file)) continue;
    const active = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => !/^\s*[#;]/.test(line));
    if (active.some((line) => /^\s*["']?(?:auditConfig|audit-config|ignoreCves|ignoreGhsas|ignoreAdvisories|ignoreUnfixable|ignoreRegistryErrors)["']?\s*[:=]/i.test(line))) {
      throw new Error(`Audit exclusions are not permitted in ${filename}.`);
    }
  }
}

function runAudit({ root, production = false, output, execute = spawnSync }) {
  assertNoExceptions(root);
  const args = ['audit', '--json', '--audit-level', 'low', ...(production ? ['--prod'] : [])];
  const pnpmScript = process.env.npm_execpath;
  // pnpm scripts expose the JS entry point, avoiding .cmd spawning on Windows.
  const useNode = pnpmScript && /pnpm\.(?:cjs|js)$/.test(pnpmScript);
  const command = useNode ? process.execPath : 'pnpm';
  const commandArgs = useNode ? [pnpmScript, ...args] : args;
  const result = execute(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  // Keep the original response, including malformed/error output, for diagnosis.
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.stdout ?? '');
  if (result.error || result.signal) {
    throw new Error('Audit command did not complete; registry/process failures fail the gate.');
  }
  return validateReport(result.stdout, result.status);
}

function parseArgs(args) {
  let production = false;
  let output;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--prod') production = true;
    else if (args[i] === '--output' && args[i + 1] && !args[i + 1].startsWith('--')) output = args[++i];
    else throw new Error('Usage: dependency-audit.cjs [--prod] [--output report.json]');
  }
  return { production, output: output ?? (production ? 'audit-production.json' : 'audit-full.json') };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const root = path.resolve(__dirname, '../..');
    const report = runAudit({ ...options, root, output: path.resolve(root, options.output) });
    console.log(`${options.production ? 'Production' : 'Full-tree'} audit: ${JSON.stringify(report.metadata.vulnerabilities)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Dependency audit failed.');
    process.exitCode = 1;
  }
}

module.exports = { validateReport, assertNoExceptions, runAudit, parseArgs };
