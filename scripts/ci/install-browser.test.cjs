'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  MIRROR,
  INSTALL_ARGS,
  hasUbuntuDnsFailure,
  validateRunnerMirrorList,
  rewriteSources,
  readRegularSource,
  readMirrorPlan,
  runCommand,
  installBrowser,
} = require('./install-browser.cjs');

test('only the observed exact Ubuntu DNS diagnostics qualify', () => {
  for (const host of ['azure.archive.ubuntu.com', 'archive.ubuntu.com', 'security.ubuntu.com']) {
    assert.equal(hasUbuntuDnsFailure(`E: Temporary failure resolving '${host}'`), true);
    assert.equal(hasUbuntuDnsFailure(`Could not resolve "${host}"`), true);
  }
  for (const text of [
    "Temporary failure resolving 'registry.npmjs.org'",
    "Temporary failure resolving 'archive.ubuntu.com.evil.test'",
    "Temporary failure resolving 'evil.archive.ubuntu.com'",
    'NO_PUBKEY 871920D1991BC93C',
    'The repository is not signed',
    '404 Not Found',
    'Assertion failed',
    'exit code 100',
  ]) {
    assert.equal(hasUbuntuDnsFailure(text), false, text);
  }
});

test('legacy sources change only the exact active archive URL', () => {
  const source =
    '# deb http://archive.ubuntu.com/ubuntu resolute main\r\n' +
    'deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] http://azure.archive.ubuntu.com/ubuntu/ resolute main restricted universe multiverse # note\r\n' +
    'deb-src https://security.ubuntu.com/ubuntu resolute-security universe\r\n' +
    'deb https://packages.microsoft.com/ubuntu/26.04/prod resolute main\r\n' +
    'deb https://archive.ubuntu.com/ubuntu/other resolute main\r\n';
  const result = rewriteSources(source, 'sources.list');
  assert.equal(
    result,
    source
      .replace('http://azure.archive.ubuntu.com/ubuntu/', MIRROR)
      .replace('https://security.ubuntu.com/ubuntu ', `${MIRROR} `),
  );
});

test('deb822 preserves suites, components, keyring, folded fields and inactive entries', () => {
  const source =
    'Types: deb deb-src\r\nURIs: http://archive.ubuntu.com/ubuntu/\r\n https://security.ubuntu.com/ubuntu https://packages.microsoft.com/ubuntu/26.04/prod\r\nSuites: resolute resolute-updates resolute-backports resolute-security\r\nComponents: main restricted universe multiverse\r\nArchitectures: amd64\r\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\r\nCheck-Valid-Until: yes\r\n\r\nTypes: deb\r\nEnabled: no\r\nURIs: http://archive.ubuntu.com/ubuntu\r\nSuites: resolute\r\nComponents: main\r\n';
  assert.equal(
    rewriteSources(source, 'ubuntu.sources'),
    source
      .replace('http://archive.ubuntu.com/ubuntu/', MIRROR)
      .replace('https://security.ubuntu.com/ubuntu ', `${MIRROR} `),
  );
});

test('authentication and expiry bypasses are refused; unrelated sources stay unchanged', () => {
  for (const option of [
    'trusted=yes',
    'allow-insecure=true',
    'allow-weak=1',
    'allow-downgrade-to-insecure=yes',
    'check-valid-until=no',
    'check-date=false',
  ]) {
    assert.throws(
      () =>
        rewriteSources(
          `deb [${option}] http://archive.ubuntu.com/ubuntu resolute main\n`,
          'ubuntu.list',
        ),
      /disabled archive/u,
    );
  }
  for (const field of [
    'Trusted: yes',
    'Allow-Insecure: true',
    'Check-Valid-Until: no',
    'Check-Date: false',
  ]) {
    assert.throws(
      () =>
        rewriteSources(
          `Types: deb\nURIs: http://archive.ubuntu.com/ubuntu\nSuites: resolute\nComponents: main\n${field}\n`,
          'ubuntu.sources',
        ),
      /disabled archive/u,
    );
  }
  const unrelated = 'deb https://example.test/ubuntu resolute main\n';
  assert.equal(rewriteSources(unrelated, 'vendor.list'), unrelated);
  assert.throws(() => rewriteSources('', 'unknown.txt'), /Unsupported/u);
});

test('source planning reads only supported regular files and refuses symlinks', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-browser-apt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'sources.list.d'));
  const file = path.join(root, 'sources.list.d', 'ubuntu.sources');
  const source =
    'Types: deb\nURIs: http://archive.ubuntu.com/ubuntu\nSuites: resolute\nComponents: main\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
  await fs.writeFile(file, source);
  await fs.writeFile(path.join(root, 'sources.list.d', 'ignored.save'), source);
  const plan = await readMirrorPlan(root);
  assert.deepEqual(plan, [
    { file, original: source, updated: source.replace('http://archive.ubuntu.com/ubuntu', MIRROR) },
  ]);
  assert.equal(await fs.readFile(file, 'utf8'), source, 'planning must never write');
  if (process.platform !== 'win32') {
    await fs.symlink(file, path.join(root, 'sources.list.d', 'linked.sources'));
    await assert.rejects(readMirrorPlan(root), /non-regular/u);
  }
});

test('source planning rejects an empty fallback plan', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-browser-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(readMirrorPlan(root), /No supported Ubuntu/u);
});

test('regular source reads remain on the opened file when its pathname changes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-browser-descriptor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'ubuntu.sources');
  await fs.writeFile(file, 'the opened source');
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    await fs.rename(file, path.join(root, 'original.sources'));
    await fs.writeFile(file, 'a replacement pathname');
    return handle;
  });
  assert.equal(await readRegularSource(file), 'the opened source');
  assert.equal(await fs.readFile(file, 'utf8'), 'a replacement pathname');
});

test('regular source reads refuse oversized files and directories', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-browser-source-size-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'ubuntu.sources');
  await fs.writeFile(file, Buffer.alloc(128 * 1024 + 1));
  await assert.rejects(readRegularSource(file), /oversized/u);
  await assert.rejects(readRegularSource(root));
});

test('regular source reads stay bounded if the open file grows after its size check', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-browser-source-growth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'ubuntu.sources');
  await fs.writeFile(file, 'initial source');
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    const stat = handle.stat.bind(handle);
    t.mock.method(handle, 'stat', async () => {
      const initial = await stat();
      await fs.appendFile(file, Buffer.alloc(128 * 1024 + 1));
      return initial;
    });
    return handle;
  });
  await assert.rejects(readRegularSource(file), /oversized/u);
});

test('GitHub mirror list accepts only its known Ubuntu archives', () => {
  const list =
    'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
  assert.doesNotThrow(() => validateRunnerMirrorList(list));
  for (const invalid of [
    '',
    '# empty\n',
    list + 'https://example.test/ubuntu/\n',
    'https://archive.ubuntu.com.evil.test/ubuntu/\n',
    'file:/tmp/ubuntu\n',
  ]) {
    assert.throws(() => validateRunnerMirrorList(invalid), /known Ubuntu archives/u);
  }
  const source =
    'deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] mirror+file:/etc/apt/apt-mirrors.txt resolute main universe\n';
  assert.throws(() => rewriteSources(source, 'sources.list'), /must be verified/u);
  assert.equal(
    rewriteSources(source, 'sources.list', true),
    source.replace('mirror+file:/etc/apt/apt-mirrors.txt', MIRROR),
  );
  const unknown = source.replace('apt-mirrors.txt', 'other-mirrors.txt');
  assert.equal(rewriteSources(unknown, 'sources.list', true), unknown);
});

test('planning verifies the actual runner mirror list and changes only its source URI', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-browser-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'sources.list.d'));
  const file = path.join(root, 'sources.list.d', 'ubuntu.sources');
  const source =
    'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: resolute resolute-updates resolute-backports resolute-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
  const mirrorFile = path.join(root, 'apt-mirrors.txt');
  const mirrors =
    'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
  await fs.writeFile(file, source);
  await assert.rejects(readMirrorPlan(root), /ENOENT/u);
  await fs.writeFile(mirrorFile, mirrors);
  assert.deepEqual(await readMirrorPlan(root), [
    {
      file,
      original: source,
      updated: source.replace('mirror+file:/etc/apt/apt-mirrors.txt', MIRROR),
    },
  ]);
  assert.equal(await fs.readFile(mirrorFile, 'utf8'), mirrors);
  await fs.writeFile(mirrorFile, mirrors + 'https://example.test/ubuntu/\n');
  await assert.rejects(readMirrorPlan(root), /known Ubuntu archives/u);
});

function fixture(results, extra = {}) {
  const events = [];
  const options = {
    runInstall: async (timeout) => {
      events.push(['install', timeout]);
      return results.shift();
    },
    eligible: async () => true,
    planSources: async () => [
      { file: '/fixture/ubuntu.sources', original: 'original', updated: 'mirror' },
    ],
    write: async (...args) => {
      events.push(['write', ...args]);
    },
    log: () => {},
    ...extra,
  };
  return { events, options };
}

test('ordinary success, non-DNS failure, cancellation and non-CI hosts never change apt', async () => {
  for (const first of [
    { status: 0, dnsFailure: false },
    { status: 1, dnsFailure: false },
    { status: 1, dnsFailure: true, interrupted: true },
  ]) {
    const { options, events } = fixture([first]);
    assert.equal(await installBrowser(options), first.status);
    assert.deepEqual(events, [['install', 720000]]);
  }
  const { options, events } = fixture([{ status: 1, dnsFailure: true }], {
    eligible: async () => false,
  });
  assert.equal(await installBrowser(options), 1);
  assert.deepEqual(events, [['install', 720000]]);
});

test('one complete retry restores sources on both success and repeated failure', async () => {
  assert.deepEqual(INSTALL_ARGS.slice(-3), ['install', '--with-deps', 'chromium']);
  for (const status of [0, 1, 124]) {
    const { options, events } = fixture([
      { status: 1, dnsFailure: true },
      { status, dnsFailure: true },
    ]);
    assert.equal(await installBrowser(options), status);
    assert.deepEqual(events, [
      ['install', 720000],
      ['write', '/fixture/ubuntu.sources', 'mirror'],
      ['install', 300000],
      ['write', '/fixture/ubuntu.sources', 'original'],
    ]);
  }
});

test('a partial write and a thrown retry are restored and remain failures', async () => {
  const partial = fixture([{ status: 1, dnsFailure: true }]);
  partial.options.write = async (file, value) => {
    partial.events.push(['write', file, value]);
    if (value === 'mirror') throw new Error('partial write');
  };
  await assert.rejects(installBrowser(partial.options), /partial write/u);
  assert.deepEqual(partial.events.at(-1), ['write', '/fixture/ubuntu.sources', 'original']);
  assert.equal(partial.events.filter(([event]) => event === 'install').length, 1);
  const thrown = fixture([{ status: 1, dnsFailure: true }]);
  let calls = 0;
  thrown.options.runInstall = async () => {
    if (calls++ === 0) return { status: 1, dnsFailure: true };
    throw new Error('spawn failed');
  };
  await assert.rejects(installBrowser(thrown.options), /spawn failed/u);
  assert.deepEqual(thrown.events.at(-1), ['write', '/fixture/ubuntu.sources', 'original']);
});

test('restoration failure cannot produce a successful install result', async () => {
  const { options } = fixture([{ status: 1, dnsFailure: true }, { status: 0 }]);
  options.write = async (_file, value) => {
    if (value === 'original') throw new Error('restore');
  };
  await assert.rejects(installBrowser(options), /restoration failed/u);
});

test('real subprocess output is drained and split DNS messages are recognized', async () => {
  const script = `process.stdout.write("Temporary failure resolving '"); setTimeout(() => { process.stderr.write("archive.ubuntu.com'\\n"); process.exitCode=7; }, 10);`;
  const result = await runCommand(process.execPath, ['-e', script], {
    quiet: true,
    timeoutMs: 2000,
  });
  assert.equal(result.status, 7);
  assert.equal(result.dnsFailure, true);
});

test('a hung retry is bounded and fails', async () => {
  const result = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    quiet: true,
    timeoutMs: 100,
  });
  assert.equal(result.status, 124);
});
