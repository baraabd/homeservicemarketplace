'use strict';

// R23 — alert quality gate, applied to the rules AS PROMETHEUS LOADED THEM
// (GET /api/v1/rules), not to a hand-parsed copy of the YAML.
//
// Every alert must say who owns it, how bad it is, where its runbook is, what
// to check first, who to escalate to and when it recovers. A page must wait
// at least two minutes (or be a burn-rate rule with its own windows) so one
// bad scrape cannot wake anyone.

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_LABELS = ['severity', 'owner', 'service'];
const REQUIRED_ANNOTATIONS = ['summary', 'runbook_url', 'first_checks', 'escalation', 'recovery'];
const SEVERITIES = new Set(['page', 'ticket']);
const MIN_PAGE_FOR_SECONDS = 120;

function anchorsOf(markdown) {
  // GitHub-style anchors for "## Heading" lines: lower-case, spaces to '-',
  // punctuation removed.
  const anchors = new Set();
  for (const line of markdown.split('\n')) {
    const m = /^#{2,4}\s+(.+?)\s*$/u.exec(line);
    if (!m) continue;
    anchors.add(
      m[1]
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/gu, '-'),
    );
  }
  return anchors;
}

function checkAlertQuality(rulesResponse, repoRoot) {
  const problems = [];
  const alerts = [];
  for (const group of rulesResponse.data.groups) {
    for (const rule of group.rules) {
      if (rule.type !== 'alerting') continue;
      alerts.push(rule.name);
      const where = `${group.name}/${rule.name}`;
      for (const l of REQUIRED_LABELS) {
        if (!rule.labels?.[l]) problems.push(`${where}: missing label ${l}`);
      }
      for (const a of REQUIRED_ANNOTATIONS) {
        if (!rule.annotations?.[a]) problems.push(`${where}: missing annotation ${a}`);
      }
      const severity = rule.labels?.severity;
      if (severity && !SEVERITIES.has(severity))
        problems.push(`${where}: unknown severity ${severity}`);
      if (severity === 'page' && (rule.duration ?? 0) < MIN_PAGE_FOR_SECONDS) {
        problems.push(
          `${where}: page alerts need for >= ${MIN_PAGE_FOR_SECONDS}s (got ${rule.duration})`,
        );
      }
      if (/\babsent\s*\(/u.test(rule.query) && rule.labels?.instrumentation === 'pending') {
        problems.push(`${where}: pending-instrumentation rules must not use absent()`);
      }
      const url = rule.annotations?.runbook_url;
      if (url) {
        const [file, anchor] = url.split('#');
        const abs = path.join(repoRoot, file);
        if (!fs.existsSync(abs)) {
          problems.push(`${where}: runbook ${file} does not exist`);
        } else if (!anchor || !anchorsOf(fs.readFileSync(abs, 'utf8')).has(anchor)) {
          problems.push(`${where}: runbook anchor #${anchor} not found in ${file}`);
        }
      }
    }
  }
  return { alerts, problems };
}

module.exports = { checkAlertQuality, anchorsOf };
