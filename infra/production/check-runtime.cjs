#!/usr/bin/env node
'use strict';

// Run only against a built API with deployment variables injected by the secret
// manager. No dotenv loading, network calls, credentials in output or mutations.
const path = require('node:path');
try {
  const configDir = path.resolve(__dirname, '../../apps/api/dist/config');
  const { validateEnv } = require(path.join(configDir, 'env.validation.js'));
  const { deploymentReadinessProblems } = require(path.join(configDir, 'runtime-policy.js'));
  const problems = deploymentReadinessProblems(validateEnv(process.env));
  if (problems.length) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('PASS production runtime configuration preflight');
    console.log('Live mail, storage, database, scanner and browser acceptance remain separate release gates.');
  }
} catch {
  // Even third-party validation/load errors can contain environment values.
  console.error('FAIL runtime preflight: build the API and validate the injected deployment configuration');
  process.exitCode = 1;
}
