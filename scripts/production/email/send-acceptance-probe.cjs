#!/usr/bin/env node
'use strict';
// R21 — send ONE acceptance probe through the configured SMTP sender to an
// AUTHORIZED, independent test inbox.
//
//   SMTP_HOST=… SMTP_PORT=… SMTP_SECURE=… SMTP_USER=… SMTP_PASS=… SMTP_FROM=… \
//   node scripts/production/email/send-acceptance-probe.cjs \
//     --to <authorized-test-inbox> --confirm-authorized-inbox
//
// Load the SMTP settings from the protected secret mechanism into the
// environment of this one process; never pass them as arguments (shell
// history) and never paste them into chat, PRs or artifacts. This script
// prints no credential, DSN or full recipient address.
//
// What a success proves: the provider ACCEPTED one message over TLS from this
// sender. It does NOT prove inbox placement or domain authentication. The
// operator must open the message in the independent inbox and record its
// Authentication-Results (spf/dkim/dmarc) as described in
// docs/production-readiness/r21/ACCEPTANCE.md.
//
// --allow-plaintext-loopback permits an unencrypted relay on 127.0.0.1/::1
// only (local Mailpit rehearsal of this script). Exit: 0 accepted, 1 refused
// or failed, 2 usage error.

const { createRequire } = require('node:module');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function parseArgs(argv) {
  const out = { to: null, confirmed: false, allowPlaintextLoopback: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') out.to = argv[++i] ?? null;
    else if (a === '--confirm-authorized-inbox') out.confirmed = true;
    else if (a === '--allow-plaintext-loopback') out.allowPlaintextLoopback = true;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!out.to || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(out.to))
    throw new Error('--to <address> is required');
  if (!out.confirmed)
    throw new Error(
      '--confirm-authorized-inbox is required: send only to an inbox you are authorized to use',
    );
  return out;
}

/** Validates the SMTP environment. Returns transport options or throws a
 *  message that names the variable but never echoes its value. */
function transportOptions(env, args) {
  const host = (env.SMTP_HOST ?? '').trim();
  if (!host) throw new Error('SMTP_HOST is not set');
  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT is invalid');
  const secure = ['1', 'true', 'yes', 'on'].includes(String(env.SMTP_SECURE ?? '').toLowerCase());
  const from = (env.SMTP_FROM ?? '').trim();
  if (!from || /\.local>?$/.test(from))
    throw new Error('SMTP_FROM must be the verified deployment sender');
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS))
    throw new Error('SMTP_USER and SMTP_PASS must be set together');
  const loopback = LOOPBACK.has(host);
  const plaintextAllowed = loopback && args.allowPlaintextLoopback;
  return {
    host,
    port,
    secure,
    requireTLS: !secure && !plaintextAllowed,
    tls: { rejectUnauthorized: !plaintextAllowed },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    from,
  };
}

function senderDomain(from) {
  return /@([A-Za-z0-9.-]+)>?\s*$/.exec(from)?.[1]?.toLowerCase() ?? 'localhost';
}

function mask(address) {
  const [local, domain] = address.split('@');
  return `${(local ?? '').slice(0, 1)}***@${domain ?? ''}`;
}

async function main(argv, env) {
  const args = parseArgs(argv);
  const { from, ...opts } = transportOptions(env, args);
  const apiRequire = createRequire(path.join(__dirname, '../../../apps/api/package.json'));
  const nodemailer = apiRequire('nodemailer');
  const probeId = `r21-probe-${randomUUID()}`;
  const messageId = `<${probeId}@${senderDomain(from)}>`;
  const transport = nodemailer.createTransport(opts);
  const info = await transport.sendMail({
    from,
    to: args.to,
    messageId,
    subject: `Delivery acceptance probe · اختبار قبول التسليم (${probeId.slice(-8)})`,
    headers: { 'X-HSM-Acceptance': 'r21' },
    text:
      'This is an operator-initiated delivery acceptance probe. No action is needed.\n\n----\n\n' +
      'هذه رسالة اختبار أرسلها المشغّل للتحقق من التسليم. لا يلزم أي إجراء.\n',
  });
  const code = /^(\d{3})\b/.exec(String(info.response ?? ''))?.[1] ?? 'unknown';
  console.log(`probe=${probeId}`);
  console.log(`message-id=${messageId}`);
  console.log(
    `recipient=${mask(args.to)} accepted=${info.accepted?.length ?? 0} rejected=${info.rejected?.length ?? 0}`,
  );
  console.log(
    `smtp-reply=${code} tls=${opts.secure ? 'implicit' : opts.requireTLS ? 'starttls-required' : 'plaintext-loopback'}`,
  );
  console.log(
    'NEXT: open the message in the independent inbox and record Authentication-Results (spf/dkim/dmarc).',
  );
  return (info.accepted?.length ?? 0) === 1 ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (err) => {
      // Driver errors can echo credentials or envelopes: report the class only.
      const e = err ?? {};
      const usage = e instanceof Error && !('code' in e) && !('responseCode' in e);
      console.error(
        usage
          ? e.message
          : `send failed: code=${e.code ?? 'unknown'} smtp=${e.responseCode ?? 'n/a'}`,
      );
      process.exit(usage ? 2 : 1);
    },
  );
}

module.exports = { parseArgs, transportOptions, senderDomain, mask };
