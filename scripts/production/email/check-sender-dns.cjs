#!/usr/bin/env node
'use strict';
// R21 — read-only sender-domain DNS check (SPF, DMARC, optional DKIM).
//
//   node scripts/production/email/check-sender-dns.cjs <domain> [--dkim-selector <s>]
//
// Only queries DNS. A record being present is NOT delivery acceptance; an
// independent inbox must still show spf/dkim/dmarc=pass on a real message.
// Exit codes: 0 all checked records look valid, 1 a record is missing or
// malformed, 2 usage error.

const dns = require('node:dns').promises;

function parseArgs(argv) {
  const args = { domain: null, selector: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dkim-selector') args.selector = argv[++i] ?? null;
    else if (!args.domain) args.domain = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!args.domain || !/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(args.domain)) {
    throw new Error('usage: check-sender-dns.cjs <domain> [--dkim-selector <selector>]');
  }
  if (args.selector !== null && !/^[A-Za-z0-9._-]+$/.test(args.selector)) {
    throw new Error('invalid DKIM selector');
  }
  return args;
}

/** Pure evaluation of TXT answers (arrays of chunk arrays). */
function evaluate({ spf, dmarc, dkim }) {
  const findings = [];
  const join = (records) => records.map((chunks) => chunks.join(''));

  const spfRecords = join(spf).filter((r) => /^v=spf1(\s|$)/i.test(r));
  if (spfRecords.length === 0)
    findings.push({ record: 'SPF', ok: false, detail: 'no v=spf1 record' });
  else if (spfRecords.length > 1)
    findings.push({ record: 'SPF', ok: false, detail: 'multiple v=spf1 records (permerror)' });
  else if (!/[-~]all\b/i.test(spfRecords[0]))
    findings.push({ record: 'SPF', ok: false, detail: 'no -all/~all terminator' });
  else findings.push({ record: 'SPF', ok: true, detail: spfRecords[0] });

  const dmarcRecords = join(dmarc).filter((r) => /^v=DMARC1\s*;/i.test(r));
  if (dmarcRecords.length !== 1) {
    findings.push({
      record: 'DMARC',
      ok: false,
      detail: dmarcRecords.length === 0 ? 'no v=DMARC1 record' : 'multiple DMARC records',
    });
  } else {
    const policy = /(?:^|;)\s*p=(none|quarantine|reject)\s*(?:;|$)/i.exec(dmarcRecords[0])?.[1];
    findings.push(
      policy
        ? { record: 'DMARC', ok: true, detail: `p=${policy.toLowerCase()}` }
        : { record: 'DMARC', ok: false, detail: 'missing or invalid p= tag' },
    );
  }

  if (dkim !== undefined) {
    const dkimRecords = join(dkim).filter((r) => /(^|;)\s*p=[A-Za-z0-9+/=]{100,}/.test(r));
    findings.push(
      dkimRecords.length > 0
        ? { record: 'DKIM', ok: true, detail: 'public key present' }
        : { record: 'DKIM', ok: false, detail: 'no DKIM public key (p=) at selector' },
    );
  }
  return findings;
}

async function txt(name) {
  try {
    return await dns.resolveTxt(name);
  } catch (err) {
    if (err && (err.code === 'ENODATA' || err.code === 'ENOTFOUND')) return [];
    throw err;
  }
}

async function main(argv) {
  const { domain, selector } = parseArgs(argv);
  const answers = {
    spf: await txt(domain),
    dmarc: await txt(`_dmarc.${domain}`),
    ...(selector ? { dkim: await txt(`${selector}._domainkey.${domain}`) } : {}),
  };
  const findings = evaluate(answers);
  for (const f of findings) console.log(`${f.ok ? 'PASS' : 'FAIL'} ${f.record}: ${f.detail}`);
  if (!selector) console.log('SKIP DKIM: pass --dkim-selector to check a selector');
  return findings.every((f) => f.ok) ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    },
  );
}

module.exports = { evaluate, parseArgs };
