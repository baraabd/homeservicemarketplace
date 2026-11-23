#!/usr/bin/env node
'use strict';

const path = require('node:path');

/**
 * Read-only validation of the SAME built API that will serve traffic.
 * `release: true` (the staging launcher's api-preflight) applies the stricter
 * release policy; ordinary boot (start-api.cjs) keeps the deployment policy so
 * documented incident switches remain usable. A build without the release
 * policy fails a release preflight closed.
 */
function checkRuntime({
  apiRoot = path.resolve(__dirname, '../../apps/api'),
  env = process.env,
  release = false,
} = {}) {
  try {
    const configDir = path.join(apiRoot, 'dist/config');
    const { validateEnv } = require(path.join(configDir, 'env.validation.js'));
    const policy = require(path.join(configDir, 'runtime-policy.js'));
    const check = release ? policy.releaseReadinessProblems : policy.deploymentReadinessProblems;
    if (typeof check !== 'function') throw new Error('policy unavailable');
    const problems = check(validateEnv(env));
    if (!Array.isArray(problems) || problems.some((value) => typeof value !== 'string')) {
      throw new Error('invalid policy result');
    }
    return { ok: problems.length === 0, problems };
  } catch {
    // Validation/load errors can contain secret values. Never echo the error.
    return {
      ok: false,
      problems: [
        'runtime preflight: build the API and validate the injected deployment configuration',
      ],
    };
  }
}

function printResult(result, output = console) {
  if (!result.ok) {
    for (const problem of result.problems) output.error(`FAIL ${problem}`);
    return;
  }
  output.log('PASS production runtime configuration preflight');
  output.log(
    'Live mail, storage, database, scanner and browser acceptance remain separate release gates.',
  );
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const release = args.at(-1) === '--release';
  const positional = release ? args.slice(0, -1) : args;
  if (positional.length > 1 || positional.some((value) => value.startsWith('--'))) {
    console.error('FAIL usage: node check-runtime.cjs [built-api-root] [--release]');
    process.exitCode = 1;
  } else {
    const result = checkRuntime({
      apiRoot: positional[0] ? path.resolve(positional[0]) : undefined,
      release,
    });
    printResult(result);
    process.exitCode = result.ok ? 0 : 1;
  }
}

module.exports = { checkRuntime, printResult };
