import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

// `VITE_API_URL` is baked into the client bundle at build time. If it is
// missing during a production build, Vite silently replaces
// `import.meta.env.VITE_API_URL` with undefined; the axios fallback then
// points at http://localhost:4000 and every XHR dies in the user's
// browser with no server-side trace. Fail the build loudly instead — the
// Vercel deploy pipeline needs an actionable error, not a mystery outage.
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL?.trim();

  if (command === 'build' && mode === 'production' && !apiUrl) {
    throw new Error(
      'Missing required env var VITE_API_URL for production build. ' +
        'Set it in the Vercel project dashboard (or your CI env) to the ' +
        'absolute URL of the backend API — e.g. https://api.example.com. ' +
        'Without it the client bundle silently falls back to http://localhost:4000.',
    );
  }
  if (command === 'build' && apiUrl && !/^https?:\/\//i.test(apiUrl)) {
    throw new Error(
      `VITE_API_URL must be an absolute http(s) URL (got: "${apiUrl}"). ` +
        'A relative or scheme-less value bakes into the bundle as-is and ' +
        'produces unresolvable XHRs at runtime.',
    );
  }

  return {
    plugins: [
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // The shared contracts package is emitted as CommonJS for Nest, but
        // browser code must never execute that CommonJS barrel directly.
        // Resolve the web app to the TypeScript source barrel instead so Vite
        // handles it as native ESM in BOTH dev and production builds.
        '@homeservicemarketplace/contracts': path.resolve(
          __dirname,
          '../../packages/contracts/src/index.ts',
        ),
      },
    },
    // Do not prebundle the CommonJS package entry. The alias above is the
    // browser boundary and points at source ESM that Vite transforms directly.
    optimizeDeps: { exclude: ['@homeservicemarketplace/contracts'] },
    assetsInclude: ['**/*.svg', '**/*.csv'],
  };
});
