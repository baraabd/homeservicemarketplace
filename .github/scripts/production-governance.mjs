import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_CHECKS = [
  'CI gate',
  'Analyze JavaScript/TypeScript',
  'Production governance',
];

export const PR_FIELDS = [
  'Sprint',
  'Base SHA',
  'Final SHA',
  'Owned paths',
  'Shared files modified',
  'Schema change',
  'Migration',
  'Contract change',
  'Feature flag',
  'Security impact',
  'Tests',
  'Browser evidence',
  'Known limitations',
  'Rollback',
];

/** Validate captured GitHub branch-protection evidence; never mutate GitHub. */
export function protectionProblems(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['Missing branch-protection object'];
  }
  if (evidence.message || evidence.status) {
    return ['Protection was not readable; access errors are not protection evidence'];
  }
  const errors = [];
  const checks = evidence.required_status_checks;
  const contexts = new Set([
    ...(Array.isArray(checks?.contexts) ? checks.contexts : []),
    ...(Array.isArray(checks?.checks) ? checks.checks.map((check) => check?.context) : []),
  ]);
  for (const name of REQUIRED_CHECKS) {
    if (!contexts.has(name)) errors.push(`Required check missing: ${name}`);
  }
  if (checks?.strict !== true) errors.push('Require an up-to-date branch');
  if (evidence.enforce_admins?.enabled !== true) errors.push('Enforce rules for administrators');
  const reviews = evidence.required_pull_request_reviews;
  if (!reviews || typeof reviews !== 'object') errors.push('Require a pull request');
  if (reviews?.dismiss_stale_reviews !== true) errors.push('Dismiss stale approvals');
  const bypass = reviews?.bypass_pull_request_allowances;
  if (bypass && ['users', 'teams', 'apps'].some((key) => bypass[key]?.length > 0)) {
    errors.push('Remove pull-request bypass allowances');
  }
  if (evidence.required_conversation_resolution?.enabled !== true) {
    errors.push('Require conversation resolution');
  }
  // Missing booleans are unknown, not a safe default.
  if (evidence.allow_force_pushes?.enabled !== false) errors.push('Explicitly block force pushes');
  if (evidence.allow_deletions?.enabled !== false) errors.push('Explicitly block branch deletion');
  return errors;
}

export function templateProblems(template) {
  return PR_FIELDS.filter((field) => !template.includes(`- ${field}:`)).map(
    (field) => `Missing PR field: ${field}`,
  );
}

export function ownershipProblems(codeowners) {
  const rules = codeowners
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const required = [
    '*',
    '/packages/database/',
    '/packages/contracts/',
    '/apps/api/src/app.module.ts',
    '/apps/api/src/config/env.schema.ts',
    '/apps/web/src/app/routes.ts',
    '/.github/workflows/',
    '/pnpm-lock.yaml',
  ];
  return required
    .filter((entry) => !rules.some((line) => line.split(/\s+/u)[0] === entry && / @baraabd$/u.test(line)))
    .map((entry) => `Missing accountable owner for ${entry}`);
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const [command, evidencePath] = process.argv.slice(2);
  let errors;
  if (command === 'protection' && evidencePath) {
    errors = protectionProblems(JSON.parse(await readFile(evidencePath, 'utf8')));
  } else if (command) {
    throw new Error('Usage: node .github/scripts/production-governance.mjs [protection <json-file>]');
  } else {
    errors = [
      ...templateProblems(await readFile(path.join(root, 'pull_request_template.md'), 'utf8')),
      ...ownershipProblems(await readFile(path.join(root, 'CODEOWNERS'), 'utf8')),
    ];
  }
  if (errors.length) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
  } else {
    console.log(command ? 'PASS captured branch-protection evidence' : 'PASS repository governance files');
    if (!command) console.log('GitHub protection is NOT verified by this local check.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(() => {
    console.error('FAIL governance input could not be read or parsed');
    process.exitCode = 1;
  });
}
