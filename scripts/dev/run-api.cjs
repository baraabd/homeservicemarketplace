'use strict';

// Starts the API dev server (Nest watch mode) and reports two separate
// milestones instead of one ambiguous "started":
//
//   LISTENING  something accepts TCP connections on the API port
//   READY      GET /health/ready answered 200 with ready=true
//
// Neither is printed before it is true. Nest runs as a child process without
// a shell (paths with spaces are passed as single arguments), Ctrl+C is
// forwarded to it, and this process exits with the child's status. It never
// signals any process it did not start.
//
// It does not build dependencies or check the workspace; start-api.ps1 (or
// the package's predev hooks) does that first and stops on the first failure.

const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { apiPort } = require('./preflight.cjs');

const ROOT = path.resolve(__dirname, '../..');
const API_DIR = path.join(ROOT, 'apps/api');
const POLL_MS = 1_000;
const READY_DEADLINE_MS = Number(process.env.HSM_READY_DEADLINE_MS ?? 180_000);

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1_000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function readiness(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/health/ready', timeout: 5_000 },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          if (body.length < 4_096) body += chunk;
        });
        response.on('end', () => {
          let ready = false;
          let dependencies = [];
          try {
            const parsed = JSON.parse(body);
            ready = parsed.ready === true;
            dependencies = Array.isArray(parsed.dependencies) ? parsed.dependencies : [];
          } catch {
            // Not the API's readiness payload.
          }
          resolve({ status: response.statusCode, ready, dependencies });
        });
      },
    );
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve({ status: null, ready: false, dependencies: [] }));
  });
}

async function watchMilestones(port, child, log) {
  const started = Date.now();
  let listening = false;
  let lastState = '';
  while (child.exitCode === null && child.signalCode === null) {
    if (!listening && (await canConnect(port))) {
      listening = true;
      log(`MILESTONE listening: a server accepts connections on port ${port}. Not yet readiness.`);
    }
    if (listening) {
      const state = await readiness(port);
      if (state.status === 200 && state.ready) {
        const deps = state.dependencies.map((d) => `${d.name} ${d.status}`).join(', ');
        log(
          `MILESTONE ready: GET /health/ready 200 (${deps}). Browser journeys are not verified by this.`,
        );
        return;
      }
      const summary = state.status === null ? 'no response' : `status ${state.status}`;
      if (summary !== lastState) {
        log(`Waiting for /health/ready (${summary})...`);
        lastState = summary;
      }
    }
    if (Date.now() - started > READY_DEADLINE_MS) {
      log(
        `NOT READY: no successful /health/ready within ${Math.round(READY_DEADLINE_MS / 1000)}s. ` +
          'The watcher keeps running; read its output above (compile errors, database or Redis unavailable).',
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function main({ log = console.log } = {}) {
  const port = await apiPort(ROOT);
  let nest;
  try {
    nest = require.resolve('@nestjs/cli/bin/nest.js', { paths: [API_DIR] });
  } catch {
    console.error(
      'FAIL The Nest CLI is not installed for apps/api. Run pnpm install --frozen-lockfile.',
    );
    process.exitCode = 1;
    return;
  }
  const child = spawn(
    process.execPath,
    [nest, 'start', '--watch', '--config', 'nest-cli.dev.json', '--path', 'tsconfig.dev.json'],
    { cwd: API_DIR, stdio: 'inherit', shell: false },
  );
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (child.exitCode === null) child.kill(signal);
    });
  }
  const exited = new Promise((resolve) => {
    child.once('error', () => resolve({ code: 1 }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  watchMilestones(port, child, log).catch(() => {});
  const { code, signal } = await exited;
  if (signal) log(`The API watcher stopped (${signal}).`);
  process.exitCode = Number.isInteger(code) ? code : 1;
}

module.exports = { canConnect, readiness, watchMilestones };

if (require.main === module) {
  main().catch((error) => {
    const safe = /^(API |An API )/u.test(error.message);
    console.error(`FAIL ${safe ? error.message : 'The API dev server could not be started.'}`);
    process.exitCode = 1;
  });
}
