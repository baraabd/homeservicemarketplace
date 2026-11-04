'use strict';

// K01 — executable environment inventory.
//
// scripts/ci/environment-inventory.json names every CI job, the real services
// and containers it starts, the test gates it enables, its owner, where it runs,
// and whether it is a required final-SHA check. This checker extracts the same
// facts from .github/workflows/*.yml and from the test sources and fails on any
// drift, so a new job, service, gate or unlisted required check cannot appear
// silently. It also proves that each required check runs on every pull request
// to develop (no path filter) and so cannot strand a PR as "expected".
//
// Usage:
//   node scripts/ci/environment-inventory.cjs           # verify; exit 1 on drift
//   node scripts/ci/environment-inventory.cjs --emit    # print extracted facts

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');
const INVENTORY = path.join(__dirname, 'environment-inventory.json');
const GATE_SOURCES = ['apps/api/test', 'apps/api/src', 'apps/web/e2e', 'apps/web/src'];
const GATE_PATTERN = /process\.env\.(RUN_[A-Z0-9_]+)\b/g;
const CONTAINER_IMAGE = /\b((?:[a-z0-9.-]+\/)?[a-z0-9._-]+\/[a-z0-9._-]+:[A-Za-z0-9._-]+)\b/g;

const indentOf = (line) => line.length - line.trimStart().length;
const meaningful = (line) => line.trim() !== '' && !line.trimStart().startsWith('#');

/** Return the indented block under the first `key:` line at the given indent. */
function blockUnder(lines, key, indent) {
  const start = lines.findIndex(
    (line) => indentOf(line) === indent && line.trim().replace(/\s+#.*$/, '') === `${key}:`,
  );
  if (start < 0) return [];
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (meaningful(line) && indentOf(line) <= indent) break;
    block.push(line);
  }
  return block;
}

/** Child keys of a block at exactly `indent`, in order. */
function childKeys(block, indent) {
  return block
    .filter((line) => meaningful(line) && indentOf(line) === indent)
    .map((line) => line.trim().match(/^([A-Za-z0-9_-]+):/)?.[1])
    .filter(Boolean);
}

function triggersOf(lines) {
  const onLine = lines.findIndex((line) => /^(on|"on"|'on'):/.test(line));
  if (onLine < 0) return {};
  const inline = lines[onLine].replace(/^[^:]+:/, '').trim();
  if (inline) return { [inline.replace(/[[\]'"]/g, '')]: { filtered: false } };
  const block = [];
  for (const line of lines.slice(onLine + 1)) {
    if (meaningful(line) && indentOf(line) === 0) break;
    block.push(line);
  }
  const result = {};
  for (const event of childKeys(block, 2)) {
    const body = blockUnder(block, event, 2);
    const keys = childKeys(body, 4);
    const branchesLine = body.find((line) => /^\s{4}branches:/.test(line));
    const inlineBranches = branchesLine?.match(/\[(.*)\]/)?.[1];
    const branches = inlineBranches
      ? inlineBranches.split(',').map((b) => b.trim().replace(/['"]/g, ''))
      : blockUnder(body, 'branches', 4)
          .map((line) => line.trim().match(/^-\s*['"]?([^'"]+)['"]?$/)?.[1])
          .filter(Boolean);
    result[event] = {
      branches,
      filtered: keys.some((key) => ['paths', 'paths-ignore', 'branches-ignore'].includes(key)),
    };
  }
  return result;
}

function gatesSetIn(text) {
  const gates = new Set();
  for (const match of text.matchAll(/\b(RUN_[A-Z0-9_]+)\s*[:=]\s*['"]?(1|true)\b/g)) {
    gates.add(match[1]);
  }
  return gates;
}

function extractWorkflow(file) {
  const text = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
  const lines = text.split(/\r?\n/);
  const jobsBlock = blockUnder(lines, 'jobs', 0);
  const workflowEnv = blockUnder(lines, 'env', 0).join('\n');
  const jobs = {};
  for (const id of childKeys(jobsBlock, 2)) {
    const body = blockUnder(jobsBlock, id, 2);
    const bodyText = body.join('\n');
    const services = blockUnder(body, 'services', 4)
      .map((line) => line.match(/^\s+image:\s*['"]?([^'"\s]+)/)?.[1])
      .filter(Boolean);
    const containers = new Set();
    const composeFiles = new Set();
    body.forEach((line, index) => {
      if (/docker run\b/.test(line)) {
        // An image may follow on continuation lines; read until the command ends.
        let command = line;
        for (let i = index; body[i]?.trimEnd().endsWith('\\'); i += 1) command += body[i + 1];
        for (const match of command.matchAll(CONTAINER_IMAGE)) containers.add(match[1]);
      }
      for (const match of line.matchAll(/docker compose[^\n]*?-f\s+(\S+)/g)) {
        composeFiles.add(match[1]);
      }
    });
    const runsOnLine = body.find((line) => /^\s{4}runs-on:/.test(line));
    const uses = body.find((line) => /^\s{4}uses:/.test(line));
    jobs[id] = {
      location: runsOnLine
        ? runsOnLine.replace(/^\s*runs-on:\s*/, '').trim()
        : uses
          ? `reusable:${uses.replace(/^\s*uses:\s*/, '').trim()}`
          : 'unknown',
      services: [...new Set(services)].sort(),
      containers: [...containers].sort(),
      composeFiles: [...composeFiles].sort(),
      gates: [...new Set([...gatesSetIn(bodyText), ...gatesSetIn(workflowEnv)])].sort(),
    };
  }
  return { triggers: triggersOf(lines), jobs };
}

function extractAll() {
  const workflows = {};
  for (const file of fs
    .readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()) {
    workflows[file] = extractWorkflow(file);
  }
  return workflows;
}

function gatesUsedByTests() {
  const used = new Map();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(c|m)?[jt]sx?$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const match of text.matchAll(GATE_PATTERN)) {
          if (!used.has(match[1])) used.set(match[1], new Set());
          used.get(match[1]).add(path.relative(ROOT, full).split(path.sep).join('/'));
        }
      }
    }
  };
  for (const source of GATE_SOURCES) walk(path.join(ROOT, source));
  return used;
}

const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Return a list of human-readable drift findings; empty means the inventory is exact. */
function verify(inventory, extracted = extractAll(), testGates = gatesUsedByTests()) {
  const problems = [];
  const listed = inventory.workflows ?? {};
  for (const file of Object.keys(extracted)) {
    if (!listed[file]) problems.push(`${file}: workflow is not in the inventory`);
  }
  for (const file of Object.keys(listed)) {
    if (!extracted[file]) problems.push(`${file}: inventory names a workflow that does not exist`);
  }
  for (const [file, actual] of Object.entries(extracted)) {
    const entry = listed[file];
    if (!entry) continue;
    for (const id of Object.keys(actual.jobs)) {
      const job = entry.jobs?.[id];
      const where = `${file}#${id}`;
      if (!job) {
        problems.push(`${where}: job is not in the inventory`);
        continue;
      }
      for (const field of ['services', 'containers', 'composeFiles', 'gates']) {
        if (!same(job[field] ?? [], actual.jobs[id][field])) {
          problems.push(
            `${where}: ${field} drifted (inventory ${JSON.stringify(job[field] ?? [])}, workflow ${JSON.stringify(actual.jobs[id][field])})`,
          );
        }
      }
      if (job.location !== actual.jobs[id].location) {
        problems.push(
          `${where}: location drifted (${job.location} vs ${actual.jobs[id].location})`,
        );
      }
      if (typeof job.owner !== 'string' || job.owner.trim() === '') {
        problems.push(`${where}: owner is required`);
      }
      if (typeof job.requiredOnFinalSha !== 'boolean') {
        problems.push(`${where}: requiredOnFinalSha must be true or false`);
      }
      if (job.requiredOnFinalSha) {
        const pr = actual.triggers.pull_request;
        const push = actual.triggers.push;
        if (!pr || pr.filtered || !(pr.branches.length === 0 || pr.branches.includes('develop'))) {
          problems.push(
            `${where}: a required check must run on every pull request to develop (no path filter)`,
          );
        }
        if (!push || push.filtered || !push.branches.includes('develop')) {
          problems.push(`${where}: a required check must also run on pushes to develop`);
        }
        if (!job.checkName) problems.push(`${where}: required job needs its exact checkName`);
      }
    }
    for (const id of Object.keys(entry.jobs ?? {})) {
      if (!actual.jobs[id])
        problems.push(`${file}#${id}: inventory names a job that does not exist`);
    }
  }
  const gates = inventory.gates ?? {};
  for (const [gate, files] of testGates) {
    const entry = gates[gate];
    if (!entry) {
      problems.push(`${gate}: used by ${[...files][0]} but not in the inventory`);
      continue;
    }
    const setBy = (entry.setBy ?? []).filter((ref) => {
      const [file, id] = ref.split('#');
      return extracted[file]?.jobs[id]?.gates.includes(gate);
    });
    if (setBy.length === 0 && !entry.excludedReason) {
      problems.push(`${gate}: no listed CI job enables it and no exclusion reason is recorded`);
    }
    if (!entry.owner) problems.push(`${gate}: owner is required`);
  }
  for (const gate of Object.keys(gates)) {
    if (!testGates.has(gate)) problems.push(`${gate}: inventory lists a gate no test reads`);
  }
  return problems;
}

/** The exact required status-check names, for branch protection. */
function requiredChecks(inventory) {
  return Object.values(inventory.workflows)
    .flatMap((workflow) => Object.values(workflow.jobs))
    .filter((job) => job.requiredOnFinalSha)
    .flatMap((job) => [].concat(job.checkName))
    .sort();
}

if (require.main === module) {
  if (process.argv.includes('--emit')) {
    console.log(JSON.stringify(extractAll(), null, 2));
  } else if (process.argv.includes('--required-checks')) {
    console.log(JSON.stringify(requiredChecks(JSON.parse(fs.readFileSync(INVENTORY, 'utf8')))));
  } else {
    const problems = verify(JSON.parse(fs.readFileSync(INVENTORY, 'utf8')));
    if (problems.length > 0) {
      console.error(`Environment inventory drift (${problems.length}):`);
      for (const problem of problems) console.error(` - ${problem}`);
      process.exitCode = 1;
    } else {
      console.log('Environment inventory matches every workflow job, service and test gate.');
    }
  }
}

module.exports = { extractAll, extractWorkflow, gatesUsedByTests, verify, requiredChecks };
