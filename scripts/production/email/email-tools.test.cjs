'use strict';
// R21 — operator email tooling. Run with:
//   node --test scripts/production/email/email-tools.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluate, parseArgs: dnsArgs } = require('./check-sender-dns.cjs');
const { parseArgs, transportOptions, mask } = require('./send-acceptance-probe.cjs');

const key = 'A'.repeat(200);
const txt = (s) => [[s]];

test('DNS: valid SPF, DMARC and DKIM pass', () => {
  const f = evaluate({
    spf: txt('v=spf1 include:_spf.provider.example -all'),
    dmarc: txt('v=DMARC1; p=none; rua=mailto:r@example.test'),
    dkim: [['v=DKIM1; k=rsa; ', `p=${key}`]],
  });
  assert.deepEqual(
    f.map((x) => x.ok),
    [true, true, true],
  );
});

test('DNS: missing, duplicated or malformed records fail', () => {
  assert.equal(
    evaluate({ spf: [], dmarc: [] }).every((x) => !x.ok),
    true,
  );
  const dup = evaluate({
    spf: [...txt('v=spf1 -all'), ...txt('v=spf1 ~all')],
    dmarc: txt('v=DMARC1; p=reject'),
  });
  assert.match(dup[0].detail, /multiple/);
  assert.equal(
    evaluate({ spf: txt('v=spf1 include:x'), dmarc: txt('v=DMARC1; p=reject') })[0].ok,
    false,
  );
  assert.equal(
    evaluate({ spf: txt('v=spf1 -all'), dmarc: txt('v=DMARC1; rua=mailto:x') })[1].ok,
    false,
  );
  assert.equal(
    evaluate({
      spf: txt('v=spf1 -all'),
      dmarc: txt('v=DMARC1; p=none'),
      dkim: txt('v=DKIM1; p='),
    })[2].ok,
    false,
  );
});

test('DNS: argument validation', () => {
  assert.deepEqual(dnsArgs(['mail.example.test', '--dkim-selector', 's1']), {
    domain: 'mail.example.test',
    selector: 's1',
  });
  assert.throws(() => dnsArgs([]));
  assert.throws(() => dnsArgs(['bad domain']));
  assert.throws(() => dnsArgs(['example.test', '--dkim-selector', 'a;b']));
});

test('probe: refuses without an explicitly authorized inbox', () => {
  assert.throws(() => parseArgs(['--to', 'qa@example.test']), /confirm-authorized-inbox/);
  assert.throws(() => parseArgs(['--confirm-authorized-inbox']), /--to/);
  assert.equal(
    parseArgs(['--to', 'qa@example.test', '--confirm-authorized-inbox']).to,
    'qa@example.test',
  );
});

const base = {
  SMTP_HOST: 'smtp.provider.example',
  SMTP_PORT: '587',
  SMTP_FROM: 'Marketplace <no-reply@mail.example.test>',
};
const args = { allowPlaintextLoopback: false };

test('probe: remote relays always require verified TLS', () => {
  const o = transportOptions(base, args);
  assert.equal(o.requireTLS, true);
  assert.equal(o.tls.rejectUnauthorized, true);
  const implicit = transportOptions({ ...base, SMTP_SECURE: 'true', SMTP_PORT: '465' }, args);
  assert.equal(implicit.secure, true);
  // The loopback escape hatch does not apply to remote hosts.
  assert.equal(transportOptions(base, { allowPlaintextLoopback: true }).requireTLS, true);
});

test('probe: plaintext only for an explicitly allowed loopback rehearsal', () => {
  const local = { ...base, SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025' };
  assert.equal(transportOptions(local, args).requireTLS, true);
  assert.equal(transportOptions(local, { allowPlaintextLoopback: true }).requireTLS, false);
});

test('probe: configuration errors name the variable but never echo values', () => {
  const secret = 'super-secret-password-value';
  for (const env of [
    { ...base, SMTP_HOST: '' },
    { ...base, SMTP_FROM: 'noreply@x.local' },
    { ...base, SMTP_PASS: secret },
    { ...base, SMTP_PORT: '99999' },
  ]) {
    assert.throws(
      () => transportOptions(env, args),
      (err) => !String(err.message).includes(secret),
    );
  }
});

test('probe: recipient is masked in output', () => {
  assert.equal(mask('qa.inbox@example.test'), 'q***@example.test');
});
