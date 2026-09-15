import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// Sprint 9B.27 — the real-stack harness for Provider Onboarding V2.
//
// WHY THIS EXISTS
//
// Every other V2 spec calls `stubApi()`, which fulfils the onboarding routes
// from a fixture. That proves the UI renders a shape; it cannot prove the
// shape is the one the server actually sends, and for six sprints it was not,
// because `GET /onboarding/hub` had no server implementation at all. A suite
// that stubs the endpoint under test stays green straight through that
// outage — and did.
//
// So nothing here intercepts. The browser talks to a real API, over real HTTP,
// with real cookies, real CSRF, real guards, real Postgres and real Redis. The
// only thing this module does is BUILD the fixtures, and it builds them by
// calling the same public endpoints a real provider's browser would.
//
// Deliberately NOT used:
//   - `page.route` on any onboarding endpoint;
//   - direct database writes;
//   - a test-only endpoint, seed hook, or auth bypass.
// The last one matters most: a harness that installs a backdoor to make a
// journey testable has stopped testing the journey.

export const REAL_API = process.env.E2E_REAL_API ?? '';
export const MAILPIT = process.env.E2E_MAILPIT ?? 'http://127.0.0.1:28025';

/** The endpoints this suite exists to exercise. Asserted un-stubbed. */
export const CRITICAL_ENDPOINTS = [
  '/me/provider/onboarding/hub',
  '/me/provider/onboarding/draft',
  '/me/provider/onboarding/steps/',
  '/me/provider/onboarding/review',
  '/me/provider/onboarding/submit',
  '/me/provider/onboarding/withdraw',
] as const;

export type Jar = Map<string, string>;
export const newJar = (): Jar => new Map();

function absorb(jar: Jar, res: Response): void {
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

/**
 * One request against the real API, carrying the jar's cookies and echoing the
 * CSRF token the way the browser's own client does.
 */
export async function api<T = unknown>(
  jar: Jar,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = jar.get('hsm_csrf');
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;

  const res = await fetch(`${REAL_API}${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  absorb(jar, res);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 204s and empty bodies are legitimate; the status is the assertion. */
  }
  return { status: res.status, body: body as T };
}

/**
 * Read a one-time code out of the mail catcher.
 *
 * The OTP is never persisted in plaintext, so the mailbox is the only place it
 * can be read — which is exactly how a real provider gets it. Read the TEXT
 * part rather than the serialised envelope: mailpit's own metadata contains
 * six-digit runs, and matching those yields codes that were never OTPs.
 */
export async function otpFor(email: string): Promise<string> {
  const wanted = email.toLowerCase();
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json()) as {
      messages?: { ID: string; To?: { Address?: string }[] }[];
    };
    const hits = (list.messages ?? []).filter((m) =>
      (m.To ?? []).some((t) => t.Address?.toLowerCase() === wanted),
    );
    if (hits.length > 0) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${hits[0].ID}`)).json()) as {
        Text?: string;
      };
      const code = (full.Text ?? '').match(/code is (\d{6})/)?.[1];
      if (code) {
        // Consume ONLY the message whose code is being used.
        //
        // Deleting every message for the address looks tidier and is wrong for
        // the one mailbox more than one worker shares — the seeded admin. Two
        // parallel workers each trigger a login, two codes arrive, and a
        // sweep-all deletes the other worker's code before it has read it,
        // turning a fixture collision into an "invalid OTP" that looks like an
        // auth bug. Provider accounts are unique per test and unaffected
        // either way.
        await fetch(`${MAILPIT}/api/v1/messages`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ IDs: [hits[0].ID] }),
        });
        return code;
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`no OTP mail arrived for ${email}`);
}

export interface Account {
  email: string;
  password: string;
  jar: Jar;
  /** The provider profile opened by `upgrade`. The admin queue is keyed by
   *  this, not by the account's email. */
  profileId: string;
}

const PASSWORD = 'a-reasonable-passphrase-1';

/**
 * A real, verified provider account.
 *
 * register -> OTP out of the mailbox -> verify -> upgrade. Every step is a
 * public endpoint; nothing is written behind the API's back.
 *
 * The refresh at the end is not ceremony. `RolesGuard` reads roles from the
 * ACCESS TOKEN, and `upgrade` grants the provider role in the database without
 * reissuing one — so the token minted at verify-otp still says "customer" and
 * every provider route 403s until the session is refreshed. Recorded in the
 * release notes as a real defect; reproduced here rather than papered over,
 * because a harness that silently works around a bug stops anyone finding it.
 */
export async function registerProvider(): Promise<Account> {
  const jar = newJar();
  const freshEmail = () => `v2e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;

  // One retry, and only for a 5xx.
  //
  // The first SMTP connection of a run can time out against a cold mail
  // catcher ("Greeting never received") and surface as a 500 from register.
  // That is an environment warm-up artefact, not the contract — the same
  // retry, for the same reason, is in auth-cookies.spec.ts.
  //
  // The retry uses a NEW address on purpose: a 500 from the mail step means
  // the account may already have been created before the send failed, so
  // reusing the address would collide with it and turn a warm-up blip into a
  // 409 that looks like a registration bug. A 4xx is NOT retried — that is a
  // real refusal and must fail here.
  let email = freshEmail();
  let registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, firstName: 'Pat', lastName: 'Provider' },
  });
  if (registered.status >= 500) {
    email = freshEmail();
    registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
      method: 'POST',
      body: { email, password: PASSWORD, firstName: 'Pat', lastName: 'Provider' },
    });
  }
  expect(registered.status, 'register should be accepted').toBeLessThan(400);

  const verified = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
  });
  expect(verified.status, 'OTP verification should succeed').toBe(200);

  const upgraded = await api<{ profile: { id: string } }>(jar, '/v1/me/provider/upgrade', {
    method: 'POST',
    body: {},
  });
  expect(upgraded.status, 'upgrade should open a DRAFT provider profile').toBe(200);

  await api(jar, '/v1/auth/refresh', { method: 'POST' });
  return { email, password: PASSWORD, jar, profileId: upgraded.body.profile.id };
}

/** The draft's optimistic-concurrency token. An unversioned write is a silent
 *  overwrite by another name, so the server refuses one. */
async function currentVersion(jar: Jar): Promise<number> {
  const draft = await api<{ version: number }>(jar, '/v1/me/provider/onboarding/draft');

  // ── Fail where the failure IS, not one call later ────────────────────────
  //
  // This read used to return `draft.body.version` with no check at all, and
  // that turned every upstream problem into the same confusing lie. In CI the
  // OTP limiter returned 429, so the session was never established, so this
  // GET answered with an error envelope, so `version` was `undefined`, so the
  // NEXT call — a PATCH — was refused with:
  //
  //   "version must not be less than 0; version must be an integer number"
  //
  // which reads like a contract bug in the wizard and is nothing of the kind.
  // Two of the three failure classes in that job were this one sentence.
  //
  // So the status is asserted here, and the version is asserted to be the shape
  // the server's own DTO requires. A fixture that cannot read the draft must say
  // so; it must not hand a malformed version to the next request and let the
  // server's validator describe the symptom.
  expect(
    draft.status,
    `the draft must be readable before a step is written: ${JSON.stringify(draft.body)}`,
  ).toBe(200);

  const version = draft.body.version;
  expect(
    Number.isInteger(version) && (version as number) >= 0,
    `the draft should carry a non-negative integer version, got ${JSON.stringify(version)}`,
  ).toBe(true);

  return version;
}

/**
 * Write one step, and return the version the server reached.
 *
 * The version is THREADED rather than re-read. Fetching it before every write
 * doubled the request count — a GET for each PATCH — and the real-API job hit
 * the platform's 100-per-minute backstop because of it: six steps per account
 * across twenty-three tests is roughly a hundred and forty draft reads that
 * exist only to learn a number the previous response already carried.
 *
 * It is also more correct. Read-then-write is a race by construction, however
 * short the gap; using the version the last write RETURNED is the same
 * optimistic-concurrency discipline the product's own client follows.
 *
 * `known` is optional so the first call in a chain can still discover it.
 */
async function patchStep(
  jar: Jar,
  step: string,
  body: Record<string, unknown>,
  known?: number,
): Promise<number> {
  const version = known ?? (await currentVersion(jar));
  const res = await api<{ version?: number }>(jar, `/v1/me/provider/onboarding/steps/${step}`, {
    method: 'PATCH',
    body: { version, ...body },
  });
  expect(res.status, `PATCH ${step} should be accepted: ${JSON.stringify(res.body)}`).toBe(200);

  const next = res.body.version;
  expect(
    Number.isInteger(next) && (next as number) > version,
    `PATCH ${step} should report the version it advanced to, got ${JSON.stringify(next)}`,
  ).toBe(true);
  return next as number;
}

/** Which collecting steps to fill. Omitting one leaves exactly the blocker a
 *  test wants to assert on, rather than an arbitrary half-finished draft. */
export type CollectingStep =
  | 'PROVIDER_TYPE'
  | 'IDENTITY'
  | 'LOCATION'
  | 'SPECIALTIES'
  | 'EXPERIENCE'
  | 'AVAILABILITY'
  | 'PROFILE';

/**
 * Fill the collecting steps through the real PATCH endpoints.
 *
 * These are the same writes the task screens perform, with the same
 * validation, the same version check and the same persistence. The browser
 * still drives a task by hand — see the "edited in the browser" test — so this
 * is a shortcut for the steps a given test is NOT about, not a replacement for
 * the journey.
 */
export async function completeDraft(
  account: Account,
  options: { skip?: readonly CollectingStep[] } = {},
): Promise<void> {
  const skip = new Set<CollectingStep>(options.skip ?? []);
  const { jar } = account;

  const catalogue = await api<{ items: { id: string; isLeaf?: boolean }[] }>(jar, '/v1/services');
  expect(catalogue.status, 'the public service catalogue should be readable').toBe(200);
  const leaf = catalogue.body.items.find((c) => c.isLeaf !== false);
  expect(leaf, 'the seeded catalogue should offer at least one leaf category').toBeTruthy();

  // One draft read for the whole chain; every write after the first uses the
  // version its predecessor returned.
  let version: number | undefined;
  const step = async (name: CollectingStep, body: Record<string, unknown>): Promise<void> => {
    if (skip.has(name)) return;
    version = await patchStep(jar, name, body, version);
  };

  await step('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
  await step('IDENTITY', {
    displayName: 'Layla Mansour',
    phoneNumber: '+963900000444',
  });
  await step('LOCATION', {
    serviceAreaCity: 'Damascus',
    serviceAreaCountry: 'Syria',
    serviceAreaCountryCode: 'SY',
    serviceAreaRadiusKm: 20,
  });
  await step('SPECIALTIES', {
    specialtyLeafIds: [leaf!.id],
    primarySpecialtyId: leaf!.id,
  });
  await step('EXPERIENCE', { yearsOfExperience: 5 });
  // A timezone must exist before a weekly window can be stored: the server
  // refuses the write otherwise, because minutes-from-midnight mean nothing
  // without one.
  await step('AVAILABILITY', {
    timezone: 'Asia/Damascus',
    availability: [
      { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
    ],
  });
  await step('PROFILE', {
    headline: 'Certified electrician',
    bio: 'A sufficiently long biography for the onboarding policy to consider this profile complete and useful.',
  });
}

/**
 * Approve this provider's category applications, as an admin, through the real
 * admin API.
 *
 * A specialty a provider selects is an APPLICATION, not a grant: the review
 * reports `serviceCategories: AWAITING_REVIEW` until someone holding the admin
 * role approves it. That is a real gate, so the harness clears it the real
 * way — a second authenticated session with a different role — rather than
 * writing the approved row directly.
 */
/**
 * One seeded admin per parallel worker.
 *
 * Every login sends a code to a MAILBOX, and a mailbox cannot tell two
 * concurrent challenges apart: two workers signing in as the same admin
 * produce two codes, each worker reads whichever arrived last, and one of them
 * verifies a challenge it does not own — a 400 that reads like an auth bug and
 * is really a fixture collision. Giving each worker its own mailbox removes
 * the race rather than retrying through it.
 *
 * `TEST_PARALLEL_INDEX` is set by Playwright per worker. The modulo is a
 * backstop for a run with more workers than seeded admins; it reintroduces the
 * collision, which is why the retry below is kept.
 */
const SEEDED_ADMINS: ReadonlyArray<{ email: string; password: string }> = [
  { email: 'admin@admin.com', password: 'DevAdmin123!' },
  { email: 'test1@admin.com', password: 'DevAdmin123!' },
  { email: 'test@admin.com', password: '1qaz2wsx3edc!!' },
];

function adminForThisWorker(): { email: string; password: string } {
  const index = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  return SEEDED_ADMINS[index % SEEDED_ADMINS.length];
}

/** One admin session per worker process — signing in once instead of once per
 *  call keeps the mailbox quiet and the queue reads cheap. */
let adminSession: Promise<Jar> | null = null;

/** When that session was last known good. */
let adminSessionAt = 0;

/**
 * How long an admin session is reused before it is refreshed.
 *
 * Sprint 09B.29 Phase 5B. `JWT_ACCESS_TTL_SECONDS` defaults to **600** — ten
 * minutes — and this session was memoised for the lifetime of the worker with
 * nothing to renew it. Any suite that ran longer than ten minutes therefore
 * started returning 401 from every admin call, and because the expiry is a
 * WALL-CLOCK event rather than a property of any one test, the failure landed on
 * whichever test happened to run next:
 *
 *   run 1  'a task edited in the browser is persisted'   (timed out)
 *   run 2  'a direct task deep link opens that task'     (timed out)
 *   run 3  'review blockers agree with the hub'          401 from the queue
 *
 * Three runs, three different tests, one cause. That is the signature of shared
 * state with a clock in it, and it is worth recognising: a failure that moves
 * between runs is rarely three bugs.
 *
 * Half the TTL, so the margin is as large as the reuse window. Refreshing
 * PROACTIVELY rather than retrying on a 401 is deliberate — it keeps every
 * caller unchanged, and this file must not teach the suite that a 401 is
 * something to retry past.
 */
const ADMIN_SESSION_MAX_AGE_MS = 5 * 60_000;

async function signInAsAdmin(): Promise<Jar> {
  const who = adminForThisWorker();
  const admin = newJar();
  const login = await api<{ otpRequired?: boolean; challengeId?: string }>(
    admin,
    '/v1/auth/login',
    {
      method: 'POST',
      body: { email: who.email, password: who.password },
    },
  );
  expect(login.status, `the seeded admin ${who.email} should be able to sign in`).toBe(200);
  if (login.body.otpRequired) {
    const verified = await api(admin, '/v1/auth/verify-otp', {
      method: 'POST',
      body: { challengeId: login.body.challengeId, code: await otpFor(who.email) },
    });
    expect(verified.status, `admin OTP should verify for ${who.email}`).toBe(200);
  }
  return admin;
}

export async function adminJar(): Promise<Jar> {
  if (!adminSession) {
    // One retry, for the backstop case above only. Not a blanket retry: a
    // failure for any other reason fails again immediately and is reported.
    adminSession = signInAsAdmin().catch(() => signInAsAdmin());
    adminSessionAt = Date.now();
    return adminSession;
  }

  if (Date.now() - adminSessionAt < ADMIN_SESSION_MAX_AGE_MS) return adminSession;

  // Old enough that the access token may have lapsed. Renew it the way the
  // product does — through the refresh endpoint, using the refresh cookie the
  // jar already scopes to `/v1/auth/refresh` — so this exercises the real
  // mechanism rather than working around it. If the refresh token has gone too,
  // sign in again; that is a new session, not a retry of a failed request.
  const jar = await adminSession;
  const refreshed = await api(jar, '/v1/auth/refresh', { method: 'POST' });
  if (refreshed.status === 200) {
    adminSessionAt = Date.now();
    return jar;
  }

  adminSession = signInAsAdmin();
  adminSessionAt = Date.now();
  return adminSession;
}

/**
 * The smallest image the media policy will accept: a 1x1 PNG.
 *
 * Real bytes through the real pipeline. The point of these fixtures is that a
 * portfolio item exists the way one actually comes to exist — presign, upload,
 * register — so the thing under test (the ORDER) is the only part the test
 * performs itself.
 * Encoded from phase3-activation's valid EVIDENCE_PNG generator; keeping the
 * bytes here avoids a circular import between the two HTTP helpers.
 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
  'base64',
);

/** The storage key the server minted, taken out of the file URL it returned. */
function storageKeyFromFileUrl(fileUrl: string): string {
  const marker = '/v1/media/files/';
  const idx = fileUrl.indexOf(marker);
  if (idx >= 0) return fileUrl.slice(idx + marker.length);
  return new URL(fileUrl).pathname.replace(/^\/+/, '');
}

/**
 * Put one real photo in a provider's portfolio, through the real endpoints.
 *
 * Three calls, because that is what the browser makes: a presign for a
 * server-synthesised key, a PUT of the bytes to the sink that key belongs to,
 * and a registration that ties the key to the provider. Seeding the row
 * directly would skip the upload path entirely and leave a test that proves
 * ordering over rows no provider could have created.
 *
 * Returns the item id, so a caller can assert on the ORDER of ids rather than
 * on positions it has to infer.
 */
export async function addPortfolioPhoto(jar: Jar, title: string): Promise<string> {
  const presigned = await api<{
    items: Array<{ uploadUrl: string; fileUrl: string }>;
  }>(jar, '/v1/media/presigned-url', {
    method: 'POST',
    body: {
      purpose: 'portfolio',
      items: [{ contentType: 'image/png', sizeBytes: TINY_PNG.byteLength }],
    },
  });
  expect(presigned.status, 'a portfolio presign should be granted').toBe(200);

  const { uploadUrl, fileUrl } = presigned.body.items[0];

  // A raw PUT: `api()` speaks JSON, and this is the one step in the journey
  // that carries bytes. The URL may be relative to the API origin.
  const target = uploadUrl.startsWith('http') ? uploadUrl : `${REAL_API}${uploadUrl}`;
  const put = await fetch(target, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: TINY_PNG,
  });
  expect(put.status, `the upload sink should accept the bytes (got ${put.status})`).toBeLessThan(
    300,
  );

  const created = await api<{ id: string }>(jar, '/v1/me/provider/portfolio', {
    method: 'POST',
    body: {
      storageKey: storageKeyFromFileUrl(fileUrl),
      contentType: 'image/png',
      sizeBytes: TINY_PNG.byteLength,
      title,
      // The consent gate, sent explicitly. The controller overrides it anyway,
      // but the DTO requires it to be literally true — so a client that has not
      // shown the provider the wording cannot register a photo by omission.
      publicationRightAck: true,
    },
  });
  expect(created.status, `the photo should be registered: ${JSON.stringify(created.body)}`).toBe(
    200,
  );
  return created.body.id;
}

/** The portfolio in the order the server currently holds it. */
export async function portfolioOrder(jar: Jar): Promise<string[]> {
  const res = await api<{ items: Array<{ id: string }> }>(jar, '/v1/me/provider/portfolio');
  expect(res.status, 'the portfolio should be readable').toBe(200);
  return res.body.items.map((i) => i.id);
}

export async function approveCategoriesFor(account: Account): Promise<void> {
  const admin = await adminJar();

  const pending = await api<{ items: Record<string, unknown>[] }>(
    admin,
    '/v1/admin/category-applications?status=PENDING&limit=100',
  );
  expect(pending.status, 'the admin queue should be readable').toBe(200);

  // Only THIS provider's applications, matched on the profile id the upgrade
  // returned. Approving the whole queue would couple parallel workers to each
  // other, and a test that depends on another test's fixtures is the flake
  // this suite exists to be free of. Matched on the id rather than the email
  // because the queue projection carries the provider's profile, not their
  // login — and every fixture here shares a display name.
  const mine = pending.body.items.filter((a) => JSON.stringify(a).includes(account.profileId));
  expect(
    mine.length,
    `the admin queue should hold a pending application for profile ${account.profileId}`,
  ).toBeGreaterThan(0);
  for (const application of mine) {
    const reviewed = await api(
      admin,
      `/v1/admin/category-applications/${application.id as string}/review`,
      { method: 'PATCH', body: { action: 'APPROVE' } },
    );
    expect(reviewed.status, 'approval should be accepted').toBe(200);
  }
}

/** Accept the live terms version the review screen reports. */
export async function acceptTerms(account: Account): Promise<void> {
  const review = await api<{ terms?: { version?: string } }>(
    account.jar,
    '/v1/me/provider/onboarding/review',
  );
  await patchStep(account.jar, 'CONSENT', {
    acceptedConsentVersion: review.body.terms?.version ?? 'v1',
  });
}

/**
 * Sign in through the REAL login screen — form, OTP screen and all.
 *
 * Not an API call, and not a cookie injected into the browser context: the
 * point is that the session carried into the onboarding journey is one the app
 * itself established.
 */
export async function loginViaUi(page: Page, account: Account): Promise<void> {
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  // The sign-in screen is not a <form>; the control is a plain button, so it
  // is addressed by its accessible name rather than by a submit type.
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/auth/login` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  expect(
    (await loginResponse).status(),
    `UI login should be accepted before waiting for OTP mail for ${account.email}`,
  ).toBe(200);

  const otpInput = page.getByTestId('otp-input');
  await otpInput.waitFor({ state: 'visible', timeout: 45_000 });
  await otpInput.fill(await otpFor(account.email));
  // Filling the boxes does not submit. That is deliberate in the product — a
  // six-digit input that fires on the sixth keystroke spends a provider's
  // attempt on a typo — so the journey has to press Confirm like a person.
  await page.getByRole('button', { name: 'Confirm' }).click();
}
