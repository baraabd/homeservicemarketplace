#!/usr/bin/env node
'use strict';

// R23 — local TEST receiver, never a production pager. Notifications stay in
// bounded memory and are fetched by the test runner; network input is never
// written to a host file by this service. The default bind stays loopback;
// Compose explicitly selects 0.0.0.0 inside its project bridge network.
// Usage: node test-receiver.cjs <port> [bind-address]

const http = require('node:http');

const port = Number(process.argv[2] ?? 19095);
const bindAddress = process.argv[3] ?? '127.0.0.1';
if (
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535 ||
  !['127.0.0.1', '0.0.0.0'].includes(bindAddress)
) {
  console.error('usage: test-receiver.cjs <port 1024-65535> [127.0.0.1|0.0.0.0]');
  process.exit(2);
}

const MAX_BODY = 1024 * 1024;
const MAX_NOTIFICATIONS = 256;
const notifications = [];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const status = (value) => value === 'firing' || value === 'resolved';
const text = (value, limit) =>
  typeof value === 'string' && value.length <= limit ? value : undefined;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/notifications') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(notifications));
    return;
  }
  const receiver =
    req.url === '/alerts/page' ? 'test-page' : req.url === '/alerts/ticket' ? 'test-ticket' : null;
  if (req.method !== 'POST' || !receiver) {
    res.writeHead(404).end();
    return;
  }
  let size = 0;
  let rejected = false;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      if (!rejected) res.writeHead(413).end();
      rejected = true;
      chunks.length = 0;
      return;
    }
    if (!rejected) chunks.push(chunk);
  });
  req.on('end', () => {
    if (rejected) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (
      !isObject(body) ||
      !status(body.status) ||
      body.receiver !== receiver ||
      !Array.isArray(body.alerts) ||
      body.alerts.length > 20 ||
      !body.alerts.every(
        (a) =>
          isObject(a) &&
          status(a.status) &&
          isObject(a.labels) &&
          typeof a.labels.alertname === 'string' &&
          /^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(a.labels.alertname),
      )
    ) {
      res.writeHead(400).end();
      return;
    }
    if (notifications.length >= MAX_NOTIFICATIONS) {
      res.writeHead(503).end();
      return;
    }
    notifications.push({
      receivedAt: new Date().toISOString(),
      path: receiver === 'test-page' ? '/alerts/page' : '/alerts/ticket',
      receiver,
      status: body.status,
      alerts: body.alerts.map((a) => ({
        status: a.status,
        labels: {
          alertname: a.labels.alertname,
          severity:
            a.labels.severity === 'page'
              ? 'page'
              : a.labels.severity === 'ticket'
                ? 'ticket'
                : undefined,
        },
        startsAt: text(a.startsAt, 64),
        endsAt: text(a.endsAt, 64),
        annotations: { runbook_url: text(a.annotations?.runbook_url, 512) },
      })),
    });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
});
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.listen(port, bindAddress, () => {
  process.stdout.write(`test-receiver listening on ${bindAddress}:${port}\n`);
});
