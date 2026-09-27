'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const NODE_VERSION = '24.21.0';
const PNPM_VERSION = '10.32.1';
const ROOT = path.resolve(__dirname, '../..');
const DECLARATIONS = {
  '.nvmrc': /^24\.21\.0\s*$/u,
  'apps/api/Dockerfile': /^ARG NODE_VERSION=24\.21\.0-alpine$/mu,
  'apps/web/Dockerfile': /^FROM node:24\.21\.0-alpine AS builder$/mu,
  '.devcontainer/Dockerfile': /^FROM node:24\.21\.0-bookworm$/mu,
  '.github/workflows/ci.yml': /^  NODE_VERSION: '24\.21\.0'$/mu,
  '.github/workflows/reusable-verify.yml': /^        default: '24\.21\.0'$/mu,
  '.github/workflows/web-startup.yml': /^          node-version: '24\.21\.0'$/mu,
  '.github/workflows/staging-boundary.yml': /^          node-version: '24\.21\.0'$/mu,
  '.github/workflows/production-governance.yml': /^          node-version: '24\.21\.0'$/mu,
};

async function toolchainProblems(root = ROOT, runtime = process.versions.node) {
  const problems = [];
  if (runtime !== null && runtime !== NODE_VERSION) {
    problems.push(`Node ${NODE_VERSION} is required; select the .nvmrc or Volta pin before installing or starting.`);
  }
  let pkg;
  try { pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); }
  catch { return [...problems, 'Root package.json is missing or invalid']; }
  if (pkg.engines?.node !== NODE_VERSION || pkg.volta?.node !== NODE_VERSION) problems.push('Node engines/Volta pin drift');
  if (pkg.volta?.pnpm !== PNPM_VERSION || !pkg.packageManager?.startsWith(`pnpm@${PNPM_VERSION}+sha512.`)) problems.push('pnpm exact version/integrity pin drift');
  for (const [file, pattern] of Object.entries(DECLARATIONS)) {
    try {
      const text = await fs.readFile(path.join(root, file), 'utf8');
      if (!pattern.test(text)) problems.push(`Runtime declaration drift: ${file}`);
      if (file.endsWith('.yml')) {
        for (const match of text.matchAll(/^\s*node-version:\s*['"]?([^'"\r\n]+)['"]?\s*$/gmu)) {
          const value = match[1].trim();
          if (![NODE_VERSION, '${{ env.NODE_VERSION }}'].includes(value)) problems.push(`Unexpected workflow runtime: ${file}`);
        }
      }
    } catch { problems.push(`Missing runtime declaration: ${file}`); }
  }
  try {
    const dev = JSON.parse(await fs.readFile(path.join(root, '.devcontainer/devcontainer.json'), 'utf8'));
    if (dev.image || dev.build?.dockerfile !== 'Dockerfile' || dev.build?.context !== '..') problems.push('Devcontainer must build its pinned Dockerfile');
  } catch { problems.push('Devcontainer configuration is missing or invalid'); }
  return problems;
}
module.exports = { NODE_VERSION, PNPM_VERSION, ROOT, DECLARATIONS, toolchainProblems };
if (require.main === module) {
  const args = process.argv.slice(2);
  const declarationOnly = args.length === 1 && args[0] === '--declarations';
  if (args.length && !declarationOnly) {
    console.error('Usage: node scripts/runtime/toolchain.cjs [--declarations]');
    process.exitCode = 1;
  } else {
    toolchainProblems(ROOT, declarationOnly ? null : process.versions.node).then((problems) => {
      for (const problem of problems) console.error(`FAIL ${problem}`);
      if (problems.length) process.exitCode = 1;
      else console.log(declarationOnly ? 'PASS runtime declarations only; the executing Node was not certified' : `PASS exact Node ${NODE_VERSION} and runtime declarations`);
    }).catch(() => { console.error('FAIL runtime declarations could not be checked'); process.exitCode = 1; });
  }
}
