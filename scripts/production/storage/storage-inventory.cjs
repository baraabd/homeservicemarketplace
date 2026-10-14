'use strict';
// R20 — object inventory and restore verification for R36.
//
//   node scripts/production/storage/storage-inventory.cjs inventory \
//     --namespace restricted --bucket-env S3_RESTRICTED_BUCKET --out FILE [--deep] [--prefix P]
//
//   node scripts/production/storage/storage-inventory.cjs verify-restore \
//     --inventory FILE --bucket-env RESTORED_BUCKET [--deep] [--out FILE]
//
// The bucket NAME is read from the named environment variable, never from the
// command line, so it does not land in shell history or CI logs. Credentials
// and endpoint come from the usual S3_* variables or the SDK provider chain.
//
// Output files are created exclusively (an existing file is refused) with mode
// 0600. They contain key fingerprints, version ids, sizes, ETags and digests —
// no keys, bucket names or bytes. Stdout carries only counts and correlation
// identifiers. Exit 0 ok, 4 restore mismatch, 2 usage, 1 failure.

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const NAMESPACES = ['public', 'portfolio-staging', 'restricted'];

function parse(argv) {
  const [command, ...rest] = argv;
  const out = {
    command,
    apiDist: path.resolve(__dirname, '../../../apps/api/dist'),
    deep: false,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--deep') {
      out.deep = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    i += 1;
    if (flag === '--namespace') out.namespace = value;
    else if (flag === '--bucket-env') out.bucketEnv = value;
    else if (flag === '--prefix') out.prefix = value;
    else if (flag === '--out') out.out = path.resolve(value);
    else if (flag === '--inventory') out.inventory = path.resolve(value);
    else if (flag === '--api-dist') out.apiDist = path.resolve(value);
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!['inventory', 'verify-restore'].includes(out.command)) throw new Error('unknown command');
  if (!out.bucketEnv || !/^[A-Z][A-Z0-9_]*$/.test(out.bucketEnv)) {
    throw new Error('--bucket-env must name an environment variable');
  }
  if (out.command === 'inventory') {
    if (!NAMESPACES.includes(out.namespace)) throw new Error('--namespace is required');
    if (!out.out) throw new Error('--out is required');
  }
  if (out.command === 'verify-restore' && !out.inventory)
    throw new Error('--inventory is required');
  return out;
}

function s3Client(apiDist, env) {
  const { S3Client } = createRequire(path.join(apiDist, 'main.js'))('@aws-sdk/client-s3');
  const endpoint = env.S3_ENDPOINT || undefined;
  return new S3Client({
    region: env.S3_REGION || 'us-east-1',
    ...(endpoint
      ? {
          endpoint,
          forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true' || env.S3_FORCE_PATH_STYLE === '1',
        }
      : {}),
    ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
}

function writeExclusive(file, value) {
  // 'wx': never overwrite an earlier inventory, which may be the only record
  // of what a bucket held before an incident.
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

async function run(args, env) {
  const bucket = env[args.bucketEnv];
  if (!bucket) throw Object.assign(new Error('bucket env var is empty'), { name: 'UsageError' });
  const mod = require(path.join(args.apiDist, 'infrastructure/storage/storage-inventory.js'));
  const client = s3Client(args.apiDist, env);
  try {
    if (args.command === 'inventory') {
      const inv = await mod.buildInventory(client, {
        bucket,
        namespace: args.namespace,
        prefix: args.prefix,
        deep: args.deep,
      });
      writeExclusive(args.out, inv);
      return {
        code: 0,
        summary: {
          schema: inv.schema,
          namespace: inv.namespace,
          bucketRef: inv.bucketRef,
          rootId: inv.rootId,
          versioning: inv.versioning,
          mode: inv.mode,
          correlationId: inv.correlationId,
          counts: inv.counts,
          manifestSha256: inv.manifestSha256,
        },
      };
    }
    const inventory = JSON.parse(fs.readFileSync(args.inventory, 'utf8'));
    const report = await mod.verifyRestore(client, { bucket, inventory, deep: args.deep });
    if (args.out) writeExclusive(args.out, report);
    return {
      code: report.ok ? 0 : 4,
      summary: {
        schema: report.schema,
        ok: report.ok,
        mode: report.mode,
        expectedLive: report.expectedLive,
        matched: report.matched,
        missing: report.missing.length,
        mismatched: report.mismatched.length,
        unexpected: report.unexpected,
        correlationId: report.correlationId,
        inventoryCorrelationId: report.inventoryCorrelationId,
      },
    };
  } finally {
    client.destroy();
  }
}

module.exports = { parse, run };

if (require.main === module) {
  let args;
  try {
    args = parse(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
  run(args, process.env).then(
    ({ code, summary }) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      process.exit(code);
    },
    (err) => {
      process.stderr.write(`storage-inventory failed: ${err && err.name ? err.name : 'Error'}\n`);
      process.exit(err && err.name === 'UsageError' ? 2 : 1);
    },
  );
}
