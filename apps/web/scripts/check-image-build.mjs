import { createRequire } from 'node:module';
import axios from 'axios';

// The existing browser wrappers already include /v1. An image with that
// prefix in VITE_API_URL would silently call /v1/v1/auth/me after deployment.
// Exercise the installed HTTP client's URL construction, not a lookalike.
try {
  const value = process.env.VITE_API_URL;
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    axios.create({ baseURL: value }).getUri({ url: '/v1/auth/me' }) !== `${url.origin}/v1/auth/me`
  ) {
    throw new Error('Invalid API origin');
  }
  console.log('PASS web image API origin and actual Axios request path');
} catch {
  console.error(
    'WEB_IMAGE_API_ORIGIN_REQUIRED: use the API origin without a version path, credentials, query or fragment',
  );
  process.exitCode = 1;
}

// K03: every public bundle/CSP input must be explicit and valid before Vite
// runs; an omitted flag must not silently compile a different product.
if (!process.exitCode) {
  const require = createRequire(import.meta.url);
  const {
    publicWebConfig,
    configFingerprint,
  } = require('../../../scripts/production/security-app/web-build-identity.cjs');
  try {
    const config = publicWebConfig(process.env);
    console.log(
      `PASS web image public configuration ${configFingerprint(config)} stripeSandbox=${config.stripeSandbox}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
