import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

const CWD = process.cwd();
const APP_ROOT = CWD.endsWith(path.join('apps', 'web'))
  ? CWD
  : path.resolve(CWD, 'apps/web');
const CONTRACTS_SOURCE = path.resolve(APP_ROOT, '../../packages/contracts/src/index.ts');

let server: ViteDevServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('browser contracts resolution', () => {
  it('resolves the shared contracts package to TypeScript source, never CommonJS dist', async () => {
    server = await createServer({
      root: APP_ROOT,
      configFile: path.join(APP_ROOT, 'vite.config.ts'),
      server: { middlewareMode: true },
    });

    const importer = path.join(APP_ROOT, 'src/main.tsx');
    const resolved = await server.pluginContainer.resolveId(
      '@homeservicemarketplace/contracts',
      importer,
    );

    expect(resolved?.id && path.normalize(resolved.id)).toBe(path.normalize(CONTRACTS_SOURCE));
    expect(resolved?.id).not.toContain('/packages/contracts/dist/');
    expect(resolved?.id).not.toContain('\\packages\\contracts\\dist\\');
  });

  it('seeds cold-start dependencies without scanning the app or disabling runtime discovery', async () => {
    server = await createServer({
      root: APP_ROOT,
      configFile: path.join(APP_ROOT, 'vite.config.ts'),
      server: { middlewareMode: true },
    });

    const optimizer = server.config.optimizeDeps;
    expect(optimizer.entries).toEqual([]);
    expect(optimizer.noDiscovery).toBe(false);
    // Plugin-contributed seeds may overlap; membership is the runtime contract.
    expect(optimizer.include).toEqual(
      expect.arrayContaining([
        'react',
        'react-dom/client',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        'react-router',
        '@tanstack/react-query',
        'axios',
        'lucide-react',
        'motion/react',
        'recharts',
        'leaflet',
        'pdfjs-dist',
      ]),
    );
    expect(optimizer.include).not.toContain('@homeservicemarketplace/contracts');
    expect(optimizer.exclude).toContain('@homeservicemarketplace/contracts');
    // Regular dev must be able to reuse a successful optimizer result.
    expect(optimizer.force).not.toBe(true);
  });
});
