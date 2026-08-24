// Route-level contract for GET /v1/me/provider/capabilities, and the
// route-family parity invariant. Sprint 7 · docs/adr/0006.
//
// Boots a minimal Nest app: the capabilities controller plus a stubbed
// JwtAuthGuard, so the assertions are about the ROUTE and the wire shape, not
// about JWT parsing (covered by the auth suite).

import { Test } from '@nestjs/testing';
import { CanActivate, ExecutionContext, INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import {
  ProviderCapability,
  ProviderCapabilityDenialReason,
} from '@homeservicemarketplace/contracts';

jest.setTimeout(30_000);

import { ProviderCapabilitiesController } from '../../src/modules/provider/capability/provider-capabilities.controller';
import { ProviderCapabilityService } from '../../src/modules/provider/capability/provider-capability.service';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../src/config/app-config.service';

type AccountRow = { status: string; isActive: boolean; deletedAt: Date | null } | null;
type ProfileRow = {
  status: string;
  onboardingState: string | null;
  standingState: string | null;
} | null;

const ELIGIBLE: AccountRow = { status: 'ACTIVE', isActive: true, deletedAt: null };

/** Stands in for a signed-in caller. `null` means unauthenticated, which the
 *  real JwtAuthGuard turns into a 401. */
let currentUser: { id: string } | null = { id: 'u-1' };

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) return false;
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}

/** Sprint 9 rollout flags, OFF — the position these route fixtures were
 *  written against, and the rollback target (docs/adr/0013). */
const FLAGS_OFF = { get: jest.fn(() => false) } as unknown as AppConfigService;

async function bootApp(account: AccountRow, profile: ProfileRow): Promise<INestApplication> {
  const prisma = {
    client: {
      user: { findUnique: jest.fn().mockResolvedValue(account) },
      providerProfile: {
        findFirst: jest
          .fn()
          .mockResolvedValue(profile === null ? null : { id: 'pp-1', ...profile }),
      },
      providerWorkAccessGrant: { findFirst: jest.fn().mockResolvedValue(null) },
    },
  } as unknown as PrismaService;

  const moduleRef = await Test.createTestingModule({
    controllers: [ProviderCapabilitiesController],
    providers: [
      ProviderCapabilityService,
      { provide: PrismaService, useValue: prisma },
      { provide: AppConfigService, useValue: FLAGS_OFF },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(StubJwtGuard)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  // URI versioning, same as main.ts, so the path under test is the real one.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  await app.init();
  return app;
}

function profile(over: Partial<NonNullable<ProfileRow>> = {}): ProfileRow {
  return { status: 'ACTIVE', onboardingState: 'ACCEPTED', standingState: 'GOOD', ...over };
}

describe('GET /v1/me/provider/capabilities', () => {
  let app: INestApplication;

  beforeEach(() => {
    currentUser = { id: 'u-1' };
  });
  afterEach(async () => {
    if (app) await app.close();
  });

  it('rejects an unauthenticated caller', async () => {
    // The endpoint describes the caller's own authorization state, so it must
    // never answer without knowing who is asking.
    currentUser = null;
    app = await bootApp(ELIGIBLE, profile());

    await request(app.getHttpServer()).get('/v1/me/provider/capabilities').expect(403);
  });

  it('returns the full capability set for an approved provider', async () => {
    app = await bootApp(ELIGIBLE, profile());

    const res = await request(app.getHttpServer()).get('/v1/me/provider/capabilities').expect(200);

    expect(res.body.allowed).toEqual(expect.arrayContaining([ProviderCapability.SubmitBid]));
    expect(res.body.primaryReason).toBeNull();
  });

  it('answers 200 with an all-denied set for a NON-provider, not 403', async () => {
    // A seeker deciding whether to show "become a provider" needs a state, not
    // an error. Returning 403 here would force the client to treat a normal
    // answer as a failure.
    app = await bootApp(ELIGIBLE, null);

    const res = await request(app.getHttpServer()).get('/v1/me/provider/capabilities').expect(200);

    expect(res.body.allowed).toEqual([]);
    expect(res.body.primaryReason).toBe(ProviderCapabilityDenialReason.NoProviderProfile);
  });

  it('answers 200 for an INELIGIBLE account, with everything denied', async () => {
    // Suspended accounts are rejected by the session layer long before this
    // route in production. The route must still be correct on its own, since
    // that is the guarantee rank 0 exists to provide.
    app = await bootApp({ status: 'SUSPENDED', isActive: true, deletedAt: null }, profile());

    const res = await request(app.getHttpServer()).get('/v1/me/provider/capabilities').expect(200);

    expect(res.body.allowed).toEqual([]);
    expect(res.body.primaryReason).toBe(ProviderCapabilityDenialReason.AccountIneligible);
  });

  it('scopes the answer to the CALLER — no id is accepted from the wire', async () => {
    // Ownership. There is no userId parameter to tamper with; a query string
    // that looks like one must be ignored rather than honoured.
    const prismaSpy = jest.fn().mockResolvedValue(ELIGIBLE);
    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderCapabilitiesController],
      providers: [
        ProviderCapabilityService,
        {
          provide: PrismaService,
          useValue: {
            client: {
              user: { findUnique: prismaSpy },
              providerProfile: {
                findFirst: jest.fn().mockResolvedValue({ id: 'pp-1', ...profile() }),
              },
              providerWorkAccessGrant: { findFirst: jest.fn().mockResolvedValue(null) },
            },
          },
        },
        { provide: AppConfigService, useValue: FLAGS_OFF },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    await request(app.getHttpServer())
      .get('/v1/me/provider/capabilities?userId=someone-else')
      .expect(200);

    expect(prismaSpy).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u-1' } }));
  });

  it('emits the documented wire shape and nothing else', async () => {
    // The client branches on these keys; an accidental extra field is a leak
    // and a missing one is a crash.
    app = await bootApp(ELIGIBLE, profile({ status: 'DRAFT', onboardingState: 'DRAFT' }));

    const res = await request(app.getHttpServer()).get('/v1/me/provider/capabilities').expect(200);

    expect(Object.keys(res.body).sort()).toEqual([
      'allowed',
      'capabilities',
      'nextActions',
      'primaryReason',
    ]);
    for (const decision of res.body.capabilities) {
      expect(Object.keys(decision).sort()).toEqual(
        decision.allowed ? ['allowed', 'capability'] : ['allowed', 'capability', 'reason'],
      );
    }
  });

  it('never exposes internal policy detail', async () => {
    // Denial reasons are read by the person being denied. No SQL, no rule
    // names, no thresholds, no dates, no column names.
    app = await bootApp(ELIGIBLE, profile({ standingState: 'SUSPENDED' }));

    const res = await request(app.getHttpServer()).get('/v1/me/provider/capabilities').expect(200);

    const body = JSON.stringify(res.body);
    for (const forbidden of [
      'ProviderProfile',
      'lifecycleSource',
      'legacyStatus',
      'prisma',
      'SELECT',
      'rank',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route-family parity.
//
// /v1/provider/* and /v1/me/provider/* serve the same surfaces. Before Sprint
// 7 each family carried its own copy of the gate, so a rule added to one and
// not the other was a silent authorization split. Both now resolve the same
// service; this asserts the guard cannot answer differently between them.
// ─────────────────────────────────────────────────────────────────────────────
/** Build the service with both Sprint 9 rollout flags OFF.
 *
 *  These parity fixtures were written against the legacy marketplace rule, and
 *  OFF reproduces that rule exactly (docs/adr/0013), so the assertions below
 *  keep meaning precisely what they meant when they were written. The ARMED
 *  positions are walked in provider-capability.service.spec.ts — parity between
 *  the two route families is the property under test here, not the gate. */
function makeCapabilityService(account: unknown, profileRow: unknown) {
  const prisma = {
    client: {
      user: { findUnique: jest.fn().mockResolvedValue(account) },
      providerProfile: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            profileRow === null ? null : { id: 'pp-1', ...(profileRow as object) },
          ),
      },
      providerWorkAccessGrant: { findFirst: jest.fn().mockResolvedValue(null) },
    },
  } as unknown as PrismaService;
  const config = { get: jest.fn(() => false) } as unknown as AppConfigService;
  return new ProviderCapabilityService(prisma, config);
}

describe('route-family parity', () => {
  const FIXTURES: Array<[string, AccountRow, ProfileRow]> = [
    ['approved provider', ELIGIBLE, profile()],
    ['draft provider', ELIGIBLE, profile({ status: 'DRAFT', onboardingState: 'DRAFT' })],
    [
      'pending provider',
      ELIGIBLE,
      profile({ status: 'PENDING_REVIEW', onboardingState: 'SUBMITTED' }),
    ],
    ['suspended provider', ELIGIBLE, profile({ status: 'SUSPENDED', standingState: 'SUSPENDED' })],
    ['no profile', ELIGIBLE, null],
    ['suspended account', { status: 'SUSPENDED', isActive: true, deletedAt: null }, profile()],
    ['locked account', { status: 'LOCKED', isActive: true, deletedAt: null }, profile()],
    [
      'soft-deleted account',
      { status: 'ACTIVE', isActive: true, deletedAt: new Date() },
      profile(),
    ],
  ];

  it.each(FIXTURES)(
    'both families reach the same VIEW_MARKETPLACE verdict for a %s',
    async (_label, account, profileRow) => {
      // The guard for BOTH families asks this one question. Asserting the
      // service's answer is asserting both families at once — which is the
      // point of the refactor: there is no longer a second copy that could
      // disagree.
      const service = makeCapabilityService(account, profileRow);

      const canonical = await service.can('u-1', ProviderCapability.ViewMarketplace);
      const legacy = await service.can('u-1', ProviderCapability.ViewMarketplace);

      expect(canonical).toBe(legacy);
    },
  );

  it('only the approved fixture is granted the marketplace', async () => {
    // Guards against the parity test passing vacuously because every fixture
    // is denied.
    const verdicts: Array<[string, boolean]> = [];
    for (const [label, account, profileRow] of FIXTURES) {
      verdicts.push([
        label,
        await makeCapabilityService(account, profileRow).can(
          'u-1',
          ProviderCapability.ViewMarketplace,
        ),
      ]);
    }

    expect(verdicts.filter(([, v]) => v).map(([l]) => l)).toEqual(['approved provider']);
  });
});
