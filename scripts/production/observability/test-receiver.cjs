#!/usr/bin/env node
'use strict';

// R23 — authorized TEST receiver for Alertmanager webhooks.
//
// Appends one JSON line per notification to the given file, keeping only the
// fields the evidence needs (status, receiver path, alert names, labels,
// startsAt/endsAt). It is not a pager and contacts nobody.
//
// Usage: node test-receiver.cjs <port> <jsonl-file>

const http = require('node:http');
const fs = require('node:fs');

const port = Number(process.argv[2] ?? 19095);
const out = process.argv[3];
if (!Number.isInteger(port) || !out) {
  console.error('usage: test-receiver.cjs <port> <jsonl-file>');
  process.exit(2);
}

const MAX_BODY = 1024 * 1024;

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/alerts/')) {
    res.writeHead(404).end();
    return;
  }
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400).end();
      return;
    }
    const record = {
      receivedAt: new Date().toISOString(),
      path: req.url,
      receiver: body.receiver,
      status: body.status,
      groupKey: body.groupKey,
      alerts: (body.alerts ?? []).map((a) => ({
        status: a.status,
        labels: a.labels,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        annotations: {
          runbook_url: a.annotations?.runbook_url,
          summary: a.annotations?.summary,
        },
      })),
    };
    fs.appendFileSync(out, JSON.stringify(record) + '\n');
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
});

// Docker Desktop forwards host.docker.internal to host loopback.
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`test-receiver listening on 127.0.0.1:${port}\n`);
});
