'use strict';

// TEST SUPPORT ONLY. Writes a directory shaped like `prisma generate` output
// (index.js stating its client/engine versions and native target, the engine
// file, the other required files) and, optionally, the completion record the
// guarded generator writes. No real engine is involved; the engine bytes are
// arbitrary. Used by the workspace-state, repair and generation tests.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  RECORD_FILE,
  RECORD_SCHEMA_VERSION,
  schemaFingerprint,
  libraryEngineFile,
} = require('./prisma-generation.cjs');

const ENGINE_VERSION = 'a'.repeat(40);

function nativeTargetFor(platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'darwin-arm64';
  return 'debian-openssl-3.0.x';
}

function clientIndex({ clientVersion, engineVersion, nativeTarget, prefix = '' }) {
  const engine = libraryEngineFile(nativeTarget);
  return `${prefix}const config = {
  "generator": {
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "${nativeTarget}",
        "native": true
      }
    ]
  },
  "clientVersion": "${clientVersion}",
  "engineVersion": "${engineVersion}",
  "engineType": "library"
}
path.join(__dirname, "${engine}");
`;
}

function writeGeneratedClient(
  output,
  schemaText,
  {
    clientVersion = '6.12.0',
    engineVersion = ENGINE_VERSION,
    engineBytes = 'fixture engine bytes',
    platform = process.platform,
    arch = process.arch,
    record = true,
    indexPrefix = '',
  } = {},
) {
  const nativeTarget = nativeTargetFor(platform);
  const engine = libraryEngineFile(nativeTarget);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'schema.prisma'), schemaText);
  fs.writeFileSync(
    path.join(output, 'index.js'),
    clientIndex({ clientVersion, engineVersion, nativeTarget, prefix: indexPrefix }),
  );
  fs.writeFileSync(path.join(output, 'default.js'), "module.exports = require('./index.js');\n");
  fs.writeFileSync(path.join(output, 'index.d.ts'), 'export declare class PrismaClient {}\n');
  fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ version: clientVersion }));
  fs.writeFileSync(path.join(output, engine), engineBytes);
  if (record) {
    fs.writeFileSync(
      path.join(output, RECORD_FILE),
      JSON.stringify({
        schemaVersion: RECORD_SCHEMA_VERSION,
        state: 'complete',
        schema: schemaFingerprint(schemaText),
        clientVersion,
        engineVersion,
        engineType: 'library',
        nativeTarget,
        nativeEngine: engine,
        engines: { [engine]: createHash('sha256').update(engineBytes).digest('hex') },
        platform,
        arch,
        completedAt: new Date(0).toISOString(),
      }),
    );
  }
  return { engine, nativeTarget };
}

module.exports = { ENGINE_VERSION, clientIndex, nativeTargetFor, writeGeneratedClient };
