#!/usr/bin/env node
// R27 — production bundle composition per role journey.
//
// Builds the web app through Vite's own API with the repository's real
// `apps/web/vite.config.ts` (nothing in it is changed), into a disposable
// output directory, and records the emitted chunk graph: which chunks the
// browser must fetch before the app can run, what each lazy route adds, and
// which packages and source areas those bytes come from.
//
// This measures BYTES, not time. Parse/execute and presented-content timing
// come from browser runs (`apps/web/e2e/startup-performance.real-api.spec.ts`
// in hosted CI, `page-load.mjs` locally). The build's wall-clock duration is
// recorded only as build time and is never a page-load metric.
//
// `--overlay <repo-path>=<replacement-path>` serves the replacement file's
// contents in place of a source module during this build only. It measures a
// proposed change request without editing a file this lane does not own; the
// working tree is never modified.
//
// Usage:
//   node scripts/perf/post-r18/bundle-report.mjs --label baseline \
//     --out-json docs/performance/post-r18/bundle-baseline.json \
//     [--overlay apps/web/src/x.tsx=docs/.../x.tsx] [--keep-dist]

import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import {
  attribute,
  bytesMatching,
  chunksContaining,
  dynamicEntryFor,
  entryChunks,
  increment,
  initialChunkSet,
  sizeOf,
} from './lib/bundle-graph.mjs';
import { REPO_ROOT, hostProvenance, sourceProvenance } from './lib/provenance.mjs';

const WEB_ROOT = resolve(REPO_ROOT, 'apps/web');

// The lazy boundaries declared in apps/web/src/app/routes.ts and Root.tsx.
// A journey's cost is the initial graph plus the increment of its page.
const SHELL_ROOT = 'src/bootstrap.tsx';
const JOURNEYS = [
  { name: 'public-selector', page: null },
  { name: 'auth', page: 'src/app/pages/AuthPages.tsx' },
  { name: 'seeker-home', page: 'src/app/pages/HomePage.tsx' },
  { name: 'provider-workspace', page: 'src/app/pages/ProviderPage.tsx' },
  { name: 'provider-onboarding', page: 'src/app/pages/ProviderOnboardingPage.tsx' },
  { name: 'admin', page: 'src/app/pages/AdminPage.tsx' },
  { name: 'disputes', page: 'src/app/pages/DisputesPage.tsx' },
  { name: 'job-wizard', page: 'src/app/components/wizard/JobWizardModal.tsx' },
  // Second-level lazy boundaries proposed by R27 change requests. Absent in a
  // build without the change, which is recorded rather than treated as an error.
  {
    name: 'admin-dashboard-charts',
    page: 'src/app/components/admin/DashboardOverview.tsx',
    parent: 'admin',
    optional: true,
  },
  {
    name: 'address-map',
    page: 'src/app/components/ds/LocationMap.tsx',
    parent: 'seeker-home',
    optional: true,
  },
];

// Libraries whose placement the sprint brief asks about explicitly.
const HEAVY = {
  recharts: /\/node_modules\/recharts\//,
  'pdfjs-dist': /\/node_modules\/pdfjs-dist\//,
  leaflet: /\/node_modules\/(react-)?leaflet\//,
  '@mui/material': /\/node_modules\/@mui\/material\//,
  '@mui/icons-material': /\/node_modules\/@mui\/icons-material\//,
  'motion/framer-motion': /\/node_modules\/(motion|framer-motion|motion-dom)\//,
  'socket.io-client': /\/node_modules\/(socket\.io-client|engine\.io-client)\//,
  'lucide-react': /\/node_modules\/lucide-react\//,
};

// Recorded with values: public build flags. Any other VITE_* is name-only.
const RECORDED_FLAG_VALUES = new Set(['VITE_API_URL', 'VITE_PROVIDER_ONBOARDING_V2']);

function parseArgs(argv) {
  const out = { label: 'unlabelled', overlays: [], outJson: null, keepDist: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--label') out.label = argv[++i];
    else if (arg === '--out-json') out.outJson = argv[++i];
    else if (arg === '--keep-dist') out.keepDist = true;
    else if (arg === '--overlay') {
      const [target, source] = argv[++i].split('=');
      if (!target || !source) throw new Error('--overlay needs <repo-path>=<replacement-path>');
      out.overlays.push({ target: resolve(REPO_ROOT, target), source: resolve(REPO_ROOT, source) });
    } else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

const norm = (path) => path.replace(/\\/g, '/').split('?')[0].toLowerCase();

function overlayPlugin(overlays) {
  const byTarget = new Map(overlays.map((o) => [norm(o.target), o]));
  const used = new Set();
  return {
    plugin: {
      name: 'r27-measurement-overlay',
      enforce: 'pre',
      load(id) {
        const hit = byTarget.get(norm(id));
        if (!hit) return null;
        used.add(hit.target);
        return readFileSync(hit.source, 'utf8');
      },
    },
    used,
  };
}

function capturePlugin(sink) {
  return {
    name: 'r27-chunk-capture',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type !== 'chunk') continue;
        sink[fileName] = {
          isEntry: item.isEntry,
          isDynamicEntry: item.isDynamicEntry,
          facadeModuleId: item.facadeModuleId
            ? relative(WEB_ROOT, item.facadeModuleId).replace(/\\/g, '/')
            : null,
          imports: [...item.imports],
          dynamicImports: [...item.dynamicImports],
          css: [...(item.viteMetadata?.importedCss ?? [])],
          modules: Object.fromEntries(
            Object.entries(item.modules).map(([id, info]) => [
              id.replace(/\\/g, '/'),
              info.renderedLength,
            ]),
          ),
        };
      }
    },
  };
}

function compressedSizes(buffer) {
  return {
    raw: buffer.length,
    // nginx.conf enables gzip without gzip_comp_level, i.e. level 1.
    gzip: gzipSync(buffer, { level: 1 }).length,
    // Best-case static brotli; a lower bound for any brotli-serving edge.
    brotli: brotliCompressSync(buffer, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

function listFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map((p) => join(dir, p))
    .filter((p) => statSync(p).isFile());
}

const kib = (n) => Math.round((n / 1024) * 10) / 10;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.VITE_API_URL) process.env.VITE_API_URL = 'http://127.0.0.1:4010';
  const flags = Object.fromEntries(
    Object.keys(process.env)
      .filter((k) => k.startsWith('VITE_'))
      .sort()
      .map((k) => [k, RECORDED_FLAG_VALUES.has(k) ? process.env[k] : '<set>']),
  );

  const require = createRequire(resolve(WEB_ROOT, 'package.json'));
  const vitePkgPath = require.resolve('vite/package.json');
  const viteVersion = JSON.parse(readFileSync(vitePkgPath, 'utf8')).version;
  const vite = await import(pathToFileURL(resolve(vitePkgPath, '..', 'dist/node/index.js')).href);

  const outDir = mkdtempSync(join(tmpdir(), 'hsm-r27-bundle-'));
  const captured = {};
  const overlay = overlayPlugin(args.overlays);
  // loadEnv() in vite.config.ts reads process.cwd(); match `pnpm --filter web build`.
  process.chdir(WEB_ROOT);
  const started = performance.now();
  await vite.build({
    configFile: resolve(WEB_ROOT, 'vite.config.ts'),
    root: WEB_ROOT,
    mode: 'production',
    logLevel: 'warn',
    plugins: [overlay.plugin, capturePlugin(captured)],
    build: { outDir, emptyOutDir: true, reportCompressedSize: false },
  });
  const buildMs = Math.round(performance.now() - started);

  for (const o of args.overlays) {
    if (!overlay.used.has(o.target)) throw new Error(`overlay never loaded: ${o.target}`);
  }

  const assets = {};
  for (const file of listFiles(outDir)) {
    const rel = relative(outDir, file).replace(/\\/g, '/');
    const sizes = compressedSizes(readFileSync(file));
    if (captured[rel]) captured[rel].sizes = sizes;
    else assets[rel] = { sizes };
  }
  for (const [name, chunk] of Object.entries(captured)) {
    if (!chunk.sizes) throw new Error(`chunk ${name} was not written to disk`);
  }

  // index.html's entry only dynamically imports src/bootstrap.tsx (so a failed
  // import can show the HTML recovery screen). Every route needs that shell, so
  // the shell, not the 2 KiB entry, is the real first-load graph.
  const initial = initialChunkSet(captured);
  const bootstrap = dynamicEntryFor(captured, SHELL_ROOT);
  if (!bootstrap) throw new Error(`no lazy chunk for ${SHELL_ROOT}`);
  const shell = new Set([...initial, ...increment(captured, bootstrap, initial)]);

  // A second-level boundary costs what it adds beyond its parent page.
  const loadedBy = new Map();
  const journeys = JOURNEYS.map((journey) => {
    if (!journey.page) {
      return {
        name: journey.name,
        page: null,
        increment: null,
        total: sizeOf(captured, assets, shell),
      };
    }
    const root = dynamicEntryFor(captured, journey.page);
    if (!root && journey.optional) {
      return {
        name: journey.name,
        page: journey.page,
        lazyRoot: null,
        increment: null,
        total: null,
      };
    }
    if (!root) {
      const facades = Object.values(captured)
        .filter((c) => c.isDynamicEntry)
        .map((c) => c.facadeModuleId)
        .sort();
      throw new Error(`no lazy chunk for ${journey.page}; dynamic entries: ${facades.join(', ')}`);
    }
    const base = new Set([...shell, ...(loadedBy.get(journey.parent) ?? [])]);
    const added = increment(captured, root, base);
    loadedBy.set(journey.name, added);
    return {
      parent: journey.parent ?? null,
      name: journey.name,
      page: journey.page,
      lazyRoot: root,
      addedChunks: [...added].sort(),
      increment: {
        ...sizeOf(captured, assets, added),
        topOwners: attribute(captured, added).slice(0, 12),
      },
      total: sizeOf(captured, assets, new Set([...base, ...added])),
    };
  });

  // Rendered bytes, so a 1 KiB `?url` stub is not mistaken for the library.
  const heavy = Object.fromEntries(
    Object.entries(HEAVY).map(([name, pattern]) => [
      name,
      {
        chunks: chunksContaining(captured, pattern),
        renderedBytesInShell: bytesMatching(captured, shell, pattern),
        renderedBytesByJourney: Object.fromEntries(
          journeys
            .filter((j) => j.addedChunks)
            .map((j) => [j.name, bytesMatching(captured, new Set(j.addedChunks), pattern)])
            .filter(([, bytes]) => bytes > 0),
        ),
      },
    ]),
  );

  const report = {
    schemaVersion: 1,
    kind: 'r27-bundle-report',
    label: args.label,
    measuredAt: new Date().toISOString(),
    source: sourceProvenance(),
    host: hostProvenance(),
    toolchain: { vite: viteVersion },
    buildFlags: flags,
    overlays: args.overlays.map((o) => ({
      target: relative(REPO_ROOT, o.target).replace(/\\/g, '/'),
      source: relative(REPO_ROOT, o.source).replace(/\\/g, '/'),
    })),
    compression: { gzip: 'zlib level 1 (nginx.conf default)', brotli: 'quality 11 (lower bound)' },
    buildWallClockMs: { value: buildMs, note: 'build time only; not a page-load metric' },
    entries: entryChunks(captured),
    initial: { ...sizeOf(captured, assets, initial), chunks: [...initial].sort() },
    shell: {
      root: SHELL_ROOT,
      ...sizeOf(captured, assets, shell),
      chunks: [...shell].sort(),
      topOwners: attribute(captured, shell).slice(0, 20),
    },
    journeys,
    heavyLibraries: heavy,
    chunks: Object.fromEntries(
      Object.entries(captured)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, c]) => [
          name,
          {
            isEntry: c.isEntry,
            isDynamicEntry: c.isDynamicEntry,
            facadeModuleId: c.facadeModuleId,
            imports: c.imports,
            dynamicImports: c.dynamicImports,
            css: c.css,
            sizes: c.sizes,
            moduleCount: Object.keys(c.modules).length,
          },
        ]),
    ),
    assets,
  };

  if (args.outJson) {
    writeFileSync(resolve(REPO_ROOT, args.outJson), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (!args.keepDist) rmSync(outDir, { recursive: true, force: true });

  const line = (name, s) =>
    `${name.padEnd(22)} js ${String(kib(s.js.raw)).padStart(8)} KiB raw ${String(kib(s.js.gzip)).padStart(7)} gz1 ${String(kib(s.js.brotli)).padStart(7)} br | css ${String(kib(s.css.raw)).padStart(6)} raw | files ${s.files}`;
  console.log(
    `[r27-bundle] ${args.label} @ ${report.source.commit.slice(0, 12)} vite ${viteVersion}`,
  );
  console.log(line('entry', report.initial));
  console.log(line('shell (entry+bootstrap)', report.shell));
  for (const j of journeys) if (j.increment) console.log(line(`+${j.name}`, j.increment));
  for (const [name, h] of Object.entries(heavy)) {
    const where = Object.entries(h.renderedBytesByJourney)
      .map(([j, b]) => `${j}:${kib(b)}`)
      .join(' ');
    console.log(`  ${name.padEnd(22)} shell:${kib(h.renderedBytesInShell)} KiB  ${where}`);
  }
}

main().catch((error) => {
  console.error(`[r27-bundle] failed: ${error.message}`);
  process.exitCode = 1;
});
