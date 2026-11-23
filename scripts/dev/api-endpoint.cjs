'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseEnv } = require('node:util');

const API_ENV_PATHS = ['apps/api/.env.local', 'apps/api/.env', '.env.local', '.env'];

/** Match Nest's file precedence, then the process override. Never export private values. */
async function apiPort(root, environment = process.env) {
  const values = {};
  for (const file of [...API_ENV_PATHS].reverse()) {
    try {
      Object.assign(values, parseEnv(await fs.readFile(path.join(root, file), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('An API environment file is unreadable', { cause: error });
    }
  }
  const port = Number(environment.PORT ?? values.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('API PORT must be an integer between 1 and 65535');
  return port;
}

function apiOrigin(value) {
  let url;
  try {
    if (!/^https?:\/\//i.test(value)) throw new Error('absolute-origin-required');
    url = new URL(value);
  } catch {
    // Do not echo an invalid value: it can contain credentials or a token.
    throw new Error('VITE_API_URL must be an absolute http(s) API origin.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'VITE_API_URL must be an absolute http(s) API origin without credentials, a path (including /v1), query or fragment.',
    );
  }
  return url.origin;
}

/** Server-side Vite configuration only. The browser receives just the public origin. */
async function webApiEndpoint({
  root,
  webEnvironment = {},
  apiEnvironment = process.env,
  command,
  mode,
  isPreview = false,
}) {
  const configured = webEnvironment.VITE_API_URL?.trim();
  if (configured) return { origin: apiOrigin(configured), source: 'explicit' };
  if (command === 'build' && mode === 'production') {
    throw new Error(
      'Missing required env var VITE_API_URL for production build. Set it to the absolute backend API origin before building.',
    );
  }
  // Tests and preview must never read a developer's private backend env files
  // or rewrite the public API configuration already baked into an artifact.
  if (command !== 'serve' || isPreview || mode === 'test')
    return { origin: undefined, source: 'unset' };
  return {
    origin: `http://localhost:${await apiPort(root, apiEnvironment)}`,
    source: 'local-api-port',
  };
}

module.exports = { API_ENV_PATHS, apiPort, apiOrigin, webApiEndpoint };
