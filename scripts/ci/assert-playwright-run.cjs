#!/usr/bin/env node
'use strict';

// R18 — fail closed on a Playwright JSON report.
//
// A green Playwright exit code proves only that nothing failed. It does not
// prove that the release-required tests ran: a `test.skip` on a missing
// environment variable, a renamed spec or an empty grep all exit 0. This reads
// the JSON reporter's output back and requires exactly the expected number of
// tests to have passed on the first attempt, with nothing skipped, flaky or
// interrupted. It then writes a small summary bound to the source SHA
// (SOURCE_SHA, else GITHUB_SHA; on a pull request pass the head SHA), holding
// counts only (no titles, URLs, cookies or personal data).
//
// Usage: assert-playwright-run.cjs <report.json> <expected> <label> <summary.json>

const fs = require('node:fs');

function summarize(report, expected, label, sha) {
  const problems = [];
  const stats = report && report.stats;
  if (!stats) {
    return { problems: ['the report has no stats block'], summary: null };
  }
  const passed = stats.expected ?? 0;
  const failed = stats.unexpected ?? 0;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;
  if (!Number.isInteger(expected) || expected < 1)
    problems.push('expected must be a positive integer');
  if (failed) problems.push(`${failed} failed`);
  if (flaky) problems.push(`${flaky} flaky (a retry is not a pass)`);
  if (skipped) problems.push(`${skipped} skipped (a skipped release test is a failure)`);
  if (passed !== expected) problems.push(`${passed} passed, expected exactly ${expected}`);
  if (Array.isArray(report.errors) && report.errors.length) {
    problems.push(`${report.errors.length} run-level error(s)`);
  }
  return {
    problems,
    summary: {
      label,
      sourceSha: sha || null,
      expected,
      passed,
      failed,
      flaky,
      skipped,
      accepted: problems.length === 0,
    },
  };
}

function main(argv) {
  const [reportPath, expectedRaw, label, summaryPath] = argv;
  if (!reportPath || !expectedRaw || !label || !summaryPath) {
    console.error(
      'usage: assert-playwright-run.cjs <report.json> <expected> <label> <summary.json>',
    );
    return 2;
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    console.error(
      `::error::${label}: no readable Playwright JSON report (${error.code || error.name})`,
    );
    return 1;
  }
  const { problems, summary } = summarize(
    report,
    Number(expectedRaw),
    label,
    process.env.SOURCE_SHA || process.env.GITHUB_SHA,
  );
  if (summary) fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`${label}: ${JSON.stringify(summary)}`);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${label}: ${p}`);
    return 1;
  }
  return 0;
}

module.exports = { summarize };

if (require.main === module) process.exit(main(process.argv.slice(2)));
