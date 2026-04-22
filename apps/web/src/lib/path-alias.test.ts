import { describe, it, expect } from 'vitest';
// Import the api helper through the `@/` path alias. If the tsconfig `paths`
// entry (which now has no accompanying `baseUrl`) is still wired correctly,
// this import will resolve the same way Vite resolves it at runtime. A
// regression in paths resolution would break this file first.
import { api as apiAliased } from '@/lib/api';
import { api as apiRelative } from './api';

describe('path alias @/* resolves without baseUrl', () => {
  it('points at the same axios instance via @/lib/api and ./api', () => {
    // Identity check — the same module must be returned through both paths.
    // If baseUrl removal broke the alias, the alias path would fail to
    // resolve at import time and this test file would not even compile.
    expect(apiAliased).toBe(apiRelative);
  });
});
