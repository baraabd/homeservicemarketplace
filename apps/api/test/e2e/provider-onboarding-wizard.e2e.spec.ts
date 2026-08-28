import { ProviderCapabilityService } from '../../src/modules/provider/capability/provider-capability.service';
// Route-level e2e for /v1/me/provider/onboarding/* (Sprint 8).
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// Boots a minimal Nest app with the real HTTP stack — cookie-parser,
// ValidationPipe, exception filter, RolesGuard — plus in-test fakes for the
// session and CSRF guards, mirroring provider-categories.e2e.spec.ts. The
// service is faked: what is under test here is the EDGE. The domain logic has
// its own unit suite, and this file exists to prove the things a unit test
// cannot see.
//
// What these tests pin:
//   - every route is auth-gated (no session => 401) and role-gated
//     (a seeker with a valid session => 403)
//   - mutations are CSRF-gated; reads are not
//   - the wizard is reachable by a DRAFT provider. Sprint 9B.8 gates it on
//     EDIT_OWN_PROFILE, which a DRAFT provider HOLDS — as opposed to
//     VIEW_MARKETPLACE, which onboarding earns and which would make the
//     surface unreachable for exactly the people whose job is to finish it
//   - `forbidNonWhitelisted` rejects the fields a client would forge to skip
//     review: status, onboardingState, verified, userId, providerProfileId
//   - there is no request shape through which a caller can name a DIFFERENT
//     provider: the service only ever receives the session user id
//   - the STEP comes from the path, so a request cannot claim to be editing
//     one step while writing another, and an unknown step is a 404
//   - `version` is mandatory: an unversioned write is a silent overwrite by
//     another name
//   - error bodies never carry Prisma / SQL / constraint strings

import {
  ExecutionContext,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppConfigService } from '../../src/config/app-config.service';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { ProviderOnboardingWizardController } from '../../src/modules/provider/onboarding/provider-onboarding-wizard.controller';
import { ProviderOnboardingWizardService } from '../../src/modules/provider/onboarding/provider-onboarding-wizard.service';
import { ProviderAvatarService } from '../../src/modules/provider/onboarding/avatar/provider-avatar.service';
import { AppError } from '../../src/shared/errors/app-error';

jest.setTimeout(15_000);

const BASE = '/v1/me/provider/onboarding';

const VIEW = {
  state: 'DRAFT',
  currentStep: 'PROVIDER_TYPE',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP', step: 'PROVIDER_TYPE' },
  complete: false,
  missing: [],
  data: {},
  version: 0,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
};

const wizard = {
  get: jest.fn(),
  patchStep: jest.fn(),
  submit: jest.fn(),
  withdraw: jest.fn(),
};

let fakeAuthedUser: { id: string; sessionId: string; jti: string; roles: string[] } | null = null;

class FakeJwtAuthGuard {
  canActivate(ctx: ExecutionContext): boolean {
    if (!fakeAuthedUser) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    ctx.switchToHttp().getRequest().user = fakeAuthedUser;
    return true;
  }
}

class FakeCsrfGuard {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const cookie = req.cookies?.hsm_csrf;
    const header = req.headers['x-csrf-token'];
    if (!cookie || !header || cookie !== header) {
      throw new UnauthorizedException({ code: 'AUTH_CSRF_INVALID' });
    }
    return true;
  }
}

// The exception filter echoes an unrecognised error's message in development
// for debuggability and redacts it in production, so the redaction test has to
// run against the PRODUCTION configuration — that is where the guarantee has
// to hold.
let isProduction = false;

function makeConfig(): AppConfigService {
  return {
    get: () => undefined,
    get isProduction() {
      return isProduction;
    },
  } as unknown as AppConfigService;
}

const CSRF = 'csrf-token-value';
const withCsrf = (r: request.Test) =>
  r.set('Cookie', [`hsm_csrf=${CSRF}`]).set('X-CSRF-Token', CSRF);

// Sprint 9B.8 — the capability guard's dependency, as a controllable double.
//
// Deliberately a SET rather than a blanket allow: the load-bearing assertion in
// this file is that a DRAFT provider CAN reach the wizard, and a guard stubbed
// to always pass would make it vacuous. DRAFT holds EDIT_OWN_PROFILE, which is
// what the controller declares — see the controller for why it is not
// COMPLETE_ONBOARDING.
const HELD = new Set<string>(['EDIT_OWN_PROFILE']);
const capabilityService = { can: async (_u: string, c: string) => HELD.has(c) };

// Sprint 9B.17 — the controller also depends on the avatar finalize service.
// A double, because this file tests the HTTP SURFACE — guards, CSRF, and that
// the session user id is the only id the service ever sees. What finalize does
// with an uploaded object is asserted in its own unit spec, against real
// storage doubles.
const avatars = {
  finalize: jest.fn(),
  remove: jest.fn(),
};

describe('Provider onboarding wizard — HTTP surface', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    @Module({
      controllers: [ProviderOnboardingWizardController],
      providers: [
        { provide: ProviderOnboardingWizardService, useValue: wizard },
        { provide: ProviderAvatarService, useValue: avatars },
        { provide: AppConfigService, useValue: makeConfig() },
        { provide: ProviderCapabilityService, useValue: capabilityService },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        Reflector,
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtAuthGuard)
      .overrideGuard(CsrfGuard)
      .useClass(FakeCsrfGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    // Same pipe configuration as main.ts — forbidNonWhitelisted is what makes
    // the injection tests below meaningful.
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    isProduction = false;
    wizard.get.mockResolvedValue(VIEW);
    wizard.patchStep.mockResolvedValue(VIEW);
    wizard.submit.mockResolvedValue(VIEW);
    wizard.withdraw.mockResolvedValue(VIEW);
    // A DRAFT provider. This is the whole point of the surface: they hold the
    // provider role and no marketplace capability at all.
    fakeAuthedUser = { id: 'user-1', sessionId: 's-1', jti: 'j-1', roles: ['provider'] };
  });

  describe('authentication and authorization', () => {
    it('GET the draft without a session is 401', async () => {
      fakeAuthedUser = null;
      await request(http).get(`${BASE}/draft`).expect(401);
      expect(wizard.get).not.toHaveBeenCalled();
    });

    it('PATCH a step without a session is 401', async () => {
      fakeAuthedUser = null;
      await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ version: 0, bio: 'x' })
        .expect(401);
      expect(wizard.patchStep).not.toHaveBeenCalled();
    });

    it('submit without a session is 401', async () => {
      fakeAuthedUser = null;
      await withCsrf(request(http).post(`${BASE}/submit`))
        .send({ version: 0 })
        .expect(401);
      expect(wizard.submit).not.toHaveBeenCalled();
    });

    it('a signed-in SEEKER cannot read the draft', async () => {
      fakeAuthedUser = { id: 'user-2', sessionId: 's-2', jti: 'j-2', roles: ['customer'] };
      await request(http).get(`${BASE}/draft`).expect(403);
      expect(wizard.get).not.toHaveBeenCalled();
    });

    it('a signed-in SEEKER cannot patch a step', async () => {
      fakeAuthedUser = { id: 'user-2', sessionId: 's-2', jti: 'j-2', roles: ['customer'] };
      await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ version: 0, bio: 'x' })
        .expect(403);
      expect(wizard.patchStep).not.toHaveBeenCalled();
    });

    it('a signed-in SEEKER cannot submit', async () => {
      fakeAuthedUser = { id: 'user-2', sessionId: 's-2', jti: 'j-2', roles: ['customer'] };
      await withCsrf(request(http).post(`${BASE}/submit`))
        .send({ version: 0 })
        .expect(403);
      expect(wizard.submit).not.toHaveBeenCalled();
    });

    it('a DRAFT provider CAN reach the whole surface', async () => {
      // The load-bearing one. Gating onboarding on VIEW_MARKETPLACE would make
      // the surface unreachable for exactly the providers whose job is to
      // finish onboarding, which is the loop Sprint 7 fixed. Sprint 9B.8 gates
      // it on EDIT_OWN_PROFILE instead — held by DRAFT — so this still passes,
      // and it now also proves the guard asks the RIGHT question: HELD
      // contains only EDIT_OWN_PROFILE, so a controller declaring anything
      // else would 403 here.
      await request(http).get(`${BASE}/draft`).expect(200);
      await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ version: 0, bio: 'x' })
        .expect(200);
      await withCsrf(request(http).post(`${BASE}/submit`))
        .send({ version: 0 })
        .expect(200);
      await withCsrf(request(http).post(`${BASE}/withdraw`))
        .send()
        .expect(200);
    });
  });

  describe('CSRF', () => {
    it('PATCH without a CSRF pair is 401', async () => {
      await request(http).patch(`${BASE}/steps/PROFILE`).send({ version: 0, bio: 'x' }).expect(401);
      expect(wizard.patchStep).not.toHaveBeenCalled();
    });

    it('submit without a CSRF pair is 401', async () => {
      await request(http).post(`${BASE}/submit`).send({ version: 0 }).expect(401);
      expect(wizard.submit).not.toHaveBeenCalled();
    });

    it('withdraw without a CSRF pair is 401', async () => {
      await request(http).post(`${BASE}/withdraw`).send().expect(401);
      expect(wizard.withdraw).not.toHaveBeenCalled();
    });

    it('the READ does not require CSRF', async () => {
      await request(http).get(`${BASE}/draft`).expect(200);
    });
  });

  describe('ownership cannot be forged', () => {
    it('the service only ever receives the SESSION user id', async () => {
      // There is no field for a provider id, and adding one to the body is
      // rejected by forbidNonWhitelisted before the service is reached. This
      // asserts the positive half: what actually arrives is the session's.
      await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ version: 0, bio: 'a bio' })
        .expect(200);

      expect(wizard.patchStep).toHaveBeenCalledWith('user-1', 'PROFILE', expect.anything());
    });

    it.each([
      ['userId', { userId: 'someone-else' }],
      ['providerProfileId', { providerProfileId: 'pp-999' }],
      ['status', { status: 'ACTIVE' }],
      ['onboardingState', { onboardingState: 'ACCEPTED' }],
      ['verified', { verified: true }],
      ['phoneVerified', { phoneVerified: true }],
    ])('PATCH rejects a forged %s with 400 before the service runs', async (_label, extra) => {
      await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ version: 0, bio: 'a bio', ...extra })
        .expect(400);
      expect(wizard.patchStep).not.toHaveBeenCalled();
    });

    it('leaves the WRONG-STEP check to the service, and hands it the evidence', async () => {
      // A field belonging to another step is not a shape error — the DTO is
      // one shape for all nine steps, so `acceptedConsentVersion` is a
      // perfectly valid field that simply does not belong on PROFILE.
      //
      // The two layers divide the work deliberately: the DTO gates SHAPE
      // (types, lengths, bounds, unknown fields), the service gates POLICY
      // (which step may write what, whether a category is a leaf, whether a
      // consent version is the live one) — because each of those needs state
      // the DTO cannot see. This test pins the handover rather than asserting
      // a 400 the edge has no business producing.
      await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ version: 0, bio: 'a bio', acceptedConsentVersion: 'v1' })
        .expect(200);

      expect(wizard.patchStep).toHaveBeenCalledWith(
        'user-1',
        'PROFILE',
        expect.objectContaining({ acceptedConsentVersion: 'v1' }),
      );
    });

    it('submit rejects a forged version-bypass field', async () => {
      await withCsrf(request(http).post(`${BASE}/submit`))
        .send({ version: 0, force: true })
        .expect(400);
      expect(wizard.submit).not.toHaveBeenCalled();
    });
  });

  describe('the step comes from the path', () => {
    it('passes the path step through to the service', async () => {
      await withCsrf(request(http).patch(`${BASE}/steps/AVAILABILITY`))
        .send({ version: 0, timezone: 'Asia/Damascus' })
        .expect(200);

      expect(wizard.patchStep).toHaveBeenCalledWith(
        'user-1',
        'AVAILABILITY',
        expect.objectContaining({ timezone: 'Asia/Damascus' }),
      );
    });

    it('an unknown step is a 404, not a 400', async () => {
      // The URL does not exist. Reporting it as a bad request would imply the
      // step is real and the payload was wrong.
      await withCsrf(request(http).patch(`${BASE}/steps/NOT_A_STEP`))
        .send({ version: 0 })
        .expect(404);
      expect(wizard.patchStep).not.toHaveBeenCalled();
    });

    it('a lowercase step name is a 404 — codes are exact', async () => {
      await withCsrf(request(http).patch(`${BASE}/steps/profile`))
        .send({ version: 0, bio: 'x' })
        .expect(404);
    });
  });

  describe('the version is mandatory', () => {
    it('PATCH without a version is 400', async () => {
      // An unversioned write is a silent overwrite by another name.
      await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ bio: 'x' })
        .expect(400);
      expect(wizard.patchStep).not.toHaveBeenCalled();
    });

    it('submit without a version is 400', async () => {
      await withCsrf(request(http).post(`${BASE}/submit`))
        .send({})
        .expect(400);
      expect(wizard.submit).not.toHaveBeenCalled();
    });

    it('a negative version is 400', async () => {
      await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ version: -1, bio: 'x' })
        .expect(400);
    });
  });

  describe('validation at the edge', () => {
    it('rejects an out-of-range day of week', async () => {
      await withCsrf(request(http).patch(`${BASE}/steps/AVAILABILITY`))
        .send({
          version: 0,
          timezone: 'UTC',
          availability: [{ dayOfWeek: 7, startMinute: 0, endMinute: 60 }],
        })
        .expect(400);
      expect(wizard.patchStep).not.toHaveBeenCalled();
    });

    it('rejects a minute past midnight', async () => {
      await withCsrf(request(http).patch(`${BASE}/steps/AVAILABILITY`))
        .send({
          version: 0,
          timezone: 'UTC',
          availability: [{ dayOfWeek: 1, startMinute: 0, endMinute: 1441 }],
        })
        .expect(400);
    });

    it('rejects more years of experience than a career can hold', async () => {
      await withCsrf(request(http).patch(`${BASE}/steps/EXPERIENCE`))
        .send({ version: 0, yearsOfExperience: 200 })
        .expect(400);
    });

    it('rejects an unknown provider type', async () => {
      await withCsrf(request(http).patch(`${BASE}/steps/PROVIDER_TYPE`))
        .send({ version: 0, providerType: 'COOPERATIVE' })
        .expect(400);
    });

    it('rejects an unknown transport code', async () => {
      await withCsrf(request(http).patch(`${BASE}/steps/EXPERIENCE`))
        .send({ version: 0, transportMode: 'TELEPORT' })
        .expect(400);
    });

    it('accepts a well-formed week', async () => {
      await withCsrf(request(http).patch(`${BASE}/steps/AVAILABILITY`))
        .send({
          version: 0,
          timezone: 'Asia/Damascus',
          availability: [
            { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
            { dayOfWeek: 1, startMinute: 720, endMinute: 1020 },
          ],
        })
        .expect(200);
    });
  });

  describe('error surfaces', () => {
    it('an incomplete submission is 422 with machine-readable codes', async () => {
      wizard.submit.mockRejectedValue(
        new AppError('VALIDATION_ERROR', 'Your provider application is not complete yet.', 422, {
          missing: [{ field: 'bio', code: 'REQUIRED' }],
        }),
      );

      const res = await withCsrf(request(http).post(`${BASE}/submit`))
        .send({ version: 0 })
        .expect(422);

      expect(res.body.error.details.missing).toEqual([{ field: 'bio', code: 'REQUIRED' }]);
    });

    it('a version conflict is 409', async () => {
      wizard.patchStep.mockRejectedValue(
        new AppError('CONFLICT', 'This application was changed somewhere else.', 409, {
          expectedVersion: 5,
          receivedVersion: 3,
        }),
      );

      const res = await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ version: 3, bio: 'x' })
        .expect(409);

      expect(res.body.error.details).toMatchObject({ expectedVersion: 5 });
    });

    it('never leaks a Prisma or SQL string in production', async () => {
      // The provider reading this includes someone probing the boundary. A
      // constraint name tells them the shape of the schema.
      isProduction = true;
      wizard.patchStep.mockRejectedValue(
        new Error(
          'Invalid `prisma.providerProfile.update()` invocation: constraint "provider_consent_consistent" violated',
        ),
      );

      const res = await withCsrf(request(http).patch(`${BASE}/steps/PROFILE`))
        .send({ version: 0, bio: 'x' })
        .expect(500);

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/prisma/i);
      expect(body).not.toMatch(/constraint/i);
      expect(body).not.toMatch(/provider_consent_consistent/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — the bug the unit suite could not see.
//
// The ValidationPipe hands the service a CLASS INSTANCE, not the plain object
// literal a unit test passes. TypeScript's class-field semantics define every
// declared property on every instance, as `undefined` — so a PATCH carrying
// one field arrives with all thirty declared keys present.
//
// The per-step field guard filtered on `Object.keys`, which therefore saw
// every field on every request and rejected all of them. Every unit test
// passed; the first real PATCH against a booted API 400'd with "these fields
// do not belong to the AVAILABILITY step: providerType, legalBusinessName,
// displayName, …" — a list of thirty fields the client never sent.
//
// This is the layer that can see it, because this is the layer that has the
// real pipe in it.
// ─────────────────────────────────────────────────────────────────────────────
describe('Provider onboarding wizard — the DTO instance reaches the service correctly', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    @Module({
      controllers: [ProviderOnboardingWizardController],
      providers: [
        { provide: ProviderOnboardingWizardService, useValue: wizard },
        { provide: ProviderAvatarService, useValue: avatars },
        { provide: AppConfigService, useValue: makeConfig() },
        { provide: ProviderCapabilityService, useValue: capabilityService },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        Reflector,
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtAuthGuard)
      .overrideGuard(CsrfGuard)
      .useClass(FakeCsrfGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    wizard.patchStep.mockResolvedValue(VIEW);
    fakeAuthedUser = { id: 'user-1', sessionId: 's-1', jti: 'j-1', roles: ['provider'] };
  });

  it('a single-field PATCH reaches the service and is not rejected as cross-step', async () => {
    await withCsrf(request(http).patch(`${BASE}/steps/PROVIDER_TYPE`))
      .send({ version: 0, providerType: 'INDIVIDUAL' })
      .expect(200);

    expect(wizard.patchStep).toHaveBeenCalledWith(
      'user-1',
      'PROVIDER_TYPE',
      expect.objectContaining({ providerType: 'INDIVIDUAL', version: 0 }),
    );
  });

  it('carries every declared key on the instance — which is WHY the guard must filter', async () => {
    // Pins the underlying condition, not just its symptom. If a future
    // tsconfig or pipe change stops materialising absent fields, this test
    // fails and the guard's `undefined` filter can be reconsidered
    // deliberately rather than discovered by a provider.
    await withCsrf(request(http).patch(`${BASE}/steps/PROVIDER_TYPE`))
      .send({ version: 0, providerType: 'INDIVIDUAL' })
      .expect(200);

    const received = wizard.patchStep.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(received)).toContain('bio');
    expect(received.bio).toBeUndefined();
  });

  // The mirror case — a field genuinely SENT for another step must still be
  // rejected — is asserted in the UNIT suite, not here: the cross-step guard
  // lives in the service, which this file deliberately fakes. Asserting it
  // against a mock would test nothing.

  it('accepts a full-week AVAILABILITY PATCH, the shape that first exposed this', async () => {
    await withCsrf(request(http).patch(`${BASE}/steps/AVAILABILITY`))
      .send({
        version: 0,
        timezone: 'Asia/Damascus',
        availability: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
          { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
        ],
      })
      .expect(200);

    expect(wizard.patchStep).toHaveBeenCalledWith(
      'user-1',
      'AVAILABILITY',
      expect.objectContaining({ timezone: 'Asia/Damascus' }),
    );
  });
});
