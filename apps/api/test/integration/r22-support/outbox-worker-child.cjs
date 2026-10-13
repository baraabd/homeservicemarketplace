// R22 — one REAL outbox worker process for r22-outbox-process.integration.spec.ts.
//
// Runs the COMPILED worker (apps/api/dist), not ts-jest output, so the process
// suite exercises what the image ships. Only the narrow configuration below is
// read; no application secret is needed or inherited.
//
// stdout is a line protocol, one JSON object per line:
//   {"t":"ready","worker":"<lease id>"}
//   {"t":"handling","id":"<event id>"}      handler entered (tx open)
//   {"t":"stopped","released":true}         graceful shutdown finished
//
// Shutdown: IPC message "shutdown" (portable; Windows cannot deliver SIGTERM
// to a Node child) or SIGTERM/SIGINT (Linux CI). Both run onModuleDestroy.

const path = require('node:path');

const dist = path.resolve(__dirname, '../../../dist/infrastructure/outbox');
const { OutboxWorker } = require(path.join(dist, 'outbox.worker.js'));
const { OutboxRepository } = require(path.join(dist, 'outbox.repository.js'));
const { prisma } = require('@homeservicemarketplace/database');

const env = process.env;
const num = (key, fallback) => (env[key] ? Number(env[key]) : fallback);

const settings = {
  OUTBOX_WORKER_ENABLED: true,
  OUTBOX_BATCH_SIZE: num('R22_BATCH_SIZE', 10),
  OUTBOX_POLL_INTERVAL_MS: num('R22_POLL_MS', 100),
  OUTBOX_CLAIM_TIMEOUT_MS: num('R22_CLAIM_TIMEOUT_MS', 3_000),
  OUTBOX_RETRY_BASE_MS: 100,
  OUTBOX_RETRY_CAP_MS: 1_000,
  OUTBOX_SHUTDOWN_GRACE_MS: num('R22_SHUTDOWN_GRACE_MS', 10_000),
};
const config = { get: (k) => settings[k] };

const noop = { inc() {}, set() {}, reset() {} };
const metrics = {
  outboxEventsProcessedTotal: noop,
  outboxEventDurationSeconds: { startTimer: () => () => undefined },
  outboxQueueDepth: noop,
  outboxOldestPendingAgeSeconds: noop,
  outboxClaimedTotal: noop,
  outboxReclaimedTotal: noop,
};

const say = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const sleepMs = num('R22_HANDLER_SLEEP_MS', 0);

// Same effect contract as r22-support/outbox-harness.ts: one Notification row
// per committed delivery, tagged with the event id.
const handler = {
  name: 'r22.process.effect',
  eventTypes: ['r22.process'],
  async handle(event, tx) {
    say({ t: 'handling', id: event.id });
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
    await tx.notification.create({
      data: {
        userId: event.payload.userId,
        type: 'SYSTEM',
        title: 'R22 effect',
        body: 'r22.process.effect',
        metadata: { r22EventId: event.id, worker: env.R22_WORKER_LABEL || 'child' },
      },
    });
  },
};

const repo = new OutboxRepository({ client: prisma });
const worker = new OutboxWorker(repo, { client: prisma }, config, metrics, [handler]);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await worker.onModuleDestroy();
  say({ t: 'stopped', released: true });
  await prisma.$disconnect();
  process.exit(0);
}
process.on('message', (m) => m === 'shutdown' && void stop());
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

worker.onModuleInit();
say({ t: 'ready', worker: worker.id });
// The worker's timers are unref'd; keep the process alive until told to stop.
setInterval(() => undefined, 60_000);
