import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { startApi, stopApi } from './lib/api-process.mjs';
import { apiEnv, LANE } from './lib/lane-env.mjs';
import { REPO_ROOT } from './lib/provenance.mjs';

// Only the disposable GitHub VM fixture may start this browser stack.
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('R27 real browser fixture requires a disposable GitHub-hosted runner');
}
const mode = process.env.R27_BROWSER_MODE;
if (!['development', 'production'].includes(mode))
  throw new Error('explicit browser mode required');
const api = await startApi();
const webRoot = resolve(REPO_ROOT, 'apps/web');
const require = createRequire(resolve(webRoot, 'package.json'));
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const child = spawn(
  process.execPath,
  [
    vite,
    ...(mode === 'production' ? ['preview'] : []),
    '--host',
    '127.0.0.1',
    '--port',
    String(LANE.webPorts[0]),
    '--strictPort',
    '--config',
    'vite.config.ts',
  ],
  {
    cwd: webRoot,
    env: { ...apiEnv(), VITE_API_URL: LANE.api },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  await stopApi(api);
  process.exitCode = code;
}
process.once('SIGTERM', () => void stop(0));
process.once('SIGINT', () => void stop(0));
child.once('error', () => void stop(1));
child.once('exit', (code) => void stop(code ?? 1));
await once(child, 'spawn');
