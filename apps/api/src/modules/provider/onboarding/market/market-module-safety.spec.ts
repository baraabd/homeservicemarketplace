import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import 'reflect-metadata';

import { MarketModule } from './market.module';
import {
  MARKET_LOCATION_RESOLVER_PORT,
  MarketLocationResolverPort,
} from './market-location-resolver.port';
import { UnavailableMarketLocationResolver } from './unavailable-market-location-resolver.adapter';

// Sprint 09B.29 Phase 5 — a deterministic fake must be unreachable in production.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.3
//
// WHY THIS FILE EXISTS
//
// `FakeMarketLocationResolver` answers "where is this provider" with a bounding
// box. That is exactly right for a test and catastrophic in production: it
// would fabricate a country, a timezone and a confidence for a real person, and
// every one of those values would look like an answer.
//
// The repository already has this pattern and its lesson. `EvidenceScanService`
// refuses to write CLEAN on a test scanner, and `resolveScannerSelection`
// refuses to BOOT in production with `EVIDENCE_SCANNER_DRIVER=test`. A fake
// that can be reached is a fake that will be reached.
//
// THREE INDEPENDENT GUARANTEES, because one is not enough:
//
//   1. LOCATION.  The fake lives under `test/`, and the production build sets
//      `rootDir: ./src`. A production file importing it does not fail a lint
//      rule — it fails to COMPILE.
//   2. BINDING.   The production module binds the port to a resolver that
//      cannot fabricate anything.
//   3. STRUCTURE. An architectural scan, so a future `src/` copy of the fake
//      is caught even if someone works around (1).

const SRC = join(__dirname, '..', '..', '..', '..');

/** Every .ts file under src/, excluding specs — specs are not shipped. */
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      productionSources(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('the production module cannot fabricate a location', () => {
  /**
   * What `MarketModule` actually binds the port to.
   *
   * Read from the module's own Nest metadata rather than by booting it. The
   * module pulls in Prisma, which needs config, a database URL and a pool —
   * none of which this question depends on. Booting it here would make a
   * statement about the BINDING require a working database, which is how a
   * safety test ends up skipped in the one environment that needs it.
   */
  function boundResolverClass(): unknown {
    const providers =
      (Reflect.getMetadata('providers', MarketModule) as {
        provide?: unknown;
        useClass?: unknown;
      }[]) ?? [];
    const binding = providers.find(
      (p) => typeof p === 'object' && p !== null && p.provide === MARKET_LOCATION_RESOLVER_PORT,
    );
    if (!binding) {
      // Thrown rather than asserted: Jest's `expect` takes no message
      // argument, and a bare `toBeDefined()` failure here would read as
      // "undefined is not defined" with no hint of what is missing.
      throw new Error(
        'MarketModule must bind MARKET_LOCATION_RESOLVER_PORT; without it the token is unbound and every injection site would have to guess',
      );
    }
    return binding.useClass;
  }

  it('binds the port to the unavailable resolver and to nothing else', () => {
    // Named explicitly. A future `useClass` swap to anything that can answer
    // has to change this line, which is the review moment this test exists to
    // create.
    expect(boundResolverClass()).toBe(UnavailableMarketLocationResolver);
  });

  it('refuses with a typed reason rather than guessing', async () => {
    const Bound = boundResolverClass() as new () => MarketLocationResolverPort;
    const resolver = new Bound();

    await expect(resolver.resolve({ latitude: 33.51, longitude: 36.29 })).rejects.toMatchObject({
      reason: 'NOT_CONFIGURED',
    });
  });

  it('never returns a country, timezone or confidence when unconfigured', async () => {
    const Bound = boundResolverClass() as new () => MarketLocationResolverPort;
    const resolver = new Bound();

    // Damascus coordinates. The FAKE would answer SY / Asia/Damascus / HIGH.
    // The production binding must produce no value at all — a fabricated
    // country for a real person is the failure this whole file exists to stop.
    const outcome = await resolver
      .resolve({ latitude: 33.51, longitude: 36.29 })
      .then((r) => ({ resolved: r as unknown }))
      .catch((e: { reason?: string }) => ({ reason: e.reason }));

    expect(outcome).not.toHaveProperty('resolved');
    expect(outcome).toEqual({ reason: 'NOT_CONFIGURED' });
  });

  it('reports honestly that location suggestion is unavailable', () => {
    // The capability the UI reads. With no real resolver the answer is false,
    // and the client must then never show "Use my location" — a control that
    // cannot work is worse than an absent one.
    const Bound = boundResolverClass() as new () => MarketLocationResolverPort;

    expect(new Bound().isAvailable).toBe(false);
  });
});

describe('architectural guarantee', () => {
  it('no production source imports a test adapter', () => {
    // (3) of the three guarantees. The fake lives under `test/`, so this scan
    // is what catches a future COPY of it inside `src/` — the workaround that
    // would defeat the compile-time boundary.
    const offenders = productionSources(SRC)
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return (
          /from\s+['"][^'"]*\/test\//.test(text) ||
          /from\s+['"][^'"]*[Ff]ake[A-Za-z]*Resolver['"]/.test(text) ||
          /FakeMarketLocationResolver/.test(text)
        );
      })
      .map((f) => f.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it('no module provides an adapter whose name marks it as a fake', () => {
    // Names are a weak signal on their own, which is why this is the third
    // guarantee rather than the only one. It catches the obvious mistake
    // cheaply.
    const offenders = productionSources(SRC)
      .filter((f) => f.endsWith('.module.ts'))
      .filter((file) =>
        /\b(Fake|Stub|Dummy|InMemory)[A-Z]\w*Resolver\b/.test(readFileSync(file, 'utf8')),
      )
      .map((f) => f.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });
});

describe('the binding the ONBOARDING APPLICATION actually resolves', () => {
  // Metadata says what a module declares. This resolves the token through a
  // real Nest container, which is what the application does — a later import,
  // a re-provide or an override could change the answer, and only asking the
  // container catches that.
  //
  // Prisma is overridden rather than connected. The question is which class the
  // container hands back, and making that question need a database is how a
  // safety test ends up skipped in the environment that needs it most. An
  // earlier attempt booted the whole AppModule inside the shared gated run
  // instead: it mutated `process.env` process-wide and took 500 seconds,
  // and it broke 29 unrelated suites.
  it('hands back the unavailable resolver, not a fake', async () => {
    const { Test } = await import('@nestjs/testing');
    const { PrismaService } = await import('../../../../infrastructure/prisma/prisma.service');

    const moduleRef = await Test.createTestingModule({ imports: [MarketModule] })
      .overrideProvider(PrismaService)
      .useValue({ client: {}, isReady: () => true })
      .compile();

    const resolver = moduleRef.get<MarketLocationResolverPort>(MARKET_LOCATION_RESOLVER_PORT);

    expect(resolver).toBeInstanceOf(UnavailableMarketLocationResolver);
    expect(resolver.constructor.name).not.toMatch(/Fake|Stub|Dummy|InMemory/);
    expect(resolver.isAvailable).toBe(false);
    await expect(resolver.resolve({ latitude: 33.51, longitude: 36.29 })).rejects.toMatchObject({
      reason: 'NOT_CONFIGURED',
    });

    await moduleRef.close();
  });

  it('is reachable from the provider application, not orphaned', async () => {
    // MarketModule binding the port correctly is worth nothing if the
    // onboarding application never imports it. This is the link in the chain
    // the metadata test above cannot see.
    const { ProviderModule } = await import('../../provider.module');
    const imports = (Reflect.getMetadata('imports', ProviderModule) ?? []) as unknown[];

    expect(imports).toContain(MarketModule);
  });
});
