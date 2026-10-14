'use strict';
// R20 — redacted storage-root diagnosis for THIS process's configuration.
//
//   node scripts/production/storage/storage-doctor.cjs [--api-dist apps/api/dist]
//
// Run it with the exact environment of each API replica and worker. Processes
// that print the same rootId per namespace share storage; a different or null
// rootId is a configuration fault to fix by configuration. It never searches
// other directories, never creates markers and never changes bucket access.
//
// Prints JSON with namespace, driver, root source or bucket fingerprint, marker
// state, rootId and a fault class. No bucket name, endpoint, credential, key or
// path. Exit 0 healthy, 3 when any namespace is not verified, 2 on usage error.

const path = require('node:path');

function parse(argv) {
  const out = { apiDist: path.resolve(__dirname, '../../../apps/api/dist') };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--api-dist') out.apiDist = path.resolve(argv[i + 1]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return out;
}

/** The env keys the adapters read, with the schema's boolean coercion. */
function envConfig(env) {
  return {
    get(key) {
      const v = env[key];
      if (key === 'S3_FORCE_PATH_STYLE') return v === 'true' || v === '1';
      return v === '' ? undefined : v;
    },
  };
}

async function main() {
  let args;
  try {
    args = parse(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
  const { diagnoseStorage } = require(
    path.join(args.apiDist, 'infrastructure/storage/storage-doctor.js'),
  );
  const report = await diagnoseStorage(envConfig(process.env));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.healthy ? 0 : 3;
}

module.exports = { envConfig };

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // Name only: an SDK message can carry the endpoint or bucket.
      process.stderr.write(`storage-doctor failed: ${err && err.name ? err.name : 'Error'}\n`);
      process.exit(1);
    },
  );
}
