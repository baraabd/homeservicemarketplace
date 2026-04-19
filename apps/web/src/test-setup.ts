// Wire @testing-library/jest-dom matchers onto Vitest's `expect`.
// The `@testing-library/jest-dom/vitest` entry imports `vitest` directly,
// which isn't always visible through pnpm peer symlinks in this repo.
// Using the underlying `matchers` subpath + `expect.extend` is the
// documented vitest-agnostic way and avoids that resolution edge case.
import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);
