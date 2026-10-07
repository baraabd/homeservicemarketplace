import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// R17-D — Admin operations through the real AppModule: real password/OTP
// sessions, real JWT/Roles/Permissions/CSRF guards, real PostgreSQL and Redis.
// Nothing between the HTTP request and the database is stubbed.
//
// The harness is the dispute suites' real-AppModule harness: it is the
// repository's generic "boot the real app with synthetic accounts" fixture
// (`reviewer`, `independent` and `reader` hold the system `admin` role; the
// rest are ordinary accounts) and it holds the `seed` advisory lock
// EXCLUSIVELY, which is what makes temporarily editing the admin role's grants
// safe against concurrent suites.
//
// docs/production-readiness/r17/R17_D_ADMIN_OPERATIONS.md
const enabled = process.env.RUN_DB_INTEGRATION === '1';
(enabled ? describe : describe.skip)('R17-D admin operations over real HTTP', () => {
  jest.setTimeout(240_000);
  let h: DisputeHttpApp;
  type Session = Awaited<ReturnType<ReturnType<typeof httpSession>['login']>>;
  let admin: Session, otherAdmin: Session, seeker: Session;

  beforeAll(async () => {
    h = await disputeHttpApp();
    admin = await httpSession(h).login(h.fixture.users.reviewer);
    otherAdmin = await httpSession(h).login(h.fixture.users.independent);
    seeker = await httpSession(h).login(h.fixture.users.seeker);
  });
  afterAll(async () => {
    await h?.dispose();
  });

  /** Restores one PlatformSetting row to exactly what it was. */
  async function preserveSetting(key: string) {
    const { db } = h.fixture;
    const before = await db.platformSetting.findUnique({ where: { key } });
    return async () => {
      if (before)
        await db.platformSetting.upsert({
          where: { key },
          create: { key, value: before.value as never, updatedBy: before.updatedBy },
          update: { value: before.value as never, updatedBy: before.updatedBy },
        });
      else await db.platformSetting.deleteMany({ where: { key } });
    };
  }

  const settingAudits = (key: string, since: Date) =>
    h.fixture.db.auditEvent.count({
      where: {
        type: 'ADMIN_SETTING_UPDATED',
        createdAt: { gte: since },
        metadata: { path: ['key'], equals: key },
      },
    });
  const historyRows = (key: string, since: Date) =>
    h.fixture.db.platformSettingHistory.count({ where: { key, changedAt: { gte: since } } });

  // ─── Settings authority (D-1, D-3, D-5) ───────────────────────────────

  it('D-1 the keyed PUT refuses unknown keys, wrong types, out-of-range values and invalid policy JSON', async () => {
    const { db } = h.fixture;
    const since = new Date();
    const restore = await preserveSetting('provider_onboarding_max_service_areas');
    const unknownKey = `${h.fixture.prefix}unknown-setting`;
    const intakeBefore = await db.platformSetting.findUnique({
      where: { key: 'disputes.self_service.intake' },
    });
    try {
      const unknown = await admin.request(`/v1/admin/settings/${encodeURIComponent(unknownKey)}`, {
        method: 'PUT',
        body: { value: { anything: true } },
      });
      expect(unknown.status).toBe(400);
      expect(await db.platformSetting.count({ where: { key: unknownKey } })).toBe(0);

      for (const value of ['lots', 100000, 0, 2.5, null]) {
        const bad = await admin.request(
          '/v1/admin/settings/provider_onboarding_max_service_areas',
          {
            method: 'PUT',
            body: { value },
          },
        );
        expect(bad.status).toBe(400);
      }
      const badPolicy = await admin.request('/v1/admin/settings/disputes.self_service.intake', {
        method: 'PUT',
        body: { value: { enabled: true } },
      });
      expect(badPolicy.status).toBe(400);
      expect(
        await db.platformSetting.findUnique({ where: { key: 'disputes.self_service.intake' } }),
      ).toEqual(intakeBefore);
      const badMarkets = await admin.request('/v1/admin/settings/platform_supported_markets', {
        method: 'PUT',
        body: { value: 'everywhere' },
      });
      expect(badMarkets.status).toBe(400);
      // No refused write left a trail.
      expect(await historyRows('provider_onboarding_max_service_areas', since)).toBe(0);
      expect(await settingAudits('provider_onboarding_max_service_areas', since)).toBe(0);

      // Positive control: a valid value for a registered key lands with one
      // history row and one audit row, through the same validator.
      const ok = await admin.request('/v1/admin/settings/provider_onboarding_max_service_areas', {
        method: 'PUT',
        body: { value: 21 },
      });
      expect(ok.status).toBe(200);
      expect(
        (
          await db.platformSetting.findUniqueOrThrow({
            where: { key: 'provider_onboarding_max_service_areas' },
          })
        ).value,
      ).toBe(21);
      expect(await historyRows('provider_onboarding_max_service_areas', since)).toBe(1);
      expect(await settingAudits('provider_onboarding_max_service_areas', since)).toBe(1);
    } finally {
      await restore();
    }
  });

  it('D-1 DELETE refuses keys outside the registry and leaves them untouched', async () => {
    const { db } = h.fixture;
    const key = `${h.fixture.prefix}orphan-setting`;
    await db.platformSetting.upsert({
      where: { key },
      create: { key, value: { keep: true } },
      update: { value: { keep: true } },
    });
    try {
      const removed = await admin.request(`/v1/admin/settings/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      expect(removed.status).toBe(400);
      expect(await db.platformSetting.count({ where: { key } })).toBe(1);
    } finally {
      await db.platformSetting.deleteMany({ where: { key } });
      await db.platformSettingHistory.deleteMany({ where: { key } });
    }
  });

  it('D-3 hostile property names select nothing, write nothing and pollute nothing', async () => {
    const { db } = h.fixture;
    const hostile = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];
    // No real setting can carry these names; clear any a pre-fix run wrote,
    // so the zero-row assertions below are about THIS run.
    await db.platformSetting.deleteMany({ where: { key: { in: hostile } } });
    for (const key of hostile) {
      const put = await admin.request(`/v1/admin/settings/${key}`, {
        method: 'PUT',
        body: { value: 1 },
      });
      expect(put.status).toBe(400);
      expect(await db.platformSetting.count({ where: { key } })).toBe(0);
      // JSON.parse keeps `__proto__` as an own property, exactly as the
      // server receives it from a raw JSON body.
      const authed = await admin.request('/v1/admin/settings', {
        method: 'PATCH',
        body: JSON.parse(`{"values":{"${key}":1}}`),
      });
      expect(authed.status).toBe(400);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'value')).toBe(false);
  });

  it('D-5 settings no product code reads are reported as not in effect and cannot be changed', async () => {
    const { db } = h.fixture;
    const since = new Date();
    const bulk = await admin.request<{
      schema: { key: string; inEffect?: boolean }[];
    }>('/v1/admin/settings');
    expect(bulk.status).toBe(200);
    const inert = [
      'platform_fee_bps',
      'default_currency',
      'support_email',
      'feature_show_hourly_rate',
    ];
    for (const key of inert)
      expect(bulk.body.schema.find((f) => f.key === key)?.inEffect).toBe(false);
    // Positive control: a consumed key is reported in effect.
    expect(
      bulk.body.schema.find((f) => f.key === 'provider_onboarding_max_service_areas')?.inEffect,
    ).toBe(true);
    for (const [key, value] of [
      ['platform_fee_bps', 500],
      ['default_currency', 'EUR'],
      ['feature_show_hourly_rate', true],
    ] as const) {
      const before = await db.platformSetting.findUnique({ where: { key } });
      const res = await admin.request('/v1/admin/settings', {
        method: 'PATCH',
        body: { values: { [key]: value } },
      });
      expect(res.status).toBe(400);
      expect(await db.platformSetting.findUnique({ where: { key } })).toEqual(before);
      expect(await historyRows(key, since)).toBe(0);
    }
  });

  it('D-2 a hostile e-mail value is refused promptly instead of stalling the API', async () => {
    // A trailing '@' defeats the match, which is what makes the old pattern
    // backtrack quadratically (about 8 s for this input on the baseline).
    const hostile = '!@!.' + '!.'.repeat(60_000) + '@';
    const restore = await preserveSetting('support_email');
    const started = Date.now();
    const res = await admin.request('/v1/admin/settings', {
      method: 'PATCH',
      body: { values: { support_email: hostile } },
    });
    const elapsed = Date.now() - started;
    expect(res.status).toBe(400);
    // The quadratic regex took several seconds on this input; a bounded
    // check answers in well under one.
    expect(elapsed).toBeLessThan(1500);
    await restore();
  });

  it('A4/A6 a setting write whose COMMIT is rejected stores no value, history or audit; a retry lands once', async () => {
    const { db } = h.fixture;
    const key = 'provider_onboarding_max_specialties';
    const restore = await preserveSetting(key);
    const since = new Date();
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION r17d_setting_commit_trap() RETURNS trigger AS $$
      BEGIN
        IF NEW."key" = '${key}' THEN
          RAISE EXCEPTION 'r17d: rejected at commit' USING ERRCODE = 'P0001';
        END IF;
        RETURN NULL;
      END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER r17d_setting_commit_trap_t
      AFTER INSERT ON "PlatformSettingHistory" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION r17d_setting_commit_trap()`);
    const before = await db.platformSetting.findUnique({ where: { key } });
    try {
      let failed: Awaited<ReturnType<Session['request']>>;
      try {
        failed = await admin.request('/v1/admin/settings', {
          method: 'PATCH',
          body: { values: { [key]: 14 } },
        });
      } finally {
        await db.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS r17d_setting_commit_trap_t ON "PlatformSettingHistory"',
        );
        await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS r17d_setting_commit_trap()');
      }
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(failed.body)).not.toMatch(/r17d|trigger|P0001|prisma/i);
      expect(await db.platformSetting.findUnique({ where: { key } })).toEqual(before);
      expect(await historyRows(key, since)).toBe(0);
      expect(await settingAudits(key, since)).toBe(0);
      const retry = await admin.request('/v1/admin/settings', {
        method: 'PATCH',
        body: { values: { [key]: 14 } },
      });
      expect(retry.status).toBe(200);
      expect(await historyRows(key, since)).toBe(1);
      expect(await settingAudits(key, since)).toBe(1);
    } finally {
      await restore();
    }
  });

  // ─── User status authority (D-4) ──────────────────────────────────────

  async function withoutAdminGrant<T>(permission: string, fn: () => Promise<T>): Promise<T> {
    const { db } = h.fixture;
    const grant = await db.rolePermission.findFirstOrThrow({
      where: { role: { name: 'admin' }, permission: { key: permission } },
    });
    await db.rolePermission.delete({
      where: { roleId_permissionId: { roleId: grant.roleId, permissionId: grant.permissionId } },
    });
    try {
      return await fn();
    } finally {
      await db.rolePermission.create({
        data: { roleId: grant.roleId, permissionId: grant.permissionId },
      });
    }
  }

  it('D-4 changing a user status needs the user-write permission, resolved fresh', async () => {
    const { db, users } = h.fixture;
    await withoutAdminGrant('user:write:any', async () => {
      for (const [path, method, body] of [
        [`/v1/admin/users/${users.outsider}/status`, 'PATCH', { status: 'SUSPENDED' }],
        [`/v1/admin/users/${users.outsider}/suspend`, 'POST', undefined],
        [`/v1/admin/users/${users.outsider}/restore`, 'POST', undefined],
      ] as const) {
        const res = await admin.request(path, { method, body });
        expect(res.status).toBe(403);
      }
    });
    const target = await db.user.findUniqueOrThrow({ where: { id: users.outsider } });
    expect(target.status).toBe('ACTIVE');
    expect(target.isActive).toBe(true);
  });

  it('D-4 suspension revokes live sessions at once, repeats safely, and audits ids rather than free text', async () => {
    const { db, users } = h.fixture;
    const target = await httpSession(h).login(users.outsider);
    expect((await target.request('/v1/auth/me')).status).toBe(200);
    const since = new Date();
    const first = await admin.request(`/v1/admin/users/${users.outsider}/status`, {
      method: 'PATCH',
      body: { status: 'SUSPENDED', reason: 'Private note about this person' },
    });
    expect(first.status).toBe(200);
    // The very next request with the old session is refused.
    expect((await target.request('/v1/auth/me')).status).toBe(401);
    const again = await admin.request(`/v1/admin/users/${users.outsider}/status`, {
      method: 'PATCH',
      body: { status: 'SUSPENDED' },
    });
    expect(again.status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: users.outsider } });
    expect(row.status).toBe('SUSPENDED');
    const audits = await db.auditEvent.findMany({
      where: {
        type: 'ADMIN_USER_SUSPENDED',
        createdAt: { gte: since },
        metadata: { path: ['targetUserId'], equals: users.outsider },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain('Private note');
    expect(audits[0].metadata).toMatchObject({
      previousStatus: 'ACTIVE',
      targetStatus: 'SUSPENDED',
    });
    expect(audits[1].metadata).toMatchObject({
      previousStatus: 'SUSPENDED',
      targetStatus: 'SUSPENDED',
    });
    const restored = await admin.request(`/v1/admin/users/${users.outsider}/status`, {
      method: 'PATCH',
      body: { status: 'ACTIVE' },
    });
    expect(restored.status).toBe(200);
    // Restoring does not resurrect the revoked session.
    expect((await target.request('/v1/auth/me')).status).toBe(401);
  });

  it('D-4 two admins changing one user at once leave a consistent final state and audit chain', async () => {
    const { db, users } = h.fixture;
    const since = new Date();
    const [a, b] = await Promise.all([
      admin.request(`/v1/admin/users/${users.provider}/status`, {
        method: 'PATCH',
        body: { status: 'SUSPENDED' },
      }),
      otherAdmin.request(`/v1/admin/users/${users.provider}/status`, {
        method: 'PATCH',
        body: { status: 'LOCKED' },
      }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const audits = await db.auditEvent.findMany({
      where: {
        type: 'ADMIN_USER_SUSPENDED',
        createdAt: { gte: since },
        metadata: { path: ['targetUserId'], equals: users.provider },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(audits).toHaveLength(2);
    const [first, second] = audits.map((x) => x.metadata as Record<string, string>);
    // Each change is based on the state the previous one left.
    expect(first.previousStatus).toBe('ACTIVE');
    expect(second.previousStatus).toBe(first.targetStatus);
    const row = await db.user.findUniqueOrThrow({ where: { id: users.provider } });
    expect(row.status).toBe(second.targetStatus);
    expect(row.isActive).toBe(false);
    await admin.request(`/v1/admin/users/${users.provider}/status`, {
      method: 'PATCH',
      body: { status: 'ACTIVE' },
    });
  });

  // ─── Analytics honesty (D-6) ──────────────────────────────────────────
  //
  // Deterministic synthetic bookings in two ISO test currencies (XTS, XXX)
  // that no real data uses, on fixed January-2026 UTC instants that straddle
  // a day boundary. Expected values are written out here, not computed by
  // the code under test.

  async function analyticsFixture() {
    const { db, users, prefix } = h.fixture;
    const profile = await db.providerProfile.findFirstOrThrow({
      where: { userId: users.provider },
    });
    const make = async (
      tag: string,
      currency: string,
      priceAmount: number,
      status: 'COMPLETED' | 'CANCELLED',
      event: { type: 'BOOKING_STATUS_CHANGED' | 'BOOKING_CANCELLED'; at: string } | null,
      updatedAt: string,
    ) => {
      const id = `${prefix}r17d-${tag}`;
      await db.serviceRequest.create({
        data: {
          id: `${id}-request`,
          seekerUserId: users.seeker,
          scheduleType: 'ASAP',
          addressSnapshot: {},
          status: 'COMPLETED',
        },
      });
      await db.bid.create({
        data: {
          id: `${id}-bid`,
          requestId: `${id}-request`,
          providerId: profile.id,
          amount: priceAmount,
          pricingType: 'FIXED',
          status: 'ACCEPTED',
        },
      });
      await db.booking.create({
        data: {
          id,
          requestId: `${id}-request`,
          bidId: `${id}-bid`,
          seekerUserId: users.seeker,
          providerId: profile.id,
          priceAmount,
          currency,
          status,
        },
      });
      if (event)
        await db.bookingEvent.create({
          data: {
            bookingId: id,
            type: event.type,
            metadata:
              event.type === 'BOOKING_STATUS_CHANGED'
                ? { from: 'IN_PROGRESS', to: 'COMPLETED' }
                : { reason: 'synthetic' },
            createdAt: new Date(event.at),
          },
        });
      // A later unrelated edit: `updatedAt` is NOT when the booking completed.
      await db.$executeRawUnsafe(
        `UPDATE "Booking" SET "updatedAt" = '${updatedAt}' WHERE "id" = '${id}'`,
      );
    };
    const changed = (at: string) => ({ type: 'BOOKING_STATUS_CHANGED' as const, at });
    await make(
      'xts-a',
      'XTS',
      1000,
      'COMPLETED',
      changed('2026-01-10T23:30:00Z'),
      '2026-02-01T00:00:00Z',
    );
    await make(
      'xts-b',
      'XTS',
      500,
      'COMPLETED',
      changed('2026-01-11T00:10:00Z'),
      '2026-02-01T00:00:00Z',
    );
    await make(
      'xxx-a',
      'XXX',
      700,
      'COMPLETED',
      changed('2026-01-10T12:00:00Z'),
      '2026-02-01T00:00:00Z',
    );
    await make('xts-undated', 'XTS', 300, 'COMPLETED', null, '2026-01-10T12:00:00Z');
    await make(
      'xts-cancelled',
      'XTS',
      900,
      'CANCELLED',
      { type: 'BOOKING_CANCELLED', at: '2026-01-10T08:00:00Z' },
      '2026-02-01T00:00:00Z',
    );
  }

  it('D-6 analytics separate currencies, date completions by their real event and never invent fees', async () => {
    await analyticsFixture();
    type Overview = {
      revenue: {
        grossWithinRange: number | null;
        grossLifetime: number | null;
        platformFeesWithinRange: number | null;
        netProviderEarningsWithinRange: number | null;
      };
      revenueByCurrency: {
        currency: string;
        bookedValueWithinRange: number;
        completedWithinRange: number;
        bookedValueLifetime: number;
      }[];
      currency: string | null;
      platformFeeRateBps: number | null;
      feeStatus: string;
    };
    const res = await admin.request<Overview>(
      '/v1/admin/analytics/overview?from=2026-01-10&to=2026-01-11',
    );
    expect(res.status).toBe(200);
    const o = res.body;
    const xts = o.revenueByCurrency.find((r) => r.currency === 'XTS');
    const xxx = o.revenueByCurrency.find((r) => r.currency === 'XXX');
    // Completed by the BOOKING_STATUS_CHANGED → COMPLETED event, inside the
    // inclusive UTC range; `updatedAt` (February) is irrelevant.
    expect(xts).toMatchObject({ bookedValueWithinRange: 1500, completedWithinRange: 2 });
    expect(xxx).toMatchObject({ bookedValueWithinRange: 700, completedWithinRange: 1 });
    // Lifetime includes the completion that has no dated event.
    expect(xts!.bookedValueLifetime).toBe(1800);
    // Two currencies in range: there is no honest single total.
    expect(o.revenue.grossWithinRange).toBeNull();
    expect(o.revenue.grossLifetime).toBeNull();
    expect(o.currency).toBeNull();
    // No fee is approved or charged (R16 P10): not computed, not zero.
    expect(o.revenue.platformFeesWithinRange).toBeNull();
    expect(o.revenue.netProviderEarningsWithinRange).toBeNull();
    expect(o.platformFeeRateBps).toBeNull();
    expect(o.feeStatus).toBe('NOT_APPROVED');

    type Revenue = {
      series: {
        currency: string;
        buckets: { date: string; bookedValue: number; completedBookings: number }[];
      }[];
      buckets: { platformFees: number | null; netProviderEarnings: number | null }[];
    };
    const daily = await admin.request<Revenue>(
      '/v1/admin/analytics/revenue?from=2026-01-10&to=2026-01-11',
    );
    expect(daily.status).toBe(200);
    const xtsDays = daily.body.series.find((s) => s.currency === 'XTS')!.buckets;
    // 23:30Z on the 10th stays on the 10th; 00:10Z on the 11th is the 11th.
    expect(xtsDays).toEqual([
      { date: '2026-01-10', bookedValue: 1000, completedBookings: 1 },
      { date: '2026-01-11', bookedValue: 500, completedBookings: 1 },
    ]);
    expect(daily.body.series.find((s) => s.currency === 'XXX')!.buckets).toEqual([
      { date: '2026-01-10', bookedValue: 700, completedBookings: 1 },
      { date: '2026-01-11', bookedValue: 0, completedBookings: 0 },
    ]);
    for (const b of daily.body.buckets) {
      expect(b.platformFees).toBeNull();
      expect(b.netProviderEarnings).toBeNull();
    }
  });

  // ─── Audit and notifications (D-7 evidence) ───────────────────────────

  it('A16 the audit log pages past 50 in stable order and redacts secrets', async () => {
    const { db, users } = h.fixture;
    const base = Date.parse('2026-03-01T00:00:00Z');
    await db.auditEvent.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        userId: users.reader,
        type: 'ADMIN_SETTING_UPDATED' as const,
        // Every tenth row shares a timestamp with its neighbour: the id breaks the tie.
        createdAt: new Date(base + Math.floor(i / 2) * 1000),
        metadata: { key: `r17d-${i}`, password: 'not-for-display', note: 'synthetic' },
      })),
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<Session['request']>> = await admin.request(
        `/v1/admin/audit-logs?actor=${users.reader}&limit=50${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(page.status).toBe(200);
      const body = page.body as {
        items: { id: string; metadata: Record<string, unknown> }[];
        nextCursor: string | null;
      };
      for (const item of body.items) {
        expect(item.metadata.password).toBe('<redacted>');
        seen.push(item.id);
      }
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
  });

  it('A15 the admin inbox and its unread count come from the server, scoped to the admin experience', async () => {
    const { db, users } = h.fixture;
    await db.notification.createMany({
      data: [
        {
          userId: users.reviewer,
          type: 'SYSTEM',
          title: 'a',
          body: 'a',
          deepLink: '/admin/disputes',
        },
        { userId: users.reviewer, type: 'SYSTEM', title: 'b', body: 'b', deepLink: '/admin/users' },
        {
          userId: users.reviewer,
          type: 'SYSTEM',
          title: 'c',
          body: 'c',
          deepLink: '/home/bookings',
        },
      ],
    });
    const count = await admin.request<{ count: number }>(
      '/v1/me/notifications/unread-count?experience=admin',
    );
    expect(count.status).toBe(200);
    expect(count.body.count).toBe(2);
    const list = await admin.request<{ items: { deepLink: string }[] }>(
      '/v1/admin/notifications?unread=true',
    );
    expect(list.status).toBe(200);
    expect(list.body.items.map((n) => n.deepLink).sort()).toEqual([
      '/admin/disputes',
      '/admin/users',
    ]);
  });

  // ─── Authorization (A17/A18) ─────────────────────────────────────────

  it('A17/A18 non-admins, anonymous callers and revoked sessions are refused on every admin surface', async () => {
    const paths = [
      '/v1/admin/users',
      '/v1/admin/settings',
      '/v1/admin/settings/provider_onboarding_max_service_areas/history',
      '/v1/admin/analytics/overview',
      '/v1/admin/analytics/revenue',
      '/v1/admin/audit-logs',
      '/v1/admin/notifications',
    ];
    for (const path of paths) {
      expect((await httpSession(h).request(path)).status).toBe(401);
      expect((await seeker.request(path)).status).toBe(403);
      expect((await admin.request(path)).status).toBe(200);
    }
    const doomed = await httpSession(h).login(h.fixture.users.independent);
    expect((await doomed.request('/v1/admin/users')).status).toBe(200);
    expect((await otherAdmin.request('/v1/auth/logout-all', { method: 'POST' })).status).toBe(204);
    for (const path of paths) expect((await doomed.request(path)).status).toBe(401);
  });
});
