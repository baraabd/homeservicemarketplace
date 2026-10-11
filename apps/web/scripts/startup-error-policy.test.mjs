import assert from 'node:assert/strict';
import test from 'node:test';
import { createStartupErrorPolicy, validateExpectedHttpErrors } from './startup-error-policy.mjs';

const url = 'http://127.0.0.1:4010/v1/auth/me';
const rules = () => validateExpectedHttpErrors([{ url, method: 'GET', status: 401, maxCount: 1 }]);
const resourceError =
  'Failed to load resource: the server responded with a status of 401 (Unauthorized)';

test('an expected resource console message needs its exact real HTTP response', () => {
  const policy = createStartupErrorPolicy(rules());
  policy.consoleError({ url, text: resourceError });
  assert.equal(policy.read().unexpectedConsoleErrors, 1);
  policy.response({ url, method: 'GET', status: 401 });
  assert.equal(policy.read().unexpectedConsoleErrors, 0);
  assert.equal(policy.read().expectedHttpErrors[0].responses, 1);
  assert.deepEqual(policy.read().unexpectedHttpErrorsByStatus, {});
});

test('other URLs, methods, statuses and excess counts cannot use the anonymous exception', () => {
  const policy = createStartupErrorPolicy(rules());
  policy.response({ url, method: 'GET', status: 401 });
  policy.response({ url, method: 'GET', status: 401 });
  policy.response({ url: `${url}/other`, method: 'GET', status: 401 });
  policy.response({ url, method: 'POST', status: 401 });
  policy.response({ url, method: 'GET', status: 500 });
  assert.deepEqual(policy.read().unexpectedHttpErrorsByStatus, { 401: 3, 500: 1 });
  policy.consoleError({ url, text: resourceError });
  policy.consoleError({ url, text: resourceError });
  policy.consoleError({ url, text: 'An application error happened: 401' });
  policy.consoleError({ url: `${url}/other`, text: resourceError });
  assert.equal(policy.read().unexpectedConsoleErrors, 3);
});

test('protected routes have no exception and reports retain no raw URL or message', () => {
  const policy = createStartupErrorPolicy([]);
  policy.response({ url, method: 'GET', status: 401 });
  policy.consoleError({ url, text: resourceError });
  const report = policy.read();
  assert.deepEqual(report.unexpectedHttpErrorsByStatus, { 401: 1 });
  assert.equal(report.unexpectedConsoleErrors, 1);
  assert.ok(!JSON.stringify(report).includes(url));
  assert.ok(!JSON.stringify(report).includes(resourceError));
});

test('rules reject broad or secret-bearing inputs, 5xx, duplicate and unbounded exceptions', () => {
  for (const change of [
    { url: 'http://user:secret@127.0.0.1/v1/auth/me' },
    { url: `${url}?token=private` },
    { url: `${url}#fragment` },
    { status: 500 },
    { status: 200 },
    { maxCount: 0 },
    { maxCount: 99 },
    { method: '*' },
  ]) {
    assert.throws(() => validateExpectedHttpErrors([{ url, status: 401, ...change }]));
  }
  assert.throws(() => validateExpectedHttpErrors([...rules(), ...rules()]));
});
