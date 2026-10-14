'use strict';
// R22 — operator CLI for replaying dead-lettered outbox events.
// Runbook: infra/production/workers/OUTBOX_PLAYBOOKS.md ("Dead letters").
//
// Thin wrapper over the COMPILED OutboxReplayService, so the CLI and any
// future admin endpoint share one implementation of authorization, scope,
// rate limits and audit. The CLI adds a two-step confirmation on top:
//
//   1. dry-run (the default) prints what would be replayed;
//   2. --execute requires --confirm-count equal to that dry-run's count, and
//      re-checks it immediately before executing. A scope that grew between
//      the two steps aborts instead of replaying more than was reviewed.
//
// Reads DATABASE_URL from the environment and never prints it, the payloads
// or the error text beyond the service's one-line summary.
//
// Exit codes: 0 done, 2 refused (authorization, scope, rate limit, audit
// unavailable, confirmation mismatch), 64 usage error, 1 unexpected failure.

const path = require('node:path');
const { createRequire } = require('node:module');

const USAGE = `usage: outbox-replay.cjs --operator <userId> --reason "<ticket and why>"
         (--event-id <id> [--event-id <id> ...] | --event-type <type> | --aggregate-type <type> [--aggregate-id <id>])
         [--limit <1..50>] [--request-id <ref>]
         [--execute --confirm-count <n>]
         [--api-dist <path to the built apps/api/dist>]`;

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { eventIds: [], limit: 10, execute: false };
  const takes = new Set([
    '--operator',
    '--reason',
    '--event-id',
    '--event-type',
    '--aggregate-type',
    '--aggregate-id',
    '--limit',
    '--request-id',
    '--confirm-count',
    '--api-dist',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--execute') {
      out.execute = true;
      continue;
    }
    if (flag === '--help' || flag === '-h') throw new UsageError(USAGE);
    if (!takes.has(flag)) throw new UsageError(`unknown argument ${flag}\n${USAGE}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--'))
      throw new UsageError(`${flag} needs a value`);
    switch (flag) {
      case '--operator':
        out.operator = value;
        break;
      case '--reason':
        out.reason = value;
        break;
      case '--event-id':
        out.eventIds.push(value);
        break;
      case '--event-type':
        out.eventType = value;
        break;
      case '--aggregate-type':
        out.aggregateType = value;
        break;
      case '--aggregate-id':
        out.aggregateId = value;
        break;
      case '--limit':
        out.limit = Number(value);
        break;
      case '--request-id':
        out.requestId = value;
        break;
      case '--confirm-count':
        out.confirmCount = Number(value);
        break;
      case '--api-dist':
        out.apiDist = value;
        break;
    }
  }
  if (!out.operator) throw new UsageError(`--operator is required\n${USAGE}`);
  if (!out.reason) throw new UsageError(`--reason is required\n${USAGE}`);
  if (out.execute && !Number.isInteger(out.confirmCount)) {
    throw new UsageError('--execute requires --confirm-count <n> from a prior dry-run');
  }
  if (!out.execute && out.confirmCount !== undefined) {
    throw new UsageError('--confirm-count is only meaningful with --execute');
  }
  return out;
}

function toRequest(args, dryRun) {
  const scope = {};
  if (args.eventIds.length > 0) scope.eventIds = args.eventIds;
  if (args.eventType) scope.eventType = args.eventType;
  if (args.aggregateType) scope.aggregateType = args.aggregateType;
  if (args.aggregateId) scope.aggregateId = args.aggregateId;
  return {
    operatorUserId: args.operator,
    reason: args.reason,
    scope,
    limit: args.limit,
    dryRun,
    requestId: args.requestId ?? `cli-${new Date().toISOString()}`,
  };
}

/** Resolve the built API: explicit flag, then the repository layout, then the
 *  container layout (/app/dist next to /app/deploy). */
function resolveApiDist(explicit) {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [path.resolve(__dirname, '../../../apps/api/dist'), path.resolve(process.cwd(), 'dist')];
  for (const dir of candidates) {
    try {
      require.resolve(path.join(dir, 'infrastructure/outbox/outbox-replay.service.js'));
      return dir;
    } catch {
      // try the next layout
    }
  }
  throw new UsageError(`built API not found (tried ${candidates.join(', ')}); pass --api-dist`);
}

function summarize(result) {
  return {
    dryRun: result.dryRun,
    matched: result.candidates.length,
    replayed: result.replayedIds.length,
    auditEventId: result.auditEventId,
    candidates: result.candidates.map((c) => ({
      id: c.id,
      eventType: c.eventType,
      aggregateType: c.aggregateType,
      aggregateId: c.aggregateId,
      attempts: c.attempts,
      deadSince: c.deadSince instanceof Date ? c.deadSince.toISOString() : c.deadSince,
      lastErrorSummary: c.lastErrorSummary,
    })),
  };
}

async function run(argv, deps = {}) {
  const args = parseArgs(argv);
  const service =
    deps.service ??
    (() => {
      if (!process.env.DATABASE_URL) throw new UsageError('DATABASE_URL must be set');
      const dist = resolveApiDist(args.apiDist);
      const { OutboxReplayService } = require(
        path.join(dist, 'infrastructure/outbox/outbox-replay.service.js'),
      );
      const { prisma } = createRequire(path.join(dist, 'main.js'))(
        '@homeservicemarketplace/database',
      );
      deps.disconnect = () => prisma.$disconnect();
      return new OutboxReplayService({ client: prisma });
    })();

  const preview = await service.replay(toRequest(args, true));
  if (!args.execute) return { exitCode: 0, output: summarize(preview) };

  if (preview.candidates.length !== args.confirmCount) {
    return {
      exitCode: 2,
      output: {
        refused: 'confirmation-mismatch',
        detail: `scope now matches ${preview.candidates.length} event(s), confirmed ${args.confirmCount}`,
      },
    };
  }
  const result = await service.replay(toRequest(args, false));
  return { exitCode: 0, output: summarize(result) };
}

async function main() {
  let deps = {};
  let code;
  try {
    const { exitCode, output } = await run(process.argv.slice(2), deps);
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    code = exitCode;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(err.message + '\n');
      code = 64;
    } else if (err && err.name === 'OutboxReplayRefusedError') {
      process.stdout.write(JSON.stringify({ refused: err.code, detail: err.message }) + '\n');
      code = 2;
    } else {
      // Message only: a driver error can embed a connection string.
      process.stderr.write(`outbox-replay failed: ${err && err.name ? err.name : 'Error'}\n`);
      code = 1;
    }
  } finally {
    if (deps.disconnect) await deps.disconnect().catch(() => undefined);
  }
  process.exitCode = code;
}

if (require.main === module) void main();

module.exports = { parseArgs, toRequest, run, UsageError };
