// Sprint 7 — does the REAL application's dependency graph resolve?
//
// This suite exists because a green test run shipped an application that could
// not boot. Every other e2e spec builds a MINIMAL testing module containing
// just the controller under test and hand-supplied fakes, so none of them ever
// asks Nest to wire the actual AppModule. `ProviderActiveGuard` gained a
// dependency that one of its two declaration sites could not resolve, and the
// first thing to notice was a CI Docker boot:
//
//     Nest can't resolve dependencies of the ProviderActiveGuard (?).
//     Please make sure that the argument ProviderCapabilityService at index
//     [0] is available in the ConversationsModule module.
//
// Unit tests cannot catch that class of bug by construction: they instantiate
// guards with `new`, which is exactly what bypasses the injector.
//
// `compile()` builds the full graph and instantiates every provider. It does
// NOT run lifecycle hooks — no `init()` — so nothing connects to Postgres,
// Redis, or SMTP. This is a pure wiring check and needs no infrastructure.

import { Test } from '@nestjs/testing';

jest.setTimeout(120_000);

// The env the ConfigModule zod-validates at construction. Placeholders only:
// no provider in this file opens a connection, and the values never leave it.
// Set BEFORE AppModule is required, because validation runs at import time.
const ENV_FOR_WIRING: Record<string, string> = {
  DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ci_db',
  JWT_ACCESS_SECRET: 'di_wiring_check_dummy_secret_at_least_32_chars',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  NODE_ENV: 'test',
  // The worker's timer must not start during a wiring check.
  OUTBOX_WORKER_ENABLED: 'false',
};

describe('AppModule dependency graph', () => {
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [k, v] of Object.entries(ENV_FOR_WIRING)) {
      saved[k] = process.env[k];
      process.env[k] = process.env[k] ?? v;
    }
    // OUTBOX_WORKER_ENABLED is forced rather than defaulted: a developer with
    // it set to true in their shell would otherwise start a polling loop here.
    process.env.OUTBOX_WORKER_ENABLED = 'false';
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('resolves every provider in the real application', async () => {
    // The whole point: if ANY module is missing an import for something its
    // controllers or guards inject, this throws UnknownDependenciesException
    // with the offending module named — here, in seconds, instead of in a
    // Docker health check after a deploy.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../../src/app.module') as typeof import('../../src/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });

  it('resolves the provider capability guards from EVERY module that mounts one', async () => {
    // The specific regression. The guard is mounted by controllers in two
    // different modules; one that resolves it and one that does not is exactly
    // the crash this suite was written for.
    //
    // Resolved via `select(Module)`, which navigates to THAT module's own
    // injector inside the real graph. Compiling each module standalone would
    // not work and would not be meaningful: repositories arrive from the
    // @Global PersistenceModule, which only exists once AppModule is built —
    // a standalone compile fails for reasons that have nothing to do with the
    // guard.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { AppModule } = require('../../src/app.module') as typeof import('../../src/app.module');
    const { ProviderModule } =
      require('../../src/modules/provider/provider.module') as typeof import('../../src/modules/provider/provider.module');
    const { ConversationsModule } =
      require('../../src/modules/conversations/conversations.module') as typeof import('../../src/modules/conversations/conversations.module');
    // Sprint 9B.8 — the verification module joined the list the moment its
    // controllers mounted the guard, and it did so by FAILING this suite:
    // it mounted the guard without importing the module that owns it, which
    // is a boot crash, not a request-time 500.
    const { ProviderVerificationModule } =
      require('../../src/modules/provider/verification/provider-verification.module') as typeof import('../../src/modules/provider/verification/provider-verification.module');
    const { ProviderActiveGuard } =
      require('../../src/modules/provider/guards/provider-active.guard') as typeof import('../../src/modules/provider/guards/provider-active.guard');
    // Sprint 9B.8 — ProviderCapabilityGuard is what most controllers now mount,
    // and ProviderActiveGuard is its VIEW_MARKETPLACE subclass. BOTH are checked:
    // a subclass resolving proves nothing about its base, and the base gained a
    // second dependency (Reflector) that could fail to resolve on its own.
    const { ProviderCapabilityGuard } =
      require('../../src/modules/provider/guards/provider-capability.guard') as typeof import('../../src/modules/provider/guards/provider-capability.guard');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      for (const mod of [ProviderModule, ConversationsModule, ProviderVerificationModule]) {
        // Resolving through the INJECTOR is the assertion. Constructing the
        // guard with `new` proves nothing — that is precisely how the unit
        // tests missed this.
        expect(moduleRef.select(mod).get(ProviderActiveGuard)).toBeDefined();
        expect(moduleRef.select(mod).get(ProviderCapabilityGuard)).toBeDefined();
      }
    } finally {
      await moduleRef.close();
    }
  });
});
