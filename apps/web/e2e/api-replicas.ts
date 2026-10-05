import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// R17 — two real API processes for cross-instance acceptance.
//
// Each replica is the built API (`apps/api/dist/main.js`) started as its own
// operating-system process on its own port. Both share the same PostgreSQL and
// Redis from the environment the test runner was given, exactly as two
// deployed instances behind a load balancer would. A replica's identity is its
// port: the test proves which one a browser reached from the URLs of the
// requests that browser made. No diagnostic endpoint is added for it.
//
// Output is kept in memory and only its tail is surfaced when a replica fails
// to start: it is not attached to the report, because API logs can name
// synthetic accounts.
// ─────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = resolve(HERE, '../../api/dist/main.js');

export interface Replica {
  readonly name: string;
  readonly port: number;
  readonly url: string;
  /** Operating-system process id of the running replica. */
  pid(): number | undefined;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

export function replica(
  name: string,
  port: number,
  extraEnv: Record<string, string> = {},
): Replica {
  const url = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let output = '';

  async function healthy(deadline: number): Promise<void> {
    while (Date.now() < deadline) {
      if (child?.exitCode !== null && child?.exitCode !== undefined) break;
      try {
        if ((await fetch(`${url}/health/live`)).ok) return;
      } catch {
        /* not listening yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`replica ${name} on ${port} did not become healthy:\n${output.slice(-4000)}`);
  }

  const self: Replica = {
    name,
    port,
    url,
    pid: () => child?.pid,
    async start() {
      if (!existsSync(MAIN)) throw new Error(`build the API first: ${MAIN} is missing`);
      output = '';
      child = spawn(process.execPath, [MAIN], {
        env: { ...process.env, NODE_ENV: 'development', ...extraEnv, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const keep = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-20_000);
      };
      child.stdout?.on('data', keep);
      child.stderr?.on('data', keep);
      await healthy(Date.now() + 90_000);
    },
    async stop() {
      const running = child;
      child = null;
      if (!running || running.exitCode !== null) return;
      const exited = new Promise<void>((r) => running.once('exit', () => r()));
      running.kill('SIGTERM');
      const timer = setTimeout(() => running.kill('SIGKILL'), 15_000);
      await exited;
      clearTimeout(timer);
      // The port must be free again before anything claims the replica is down.
      for (let i = 0; i < 40; i += 1) {
        try {
          await fetch(`${url}/health/live`);
        } catch {
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`replica ${name} still answers on ${port} after stopping`);
    },
    async restart() {
      await self.stop();
      await self.start();
    },
  };
  return self;
}
