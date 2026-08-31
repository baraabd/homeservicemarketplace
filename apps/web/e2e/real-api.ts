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
  return draft.body.version;
}

async function patchStep(jar: Jar, step: string, body: Record<string, unknown>): Promise<void> {
  const version = await currentVersion(jar);
  const res = await api(jar, `/v1/me/provider/onboarding/steps/${step}`, {
    method: 'PATCH',
    body: { version, ...body },
  });
  expect(res.status, `PATCH ${step} should be accepted: ${JSON.stringify(res.body)}`).toBe(200);
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

  if (!skip.has('PROVIDER_TYPE'))
    await patchStep(jar, 'PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
  if (!skip.has('IDENTITY'))
    await patchStep(jar, 'IDENTITY', {
      displayName: 'Layla Mansour',
      phoneNumber: '+963900000444',
    });
  if (!skip.has('LOCATION'))
    await patchStep(jar, 'LOCATION', {
      serviceAreaCity: 'Damascus',
      serviceAreaCountry: 'Syria',
      serviceAreaCountryCode: 'SY',
      serviceAreaRadiusKm: 20,
    });
  if (!skip.has('SPECIALTIES'))
    await patchStep(jar, 'SPECIALTIES', {
      specialtyLeafIds: [leaf!.id],
      primarySpecialtyId: leaf!.id,
    });
  if (!skip.has('EXPERIENCE')) await patchStep(jar, 'EXPERIENCE', { yearsOfExperience: 5 });
  if (!skip.has('AVAILABILITY'))
    // A timezone must exist before a weekly window can be stored: the server
    // refuses the write otherwise, because minutes-from-midnight mean nothing
    // without one.
    await patchStep(jar, 'AVAILABILITY', {
      timezone: 'Asia/Damascus',
      availability: [
        { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
        { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
      ],
    });
  if (!skip.has('PROFILE'))
    await patchStep(jar, 'PROFILE', {
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

async function adminJar(): Promise<Jar> {
  if (!adminSession) {
    // One retry, for the backstop case above only. Not a blanket retry: a
    // failure for any other reason fails again immediately and is reported.
    adminSession = signInAsAdmin().catch(() => signInAsAdmin());
  }
  return adminSession;
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
  await page.getByRole('button', { name: 'Log In', exact: true }).click();

  const otpInput = page.getByTestId('otp-input');
  await otpInput.waitFor({ state: 'visible', timeout: 45_000 });
  await otpInput.fill(await otpFor(account.email));
  // Filling the boxes does not submit. That is deliberate in the product — a
  // six-digit input that fires on the sixth keystroke spends a provider's
  // attempt on a typo — so the journey has to press Confirm like a person.
  await page.getByRole('button', { name: 'Confirm' }).click();
}
