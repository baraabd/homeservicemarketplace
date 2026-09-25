import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
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
});
