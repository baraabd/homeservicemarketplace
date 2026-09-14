export {};

import { Test } from '@nestjs/testing';
import { CanActivate, INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';

import { ProviderOnboardingWizardController } from '../../src/modules/provider/onboarding/provider-onboarding-wizard.controller';
import { ProviderOnboardingWizardService } from '../../src/modules/provider/onboarding/provider-onboarding-wizard.service';
import { ProviderAvatarService } from '../../src/modules/provider/onboarding/avatar/provider-avatar.service';
import { SupportedMarketsService } from '../../src/modules/provider/onboarding/market/supported-markets.service';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/iam/authorization/guards/roles.guard';
import { ProviderCapabilityGuard } from '../../src/modules/provider/guards/provider-capability.guard';

// Sprint 09B.29 — every onboarding URL the web client asks for must RESOLVE.
//
// This exists because of a reported manual-test failure. The provider's browser
// logged, repeatedly:
//
//   GET http://localhost:4000/v1/me/provider/onboarding/markets  404
//
// while `@Get('markets')` was plainly present in this controller. The cause was
// not the code: the API answering that browser was a container built on
// 2026-08-30 from an image that predated the route by twelve days, so the route
// genuinely was not registered in the process serving the request. `docker
// compose up -d` reuses an existing `hsm-api:dev` image unless `--build` is
// passed, and nothing made the staleness visible.
//
// A test cannot stop somebody running an old image. What it CAN do is fail the
// moment the repository itself stops serving a URL the client depends on —
// a renamed path, a dropped decorator, a version or prefix change, a controller
// left out of its module. Those are the same symptom from a cause we own.
//
// WHAT IS REAL AND WHAT IS NOT
//
// The ROUTER is real: versioning, the controller's own path, and the HTTP
// method table all come from Nest. The guards are replaced with pass-throughs
// and the services are stubs, because the question here is exclusively "does
// this URL reach a handler" — a 404 from a missing route and a 401 from a guard
// are different answers and this suite is about the first one. Every guard and
// service already has its own coverage.
//
// A 404 here means the URL is gone. Anything else means it resolved.

const allow: CanActivate = { canActivate: () => true };

/**
 * The onboarding URLs the web client builds, taken from its own API modules.
 *
 * Kept as literals rather than imported from the web package: this asserts the
 * agreed contract, and a shared constant would let both sides drift together
 * while the test kept passing.
 */
const CLIENT_URLS: ReadonlyArray<{ method: 'get' | 'patch' | 'post'; url: string; from: string }> =
  [
    { method: 'get', url: '/v1/me/provider/onboarding/draft', from: 'provider-onboarding-api.ts' },
    { method: 'get', url: '/v1/me/provider/onboarding/hub', from: 'provider-onboarding-api.ts' },
    { method: 'get', url: '/v1/me/provider/onboarding/review', from: 'provider-onboarding-api.ts' },
    // The one the report was about.
    { method: 'get', url: '/v1/me/provider/onboarding/markets', from: 'provider-markets-api.ts' },
    {
      method: 'patch',
      url: '/v1/me/provider/onboarding/steps/IDENTITY',
      from: 'provider-onboarding-api.ts',
    },
    {
      method: 'post',
      url: '/v1/me/provider/onboarding/submit',
      from: 'provider-onboarding-api.ts',
    },
    {
      method: 'post',
      url: '/v1/me/provider/onboarding/withdraw',
      from: 'provider-onboarding-api.ts',
    },
  ];

describe('onboarding routes the client depends on are registered', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderOnboardingWizardController],
      providers: [
        // Empty objects, deliberately.
        //
        // A handler that calls a missing method throws, and a throw is a 500 —
        // which is still "not 404", so the routing assertion holds while the
        // stubs stay trivial.
        //
        // The first attempt used a catch-all Proxy answering every property
        // with an async function, and this suite hung forever. Such a Proxy
        // answers `then` with a function too, so anything that awaits the stub
        // treats it as a promise that never settles. Worth remembering: a
        // "responds to everything" double is accidentally a thenable.
        { provide: ProviderOnboardingWizardService, useValue: {} },
        { provide: ProviderAvatarService, useValue: {} },
        { provide: SupportedMarketsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(ProviderCapabilityGuard)
      .useValue(allow)
      .compile();

    app = moduleRef.createNestApplication();
    // The same URI versioning the real application applies. Without it every
    // `/v1/...` below would 404 for a reason that has nothing to do with the
    // controller, and the suite would be measuring its own harness.
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it.each(CLIENT_URLS)('$method $url resolves (declared in $from)', async ({ method, url }) => {
    const res = await request(app.getHttpServer())[method](url).send({});

    expect(res.status).not.toBe(404);
  });

  it('a URL the client does NOT use still 404s, so the check can fail', async () => {
    // Without this the suite could pass by resolving everything — a catch-all
    // route or a mis-built harness would look like success.
    const res = await request(app.getHttpServer()).get(
      '/v1/me/provider/onboarding/not-a-real-route',
    );

    expect(res.status).toBe(404);
  });

  it('the markets route is not served on an unversioned path', async () => {
    // The client asks for `/v1/...`. A route reachable only without the prefix
    // would pass the table above while still 404ing in the browser.
    const res = await request(app.getHttpServer()).get('/me/provider/onboarding/markets');

    expect(res.status).toBe(404);
  });
});
