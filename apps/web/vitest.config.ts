import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// vite.config.ts is a callback form (defineConfig(({ mode, command }) => …))
// so we must invoke it with a vitest-appropriate `command`/`mode` context
// before mergeConfig — otherwise it raises "Cannot merge config in form of
// callback". We use `serve`/`test` so the production-env validator in
// vite.config sees this invocation as a non-production call and skips the
// VITE_API_URL requirement (tests use axios-mock-adapter; no real URL
// needed).
const resolvedViteConfig =
  typeof viteConfig === 'function'
    ? viteConfig({ command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false })
    : viteConfig;

export default mergeConfig(
  resolvedViteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'happy-dom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }),
);
