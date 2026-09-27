#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { checkRuntime, printResult } = require('./check-runtime.cjs');

function startApi({ apiRoot, env = process.env, output = console, load = require }) {
  const result = checkRuntime({ apiRoot, env });
  printResult(result, output);
  if (!result.ok) return false;
  // Same process, same injected environment, no subprocess/signal forwarding
  // and no migration. The API keeps its existing bootstrap/shutdown handling.
  load(path.join(apiRoot, 'dist/main.js'));
  return true;
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error('FAIL usage: node start-api.cjs built-api-root');
    process.exitCode = 1;
  } else {
    try {
      if (!startApi({ apiRoot: path.resolve(process.argv[2]) })) process.exitCode = 1;
    } catch {
      console.error('FAIL guarded API bootstrap; inspect sanitized application diagnostics');
      process.exitCode = 1;
    }
  }
}
module.exports = { startApi };
