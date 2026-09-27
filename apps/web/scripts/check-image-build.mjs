import axios from 'axios';

// The existing browser wrappers already include /v1. An image with that
// prefix in VITE_API_URL would silently call /v1/v1/auth/me after deployment.
// Exercise the installed HTTP client's URL construction, not a lookalike.
try {
  const value = process.env.VITE_API_URL;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value ||
      axios.create({ baseURL: value }).getUri({ url: '/v1/auth/me' }) !== `${url.origin}/v1/auth/me`) {
    throw new Error('Invalid API origin');
  }
  console.log('PASS web image API origin and actual Axios request path');
} catch {
  console.error('WEB_IMAGE_API_ORIGIN_REQUIRED: use the API origin without a version path, credentials, query or fragment');
  process.exitCode = 1;
}
