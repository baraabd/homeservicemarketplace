'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Ubuntu lists kernel.org as an archive mirror; this is that service's HTTPS
// edge endpoint. Apt still authenticates InRelease with the runner's existing
// Ubuntu keyring and checks package hashes and repository expiry.
// https://packages.ubuntu.com/jammy-updates/amd64/linux-image-5.15.0-173-generic/download
// https://mirrors.edge.kernel.org/
// Incident: https://github.com/actions/runner-images/issues/15296
const MIRROR = 'https://mirrors.edge.kernel.org/ubuntu';
const INSTALL_ARGS = [
  '--filter',
  '@homeservicemarketplace/web',
  'exec',
  'playwright',
  'install',
  '--with-deps',
  'chromium',
];
const UBUNTU_URL =
  /https?:\/\/(?:azure\.archive\.ubuntu\.com|archive\.ubuntu\.com|security\.ubuntu\.com)\/ubuntu\/?(?=\s|$)/gu;
const RUNNER_MIRROR_URI = /mirror\+file:\/etc\/apt\/apt-mirrors\.txt(?=\s|$)/gu;

function validateRunnerMirrorList(text) {
  const entries = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (
    !entries.length ||
    entries.some(
      (line) =>
        !/^https?:\/\/(?:azure\.archive\.ubuntu\.com|archive\.ubuntu\.com|security\.ubuntu\.com)\/ubuntu\/?$/u.test(
          line.split(/\s+/u)[0],
        ),
    )
  ) {
    throw new Error('Runner mirror list does not contain only the known Ubuntu archives');
  }
}

function hasUbuntuDnsFailure(text) {
  return /(?:Temporary failure resolving|Could not resolve) ['"](?:azure\.archive\.ubuntu\.com|archive\.ubuntu\.com|security\.ubuntu\.com)['"]/u.test(
    text,
  );
}

function rejectUnsafeSource(source) {
  if (
    /(?:trusted|allow-insecure|allow-weak|allow-downgrade-to-insecure)\s*(?:=|:)\s*(?:yes|true|1)\b/iu.test(
      source,
    ) ||
    /(?:check-valid-until|check-date)\s*(?:=|:)\s*(?:no|false|0)\b/iu.test(source)
  ) {
    throw new Error('Refusing a source with disabled archive authentication or expiry checks');
  }
}

function rewriteSources(text, filename, runnerMirrorListVerified = false) {
  const rewriteUris = (value) =>
    value.replace(UBUNTU_URL, MIRROR).replace(RUNNER_MIRROR_URI, () => {
      if (!runnerMirrorListVerified)
        throw new Error('Runner mirror list must be verified before changing its URI');
      return MIRROR;
    });
  if (filename.endsWith('.list')) {
    return text.replace(
      /^([ \t]*deb(?:-src)?[ \t]+(?:\[[^\]\r\n]*\][ \t]+)?)(\S+)([^\r\n]*)/gmu,
      (line, prefix, url, rest) => {
        const replacement = rewriteUris(url);
        if (replacement === url) return line;
        rejectUnsafeSource(line);
        return prefix + replacement + rest;
      },
    );
  }
  if (!filename.endsWith('.sources')) throw new Error('Unsupported apt source format');
  // Only URI fields change. Comments, suites, components, architectures,
  // Signed-By (including an inline key), and enabled/disabled state survive.
  return text
    .split(/(\r?\n[ \t]*\r?\n)/u)
    .map((stanza) => {
      if (/^Enabled:[ \t]*no[ \t]*$/imu.test(stanza)) return stanza;
      const rewritten = stanza.replace(/^(URIs:[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*)/gimu, rewriteUris);
      if (rewritten !== stanza) rejectUnsafeSource(stanza);
      return rewritten;
    })
    .join('');
}

async function readMirrorPlan(aptRoot = '/etc/apt') {
  const parts = path.join(aptRoot, 'sources.list.d');
  const names = await fs.readdir(parts).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = [
    path.join(aptRoot, 'sources.list'),
    ...names
      .filter((name) => /\.(?:list|sources)$/u.test(name))
      .sort()
      .map((name) => path.join(parts, name)),
  ];
  const plan = [];
  let runnerMirrorListVerified = false;
  for (const file of files) {
    const stat = await fs.lstat(file).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) continue;
    if (!stat.isFile() || stat.size > 128 * 1024)
      throw new Error('Refusing a non-regular or oversized apt source');
    const original = await fs.readFile(file, 'utf8');
    if (original.includes('mirror+file:/etc/apt/apt-mirrors.txt') && !runnerMirrorListVerified) {
      // GitHub's hosted Ubuntu image uses this exact local mirror list. Do not
      // follow arbitrary mirror+file paths or replace non-Ubuntu repositories.
      // https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh
      const mirrorFile = path.join(aptRoot, 'apt-mirrors.txt');
      const mirrorStat = await fs.lstat(mirrorFile);
      if (!mirrorStat.isFile() || mirrorStat.size > 128 * 1024)
        throw new Error('Refusing a non-regular or oversized runner mirror list');
      validateRunnerMirrorList(await fs.readFile(mirrorFile, 'utf8'));
      runnerMirrorListVerified = true;
    }
    const updated = rewriteSources(original, file, runnerMirrorListVerified);
    if (updated !== original) plan.push({ file, original, updated });
  }
  if (!plan.length)
    throw new Error('No supported Ubuntu archive sources found; cannot retry safely');
  return plan;
}

function runCommand(command, args, { input, quiet = false, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      // Only the fixed pnpm command needs cmd.exe for its Windows shim.
      shell: process.platform === 'win32' && command === 'pnpm',
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let dnsFailure = false;
    let tail = '';
    let timedOut = false;
    let interrupted = false;
    let killTimer;
    const stop = (signal) => {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const forward = () => {
      interrupted = true;
      stop('SIGTERM');
    };
    process.once('SIGTERM', forward);
    process.once('SIGINT', forward);
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stop('SIGTERM');
          killTimer = setTimeout(() => stop('SIGKILL'), 5000);
          killTimer.unref();
        }, timeoutMs)
      : null;
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.removeListener('SIGTERM', forward);
      process.removeListener('SIGINT', forward);
    };
    const output = (stream) => (data) => {
      if (!quiet) stream.write(data);
      tail = (tail + data.toString('utf8')).slice(-4096);
      dnsFailure ||= hasUbuntuDnsFailure(tail);
    };
    child.stdout.on('data', output(process.stdout));
    child.stderr.on('data', output(process.stderr));
    child.stdin.on('error', () => {}); // The process exit remains authoritative.
    child.stdin.end(input);
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code) => {
      cleanup();
      resolve({ status: timedOut ? 124 : (code ?? 1), dnsFailure, interrupted });
    });
  });
}

async function writeSource(file, value) {
  // No shell interpolation, new key, apt override, or package-policy change.
  const result = await runCommand('sudo', ['-n', 'tee', '--', file], {
    input: value,
    quiet: true,
    timeoutMs: 10_000,
  });
  if (result.status !== 0) throw new Error('Could not write apt source');
}

async function installBrowser({
  runInstall = (timeoutMs) => runCommand('pnpm', INSTALL_ARGS, { timeoutMs }),
  eligible = async () =>
    process.platform === 'linux' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    /^ID=["']?ubuntu["']?$/mu.test(await fs.readFile('/etc/os-release', 'utf8')),
  planSources = readMirrorPlan,
  write = writeSource,
  log = console.log,
} = {}) {
  const first = await runInstall(12 * 60_000);
  if (first.status === 0 || first.interrupted || !first.dnsFailure || !(await eligible()))
    return first.status;
  log(
    'Ubuntu archive DNS failed. Retrying the same complete browser install once with the signed kernel.org mirror.',
  );
  const plan = await planSources();
  const touched = [];
  let installStatus;
  let installError;
  try {
    for (const entry of plan) {
      // Include a partially failed write in restoration.
      touched.push(entry);
      await write(entry.file, entry.updated);
    }
    installStatus = (await runInstall(5 * 60_000)).status;
  } catch (error) {
    installError = error;
  }
  // Restore even after a partial write, install failure, timeout or exception.
  const restoration = await Promise.allSettled(
    touched.map((entry) => write(entry.file, entry.original)),
  );
  if (restoration.some((result) => result.status === 'rejected'))
    throw new Error('Apt source restoration failed');
  log('Original apt sources restored.');
  if (installError) throw installError;
  return installStatus;
}

module.exports = {
  MIRROR,
  INSTALL_ARGS,
  hasUbuntuDnsFailure,
  validateRunnerMirrorList,
  rewriteSources,
  readMirrorPlan,
  runCommand,
  installBrowser,
};
if (require.main === module) {
  if (process.argv.length !== 2) {
    console.error('Usage: node scripts/ci/install-browser.cjs');
    process.exitCode = 1;
  } else {
    installBrowser()
      .then((code) => {
        process.exitCode = code;
      })
      .catch((error) => {
        console.error(`Browser installation failed: ${error.message}`);
        process.exitCode = 1;
      });
  }
}
