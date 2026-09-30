'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const base = 'c9c92621d1bd66e0f524f3fc2f9655f8360d6a51';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD^'], { encoding: 'utf8' }).trim(), base);
assert.equal(process.versions.node, '24.21.0');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const api = JSON.parse(fs.readFileSync('apps/api/package.json', 'utf8'));
const replacements = [
  ['multer@<2.3.0', '^2.3.0', 'multer@<2.4.0', '2.4.0'],
  ['brace-expansion@>=1.0.0 <1.1.18', '1.1.18', 'brace-expansion@>=1.0.0 <1.1.21', '1.1.21'],
  ['brace-expansion@>=5.0.0 <5.0.9', '5.0.9', 'brace-expansion@>=5.0.0 <5.0.12', '5.0.12'],
  ['fast-uri@>=3.0.0 <3.1.6', '3.1.6', 'fast-uri@>=3.0.0 <3.1.8', '3.1.8'],
  ['undici@>=7.0.0 <7.29.0', '7.29.0', 'undici@>=7.0.0 <7.29.1', '7.29.1'],
];
const override = pkg.pnpm.overrides;
for (const [oldKey, oldVersion, newKey, version] of replacements) {
  assert.equal(override[oldKey], oldVersion);
  delete override[oldKey]; override[newKey] = version;
}
assert.equal(api.dependencies.nodemailer, '^9.1.1');
api.dependencies.nodemailer = '10.0.9';
assert.equal(override['engine.io@>=6.6.0 <6.6.10'], undefined);
override['engine.io@>=6.6.0 <6.6.10'] = '6.6.10';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync('apps/api/package.json', JSON.stringify(api, null, 2) + '\n');
console.log('Prepared seven targeted version floors; no security exceptions or unrelated direct dependencies changed.');
