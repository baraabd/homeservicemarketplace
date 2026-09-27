'use strict';

function disposableSmokeContext(environment = process.env) {
  return environment.CI === 'true' && environment.GITHUB_ACTIONS === 'true'
    && environment.RUNNER_ENVIRONMENT === 'github-hosted';
}
module.exports = { disposableSmokeContext };
if (require.main === module) {
  if (!disposableSmokeContext()) {
    console.error('BLOCKED: Compose smoke deletes disposable test containers and volumes. Normal local and self-hosted execution is refused. Use pnpm docker:up and pnpm dev for persistent local data; do not spoof CI variables.');
    process.exitCode = 1;
  } else {
    console.log('PASS disposable GitHub-hosted CI context; never use this smoke script for a persistent environment.');
  }
}
