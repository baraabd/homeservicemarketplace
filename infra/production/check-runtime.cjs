#!/usr/bin/env node
'use strict';

const path = require('node:path');

/** Read-only validation of the SAME built API that will serve traffic. */
function checkRuntime({ apiRoot = path.resolve(__dirname, '../../apps/api'), env = process.env } = {}) {
  try {
    const configDir = path.join(apiRoot, 'dist/config');
    const { validateEnv } = require(path.join(configDir, 'env.validation.js'));
    const { deploymentReadinessProblems } = require(path.join(configDir, 'runtime-policy.js'));
    const problems = deploymentReadinessProblems(validateEnv(env));
    if (!Array.isArray(problems) || problems.some((value) => typeof value !== 'string')) {
      throw new Error('invalid policy result');
    }
    return { ok: problems.length === 0, problems };
  } catch {
    // Validation/load errors can contain secret values. Never echo the error.
    return { ok: false, problems: ['runtime preflight: build the API and validate the injected deployment configuration'] };
  }
}

function printResult(result, output = console) {
  if (!result.ok) {
    for (const problem of result.problems) output.error(`FAIL ${problem}`);
    return;
  }
  output.log('PASS production runtime configuration preflight');
  output.log('Live mail, storage, database, scanner and browser acceptance remain separate release gates.');
}

if (require.main === module) {
  if (process.argv.length > 3) {
    console.error('FAIL usage: node check-runtime.cjs [built-api-root]');
    process.exitCode = 1;
  } else {
    const result = checkRuntime({ apiRoot: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
    printResult(result);
    process.exitCode = result.ok ? 0 : 1;
  }
}

module.exports = { checkRuntime, printResult };
