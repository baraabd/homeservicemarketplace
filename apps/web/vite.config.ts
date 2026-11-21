import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import { createRequire } from 'node:module';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { csrfCookieName } from './src/lib/auth-cookie-names';
import { buildWebCsp, injectWebCsp } from '../../scripts/production/security-app/web-csp.cjs';
// Keep filesystem-backed development configuration in Node; Vite's bundled
// ESM config must not inline this CommonJS helper's require calls.
const { webApiEndpoint } = createRequire(import.meta.url)('../../scripts/dev/api-endpoint.cjs');

// The browser API origin is baked into production artifacts and must be
// explicit there. Local development may follow the backend's configured PORT.
export default defineConfig(async ({ mode, command, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const endpoint = await webApiEndpoint({
    root: path.resolve(__dirname, '../..'),
    webEnvironment: env,
    apiEnvironment: process.env,
    command,
    mode,
    isPreview,
  });
  // Fail the build on an invalid namespace, before it can break every mutation.
  csrfCookieName(env.VITE_AUTH_COOKIE_PREFIX);

  const documentPolicy = command === 'build' ? buildWebCsp(env) : null;

  return {
    // Derive only a missing development origin from the same PORT contract as
    // Nest. An explicit VITE_API_URL always wins; production still requires it.
    ...(command === 'serve' && !isPreview && mode !== 'test' && endpoint.origin
      ? { define: { 'import.meta.env.VITE_API_URL': JSON.stringify(endpoint.origin) } }
      : {}),
    plugins: [
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
      ...(documentPolicy
        ? [
            {
              name: 'r26-enforced-document-csp',
              transformIndexHtml: {
                order: 'post' as const,
                handler: (html: string) => injectWebCsp(html, documentPolicy),
              },
            },
          ]
        : []),
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
    // Seed the dependencies observed by the real cold-start scanner directly.
    // Scanning index.html walked the entire eagerly imported app before React
    // could be served (36.262s in the supplied Windows trace). An empty entries
    // list removes that up-front source scan, NOT dependency optimization.
    // Runtime discovery remains enabled for future/new imports not listed here.
    optimizeDeps: {
      entries: [],
      noDiscovery: false,
      include: [
        '@radix-ui/react-alert-dialog',
        '@radix-ui/react-dialog',
        '@radix-ui/react-label',
        '@radix-ui/react-progress',
        '@radix-ui/react-slot',
        '@radix-ui/react-tabs',
        '@tanstack/react-query',
        'axios',
        'class-variance-authority',
        'clsx',
        'leaflet',
        'lucide-react',
        'motion/react',
        'next-themes',
        'pdfjs-dist',
        'react',
        'react-dom/client',
        'react-leaflet',
        'react-router',
        'react-router/dom',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        'recharts',
        'socket.io-client',
        'sonner',
        'tailwind-merge',
      ],
      // Preserve the browser ESM source boundary; never optimize the CJS barrel.
      exclude: ['@homeservicemarketplace/contracts'],
    },
    assetsInclude: ['**/*.svg', '**/*.csv'],
  };
});
