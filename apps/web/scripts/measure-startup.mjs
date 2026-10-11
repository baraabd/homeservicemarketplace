#!/usr/bin/env node
/**
 * Repeatable browser startup measurements, using the installed Playwright.
 *
 * pnpm --filter @homeservicemarketplace/web exec node scripts/measure-startup.mjs \
 *   --base-url http://127.0.0.1:4173 --api-mode real \
 *   --config /absolute/path/to/startup-scenarios.json --output /tmp/startup.json
 *
 * Example scenario file (keep real storage-state files outside the repository):
 * {
 *   "viewport": { "width": 390, "height": 844 }, "language": "en",
 *   "cpuSlowdown": 4,
 *   "network": { "latencyMs": 150, "downloadKbps": 1600, "uploadKbps": 750 },
 *   "routes": [{
 *     "name": "admin-dashboard", "path": "/admin",
 *     "storageState": "./admin-session.json",
 *     "readySelectors": ["[data-testid='admin-approval-center']"],
 *     "interactions": [{ "type": "click", "selector": "button[aria-label='Switch language']",
 *       "acknowledge": { "selector": "html[lang='ar']", "state": "attached" } }]
 *   }]
 * }
 *
 * The caller labels the API mode; this script never substitutes HTTP fixtures.
 * Use real accounts and readiness selectors that prove real content, not only
 * a loading shell. An expired session must fail the expected-path/readiness
 * check instead of producing an apparently fast protected-route measurement.
 *
 * Cold = a fresh browser context/HTTP cache with only the supplied session.
 * Warm = reload in that same context. If an interaction navigated elsewhere,
 * the original route is restored before its measured reload. DNS/TLS state,
 * backend caches and server process startup are not isolated by this harness.
 * Browser polling and sockets make networkidle unsuitable as a readiness gate.
 *
 * No request URLs, bodies, cookies, tokens, storage states, screenshots or HARs
 * are written. Failures deliberately omit raw browser exception messages.
 * Action acknowledgement includes driver overhead; it is NOT INP. Observed
 * long-task blocking is NOT Lighthouse TBT. Lab runs do not establish field
 * Core Web Vitals or production load capacity.
 */
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { createStartupErrorPolicy, validateExpectedHttpErrors } from './startup-error-policy.mjs';

const { values: cli } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    config: { type: 'string' },
    'base-url': { type: 'string' },
    output: { type: 'string' },
    repetitions: { type: 'string' },
    'api-mode': { type: 'string' },
    revision: { type: 'string' },
    'storage-state': { type: 'string' },
    'browser-executable': { type: 'string' },
  },
});

if (cli.help) {
  console.log(`Measure browser startup against an already-running build/API.

Options:
  --config FILE              JSON scenario configuration (example in this file)
  --base-url URL             Web origin, e.g. http://127.0.0.1:4173
  --output FILE              Aggregate JSON, default test-results/startup-performance.json
  --repetitions N            At least 5 cold/warm pairs per route, default 5
  --api-mode MODE            real | fixture | unavailable | unverified (explicit label)
  --revision SHA             Exact source/build revision being measured
  --storage-state FILE       Optional default Playwright session; never copied to report
  --browser-executable FILE  Optional installed Chromium executable

Config also accepts timeoutMs, observationMs, viewport, locale, timezoneId,
language (en/ar), cpuSlowdown and network (latencyMs/downloadKbps/uploadKbps).
Each route has name, path, readySelectors[], optional expectedPath/storageState,
and interactions[]. Actions: fill (selector/value), click or press (selector/key)
with acknowledge: {selector, state: visible|hidden|attached|detached}.
An optional expectedHttpErrors[] permits an exact absolute URL, method, 4xx
status and maxCount per navigation (default 1). No wildcard or 5xx exceptions.
Only its observed native Chromium resource console message is also excused.
Every configured route requires an actual acknowledged interaction.
Without a config, only the public selector and editable login input are tested.
This script does not start servers, seed accounts, mock HTTP, or measure INP.`);
  process.exit(0);
}

function requireSetting(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNumber(value, fallback, minimum, maximum, name) {
  const number = value === undefined ? fallback : Number(value);
  requireSetting(
    Number.isFinite(number) && number >= minimum && number <= maximum,
    `Invalid ${name}`,
  );
  return number;
}

function publicRoute() {
  return {
    name: 'public-selector',
    path: '/select',
    readySelectors: ['[data-testid="app-card-seeker"]'],
    interactions: [
      {
        type: 'click',
        selector: '[data-testid="app-card-seeker"]',
        acknowledge: { selector: 'input[type="email"]', state: 'visible' },
      },
      { type: 'fill', selector: 'input[type="email"]', value: 'startup-measurement@example.test' },
    ],
  };
}

async function readConfiguration() {
  const configPath = cli.config ? resolve(cli.config) : null;
  const raw = configPath ? JSON.parse(await readFile(configPath, 'utf8')) : {};
  const configDirectory = configPath ? dirname(configPath) : process.cwd();
  const baseURL = new URL(cli['base-url'] ?? raw.baseURL ?? 'http://127.0.0.1:4173');
  requireSetting(
    ['http:', 'https:'].includes(baseURL.protocol) && !baseURL.username && !baseURL.password,
    'A plain HTTP(S) web origin is required',
  );
  requireSetting(
    baseURL.pathname === '/' && !baseURL.search && !baseURL.hash,
    'baseURL must be a web origin',
  );
  const repetitions = finiteNumber(cli.repetitions ?? raw.repetitions, 5, 5, 100, 'repetitions');
  requireSetting(Number.isInteger(repetitions), 'repetitions must be an integer');
  const apiMode = cli['api-mode'] ?? raw.apiMode ?? 'unverified';
  requireSetting(
    ['real', 'fixture', 'unavailable', 'unverified'].includes(apiMode),
    'Invalid apiMode',
  );
  const routes = raw.routes ?? [publicRoute()];
  requireSetting(Array.isArray(routes) && routes.length > 0, 'routes must be a nonempty array');
  const names = new Set();
  for (const route of routes) {
    route.expectedHttpErrors = validateExpectedHttpErrors(route.expectedHttpErrors);
    requireSetting(
      typeof route.name === 'string' &&
        /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(route.name) &&
        !names.has(route.name),
      'Route names must be unique simple labels',
    );
    names.add(route.name);
    requireSetting(
      typeof route.path === 'string' && route.path.startsWith('/') && !route.path.startsWith('//'),
      'Each route requires a same-origin path',
    );
    route.url = new URL(route.path, baseURL).href;
    requireSetting(
      new URL(route.url).origin === baseURL.origin,
      'Route must use the configured origin',
    );
    route.expectedPath ??= new URL(route.url).pathname;
    requireSetting(
      typeof route.expectedPath === 'string' && route.expectedPath.startsWith('/'),
      'Invalid expectedPath',
    );
    requireSetting(
      Array.isArray(route.readySelectors) &&
        route.readySelectors.length > 0 &&
        route.readySelectors.every((value) => typeof value === 'string' && value.length > 0),
      'Each route requires readySelectors',
    );
    requireSetting(
      Array.isArray(route.interactions) && route.interactions.length > 0,
      'Each route requires an acknowledged interaction',
    );
    for (const action of route.interactions) {
      requireSetting(
        ['click', 'fill', 'press'].includes(action.type) &&
          typeof action.selector === 'string' &&
          action.selector.length > 0,
        'Invalid interaction',
      );
      if (action.type === 'fill')
        requireSetting(typeof action.value === 'string', 'Fill requires a value');
      if (action.type === 'press')
        requireSetting(typeof action.key === 'string', 'Press requires a key');
      if (action.type !== 'fill' || action.acknowledge) {
        requireSetting(
          typeof action.acknowledge?.selector === 'string' &&
            ['visible', 'hidden', 'attached', 'detached'].includes(
              action.acknowledge.state ?? 'visible',
            ),
          'Click/press requires an acknowledgement selector',
        );
      }
    }
    const state = route.storageState ?? cli['storage-state'] ?? raw.storageState;
    route.stateFile = state ? resolve(configDirectory, state) : undefined;
  }
  const viewport = {
    width: finiteNumber(raw.viewport?.width, 1440, 240, 7680, 'viewport width'),
    height: finiteNumber(raw.viewport?.height, 900, 240, 4320, 'viewport height'),
  };
  const network = raw.network
    ? {
        latencyMs: finiteNumber(raw.network.latencyMs, 0, 0, 10000, 'network latency'),
        downloadKbps: finiteNumber(raw.network.downloadKbps, 1600, 1, 10000000, 'network download'),
        uploadKbps: finiteNumber(raw.network.uploadKbps, 750, 1, 10000000, 'network upload'),
      }
    : null;
  requireSetting(
    raw.language === undefined || ['en', 'ar'].includes(raw.language),
    'language must be en or ar',
  );
  const revision = cli.revision ?? raw.revision ?? null;
  requireSetting(
    revision === null || /^[a-f0-9]{7,40}$/i.test(revision),
    'revision must be a commit SHA',
  );
  return {
    routes,
    repetitions,
    apiMode,
    viewport,
    network,
    revision,
    baseURL: baseURL.origin,
    output: resolve(cli.output ?? raw.output ?? 'test-results/startup-performance.json'),
    timeoutMs: finiteNumber(raw.timeoutMs, 30000, 1000, 120000, 'timeoutMs'),
    observationMs: finiteNumber(raw.observationMs, 500, 0, 10000, 'observationMs'),
    cpuSlowdown: finiteNumber(raw.cpuSlowdown, 1, 1, 20, 'cpuSlowdown'),
    locale: raw.locale ?? 'en-US',
    timezoneId: raw.timezoneId ?? 'UTC',
    language: raw.language,
    browserExecutable: cli['browser-executable'] ?? raw.browserExecutable,
  };
}

// Runs in Chromium before app code; no application data is read or persisted.
function installObservers({ language }) {
  if (language) {
    try {
      globalThis.localStorage.setItem('hsm.lang', language);
    } catch {
      /* Storage may be unavailable. */
    }
  }
  const observed = { lcpMs: null, cls: 0, longTasks: [], supported: {}, contentReadyMs: null };
  let sessionStart = 0;
  let previousShift = 0;
  let sessionValue = 0;
  let hasSession = false;
  const observers = [];
  function observe(type, consume) {
    observed.supported[type] =
      globalThis.PerformanceObserver?.supportedEntryTypes?.includes(type) ?? false;
    if (!observed.supported[type]) return;
    const observer = new globalThis.PerformanceObserver((list) => consume(list.getEntries()));
    observer.observe({ type, buffered: true });
    observers.push({ observer, consume });
  }
  observe('largest-contentful-paint', (entries) => {
    for (const entry of entries) observed.lcpMs = entry.startTime;
  });
  observe('layout-shift', (entries) => {
    for (const entry of entries) {
      if (entry.hadRecentInput) continue;
      if (
        !hasSession ||
        entry.startTime - previousShift >= 1000 ||
        entry.startTime - sessionStart >= 5000
      ) {
        hasSession = true;
        sessionStart = entry.startTime;
        sessionValue = 0;
      }
      previousShift = entry.startTime;
      sessionValue += entry.value;
      observed.cls = Math.max(observed.cls, sessionValue);
    }
  });
  observe('longtask', (entries) => {
    observed.longTasks.push(...entries.map(({ startTime, duration }) => ({ startTime, duration })));
  });
  globalThis.__hsmStartupMeasurement = {
    observed,
    flush: () => {
      for (const { observer, consume } of observers) consume(observer.takeRecords());
    },
  };
  globalThis.performance.setResourceTimingBufferSize(5000);
}

function longTaskSummary(tasks) {
  return {
    count: tasks.length,
    totalDurationMs: tasks.reduce((sum, task) => sum + task.duration, 0),
    maxDurationMs: Math.max(0, ...tasks.map((task) => task.duration)),
    blockingOver50Ms: tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
  };
}

async function snapshot(page) {
  const measured = await page.evaluate(() => {
    const tracker = globalThis.__hsmStartupMeasurement;
    tracker.flush();
    const navigation = globalThis.performance.getEntriesByType('navigation')[0];
    const fcp = globalThis.performance.getEntriesByName('first-contentful-paint')[0];
    const resourceBodies = {};
    for (const entry of globalThis.performance.getEntriesByType('resource')) {
      const pathname = new URL(entry.name, globalThis.location.href).pathname;
      const type =
        entry.initiatorType === 'script' || /\.(?:[cm]?js|[jt]sx?)$/.test(pathname)
          ? 'script'
          : /\.css$/.test(pathname)
            ? 'stylesheet'
            : 'other';
      const group = (resourceBodies[type] ??= {
        count: 0,
        encodedBodyBytes: 0,
        decodedBodyBytes: 0,
        transferBytes: 0,
        zeroTransferEntries: 0,
      });
      group.count += 1;
      group.encodedBodyBytes += entry.encodedBodySize;
      group.decodedBodyBytes += entry.decodedBodySize;
      group.transferBytes += entry.transferSize;
      if (entry.transferSize === 0) group.zeroTransferEntries += 1;
    }
    return {
      ...tracker.observed,
      observationEndMs: globalThis.performance.now(),
      fcpMs: fcp?.startTime ?? null,
      navigationToFirstByteMs: navigation ? navigation.responseStart - navigation.startTime : null,
      requestToFirstByteMs: navigation ? navigation.responseStart - navigation.requestStart : null,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd || null,
      loadEventMs: navigation?.loadEventEnd || null,
      serviceWorkerControlled: Boolean(globalThis.navigator.serviceWorker?.controller),
      resourceBodies,
    };
  });
  const { longTasks, ...metrics } = measured;
  return {
    ...metrics,
    cls: measured.supported['layout-shift'] ? measured.cls : null,
    longTasksToContentReady: measured.supported.longtask
      ? longTaskSummary(longTasks.filter((task) => task.startTime < measured.contentReadyMs))
      : null,
    longTasksInObservationWindow: measured.supported.longtask ? longTaskSummary(longTasks) : null,
  };
}

async function afterPaint(page) {
  await page.evaluate(
    () =>
      new Promise((done) => {
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(done));
      }),
  );
}

async function waitForPresentedContent(page, selectors, timeoutMs, requireViewport = false) {
  const deadline = performance.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - performance.now());
  for (const selector of selectors)
    await page.locator(selector).waitFor({ state: 'visible', timeout: remaining() });
  // Playwright's `visible` includes opacity:0. AppSelector intentionally fades
  // its cards in, so DOM attachment alone would claim readiness before users
  // can see them. Inspect the target and its ancestors without disabling motion.
  while (true) {
    const presented = await Promise.all(
      selectors.map((selector) =>
        page.locator(selector).evaluate(
          (element, intersectViewport) => {
            if (!element.isConnected || element.getClientRects().length === 0) return false;
            const bounds = element.getBoundingClientRect();
            let left = Math.max(bounds.left, 0);
            let top = Math.max(bounds.top, 0);
            let right = Math.min(bounds.right, globalThis.innerWidth);
            let bottom = Math.min(bounds.bottom, globalThis.innerHeight);
            for (let ancestor = element; ancestor; ) {
              const style = globalThis.getComputedStyle(ancestor);
              if (
                Number(style.opacity) < 0.99 ||
                style.visibility !== 'visible' ||
                style.display === 'none'
              )
                return false;
              if (intersectViewport && ancestor !== element) {
                const clip = ancestor.getBoundingClientRect();
                if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
                  left = Math.max(left, clip.left);
                  right = Math.min(right, clip.right);
                }
                if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
                  top = Math.max(top, clip.top);
                  bottom = Math.min(bottom, clip.bottom);
                }
              }
              const root = ancestor.getRootNode();
              ancestor =
                ancestor.parentElement ??
                (root instanceof globalThis.ShadowRoot ? root.host : null);
            }
            return !intersectViewport || (right > left && bottom > top);
          },
          requireViewport,
          { timeout: remaining() },
        ),
      ),
    );
    if (presented.every(Boolean)) return;
    requireSetting(performance.now() < deadline, 'Content did not become visually presented');
    await page.waitForTimeout(16);
  }
}

async function waitForContent(page, route, timeoutMs) {
  await waitForPresentedContent(page, route.readySelectors, timeoutMs);
  requireSetting(new URL(page.url()).pathname === route.expectedPath, 'Unexpected route');
  await afterPaint(page);
}

async function performInteraction(page, action, timeoutMs) {
  const started = performance.now();
  const target = page.locator(action.selector);
  if (action.type === 'click') await target.click();
  if (action.type === 'press') await target.press(action.key);
  if (action.type === 'fill') {
    await target.fill(action.value);
    requireSetting((await target.inputValue()) === action.value, 'Input did not acknowledge value');
  }
  if (action.acknowledge) {
    await page
      .locator(action.acknowledge.selector)
      .waitFor({ state: action.acknowledge.state ?? 'visible' });
    if ((action.acknowledge.state ?? 'visible') === 'visible')
      await waitForPresentedContent(page, [action.acknowledge.selector], timeoutMs, true);
  }
  await afterPaint(page);
  return {
    type: action.type,
    acknowledged: true,
    driverActionToAcknowledgedPaintMs: performance.now() - started,
  };
}

function networkCollector(cdp, page, expectedHttpErrors) {
  let records = new Map();
  let counts = { pageErrors: 0, consoleErrors: 0, failedRequests: 0 };
  let policy = createStartupErrorPolicy(expectedHttpErrors);
  cdp.on('Network.requestWillBeSent', ({ requestId, type, request }) => {
    records.set(requestId, {
      type: type ?? 'Other',
      method: request.method,
      status: null,
      bytes: 0,
      cache: false,
      serviceWorker: false,
    });
  });
  cdp.on('Network.responseReceived', ({ requestId, response, type }) => {
    const record = records.get(requestId);
    if (record)
      policy.response({ url: response.url, method: record.method, status: response.status });
    if (record)
      Object.assign(record, {
        type,
        status: response.status,
        cache: Boolean(response.fromDiskCache || response.fromPrefetchCache),
        serviceWorker: Boolean(response.fromServiceWorker),
      });
  });
  cdp.on('Network.requestServedFromCache', ({ requestId }) => {
    const record = records.get(requestId);
    if (record) record.cache = true;
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const record = records.get(requestId);
    if (record) record.bytes = encodedDataLength;
  });
  cdp.on('Network.loadingFailed', ({ requestId, canceled }) => {
    if (records.has(requestId) && !canceled) counts.failedRequests += 1;
  });
  page.on('pageerror', () => {
    counts.pageErrors += 1;
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      counts.consoleErrors += 1;
      policy.consoleError({ url: message.location().url, text: message.text() });
    }
  });
  return {
    reset() {
      records = new Map();
      counts = { pageErrors: 0, consoleErrors: 0, failedRequests: 0 };
      policy = createStartupErrorPolicy(expectedHttpErrors);
    },
    read() {
      const resourcesByType = {};
      const httpErrorsByStatus = {};
      for (const record of records.values()) {
        const group = (resourcesByType[record.type] ??= {
          requests: 0,
          networkEncodedBytes: 0,
          cacheResponses: 0,
          serviceWorkerResponses: 0,
        });
        group.requests += 1;
        group.networkEncodedBytes += record.bytes;
        group.cacheResponses += Number(record.cache);
        group.serviceWorkerResponses += Number(record.serviceWorker);
        if (record.status >= 400)
          httpErrorsByStatus[record.status] = (httpErrorsByStatus[record.status] ?? 0) + 1;
      }
      const errors = policy.read();
      return {
        counts: { ...counts, unexpectedConsoleErrors: errors.unexpectedConsoleErrors },
        resourcesByType,
        httpErrorsByStatus,
        expectedHttpErrors: errors.expectedHttpErrors,
        unexpectedHttpErrorsByStatus: errors.unexpectedHttpErrorsByStatus,
      };
    },
  };
}

async function measure(page, route, mode, repetition, network, config) {
  let stage = 'navigation';
  network.reset();
  const result = {
    route: route.name,
    mode,
    repetition,
    status: 'failed',
    metrics: null,
    interactions: [],
  };
  try {
    const response =
      mode === 'cold'
        ? await page.goto(route.url, { waitUntil: 'domcontentloaded' })
        : await page.reload({ waitUntil: 'domcontentloaded' });
    requireSetting(response?.ok(), 'Document HTTP failure');
    stage = 'content-readiness';
    await waitForContent(page, route, config.timeoutMs);
    await page.evaluate(() => {
      globalThis.performance.mark('startup:content-ready');
      globalThis.__hsmStartupMeasurement.observed.contentReadyMs = globalThis.performance.now();
    });
    if (config.observationMs) await page.waitForTimeout(config.observationMs);
    result.metrics = await snapshot(page);
    result.networkToObservationEnd = network.read();
    stage = 'interaction';
    for (const action of route.interactions)
      result.interactions.push(await performInteraction(page, action, config.timeoutMs));
    stage = 'unhandled-browser-exception';
    requireSetting(network.read().counts.pageErrors === 0, 'Unhandled browser exception');
    stage = 'unexpected-http-response';
    requireSetting(
      Object.keys(network.read().unexpectedHttpErrorsByStatus).length === 0,
      'Unexpected HTTP error',
    );
    stage = 'unexpected-console-error';
    requireSetting(
      network.read().counts.unexpectedConsoleErrors === 0,
      'Unexpected browser console error',
    );
    stage = 'failed-network-request';
    requireSetting(network.read().counts.failedRequests === 0, 'Failed network request');
    result.status = 'passed';
  } catch {
    result.failureStage = stage;
  }
  result.networkIncludingInteractions = network.read();
  return result;
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length
    ? {
        samples: sorted.length,
        min: sorted[0],
        max: sorted.at(-1),
        median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
      }
    : { samples: 0, min: null, median: null, max: null };
}

function summarize(results) {
  const groups = {};
  for (const result of results) (groups[`${result.route}:${result.mode}`] ??= []).push(result);
  return Object.entries(groups).map(([scenario, runs]) => ({
    scenario,
    completed: runs.length,
    passed: runs.filter((run) => run.status === 'passed').length,
    failed: runs.filter((run) => run.status === 'failed').length,
    contentReadyMs: distribution(runs.map((run) => run.metrics?.contentReadyMs)),
    fcpMs: distribution(runs.map((run) => run.metrics?.fcpMs)),
    lcpMs: distribution(runs.map((run) => run.metrics?.lcpMs)),
    cls: distribution(runs.map((run) => run.metrics?.cls)),
    navigationToFirstByteMs: distribution(runs.map((run) => run.metrics?.navigationToFirstByteMs)),
  }));
}

async function run() {
  const config = await readConfiguration();
  const report = {
    schemaVersion: 1,
    status: 'running',
    startedAt: new Date().toISOString(),
    revision: config.revision,
    apiMode: config.apiMode,
    apiModeProvenance:
      'caller-declared; no HTTP fixtures or session bypass are installed by this harness',
    environment: {
      node: process.version,
      platform: process.platform,
      browser: null,
      viewport: config.viewport,
      locale: config.locale,
      timezoneId: config.timezoneId,
      language: config.language ?? 'session-or-app-default',
      cpuSlowdown: config.cpuSlowdown,
      network: config.network ?? 'unthrottled',
      headless: true,
    },
    methodology: {
      repetitions: config.repetitions,
      observationAfterReadinessMs: config.observationMs,
      cold: 'Fresh context and HTTP cache; supplied session only. DNS/TLS and server caches are not reset.',
      warm: 'Same-context reload, after restoring the initial route if its interaction navigated away.',
      contentReady:
        'All configured content selectors visible, each target and ancestor opacity >=0.99, expected path confirmed, then two animation frames. Data-readiness targets may be below the fold; existing animations remain enabled.',
      paintMetrics:
        'Last observed LCP candidate and maximum CLS session through observationEndMs, before interactions; not full page-lifetime field values.',
      resourceBytes:
        'Resource Timing body sizes; CDP encoded bytes include transport overhead. Zero transfer may mean cache or cross-origin timing restrictions.',
      longTasks:
        'Observed >50ms tasks through the stated observation window; blockingOver50Ms is not Lighthouse TBT.',
      interaction:
        'Playwright action through explicit acknowledgement and two frames, including driver overhead. Visible acknowledgements also require target/ancestor opacity >=0.99 and viewport/ancestor-clip intersection, without a stability gate on continuously animated controls. Not INP.',
      limitations:
        'Lab startup only. No field INP, no backend capacity claim, no p95/p99 from a five-run sample.',
    },
    results: [],
    summary: [],
  };
  await mkdir(dirname(config.output), { recursive: true });
  const save = async () => {
    report.summary = summarize(report.results);
    await writeFile(`${config.output}.tmp`, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(`${config.output}.tmp`, config.output);
  };
  await save();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(config.browserExecutable ? { executablePath: config.browserExecutable } : {}),
    });
    report.environment.browser = browser.version();
    for (const route of config.routes) {
      for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
        const context = await browser.newContext({
          viewport: config.viewport,
          locale: config.locale,
          timezoneId: config.timezoneId,
          storageState: route.stateFile,
          serviceWorkers: 'allow',
        });
        try {
          context.setDefaultTimeout(config.timeoutMs);
          context.setDefaultNavigationTimeout(config.timeoutMs);
          await context.addInitScript(installObservers, { language: config.language });
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Network.enable');
          await cdp.send('Network.clearBrowserCache');
          await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
          if (config.cpuSlowdown !== 1)
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: config.cpuSlowdown });
          if (config.network)
            await cdp.send('Network.emulateNetworkConditions', {
              offline: false,
              latency: config.network.latencyMs,
              downloadThroughput: (config.network.downloadKbps * 1000) / 8,
              uploadThroughput: (config.network.uploadKbps * 1000) / 8,
            });
          const network = networkCollector(cdp, page, route.expectedHttpErrors);
          const cold = await measure(page, route, 'cold', repetition, network, config);
          report.results.push(cold);
          await save();
          console.log(`${route.name} cold ${repetition}/${config.repetitions}: ${cold.status}`);
          if (cold.metrics) {
            if (page.url() !== route.url) {
              await page.goto(route.url, { waitUntil: 'domcontentloaded' });
              await waitForContent(page, route, config.timeoutMs);
            }
            const warm = await measure(page, route, 'warm', repetition, network, config);
            report.results.push(warm);
            console.log(`${route.name} warm ${repetition}/${config.repetitions}: ${warm.status}`);
          } else {
            report.results.push({
              route: route.name,
              mode: 'warm',
              repetition,
              status: 'failed',
              failureStage: 'cold-prerequisite-failed',
              metrics: null,
              interactions: [],
            });
          }
        } finally {
          await context.close();
          await save();
        }
      }
    }
    report.status = report.results.every((result) => result.status === 'passed')
      ? 'completed'
      : 'failed';
  } catch {
    report.status = 'failed';
    report.harnessFailure =
      'Browser/session/configuration or route-restoration failed; no raw error data is persisted.';
  } finally {
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    await save();
  }
  console.log(
    `Startup measurement ${report.status}: ${report.results.length} observations written.`,
  );
  if (report.status !== 'completed') process.exitCode = 1;
}

try {
  await run();
} catch {
  console.error(
    'Startup measurement could not start. Check the configuration, paths and installed Playwright/browser; no raw error data is printed.',
  );
  process.exitCode = 1;
}
