/* eslint-disable @typescript-eslint/no-require-imports --
 * The Prisma client is required LAZILY inside beforeAll on purpose: with
 * RUN_DB_INTEGRATION unset this spec is skipped, and a top-level import would
 * still load the generated client and open its pool on every hermetic run.
 * The sibling integration specs use the same pattern.
 */

export {};

import { fixturePrefix } from '../support/db-isolation';

// Sprint 9B.22 — what a customer actually receives, against a REAL Postgres.
//
// docs/sprint-09b22/PUBLIC_PROFILE_AND_PORTFOLIO.md
//
// The projection has an exhaustive unit suite and a structural one. What is
// left over — and what is here — is the half that needs real rows:
//
//   * a RESTRICTED evidence asset can never surface as a portfolio image, even
//     when a row is forced to point at one. This is the crossover the whole
//     portfolio design exists to prevent, and the only honest way to test it is
//     to build the forbidden row and prove the read refuses it.
//   * only APPROVED items are published. Nothing on this platform approves one,
//     so today that is an empty gallery and an honest count — not a preview
//     that quietly shows unreviewed photos of customers' homes.
//   * one provider's gallery never reaches another's preview.
//   * the SERIALISED response contains no phone number, coordinate, storage
//     key or internal id — asserted over the whole JSON, not field by field.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('Sprint 9B.22 public profile preview (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let service: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('public-profile-preview');
  const USER_ID = `${P}user`;
  const PROFILE_ID = `${P}profile`;
  const OTHER_USER_ID = `${P}other-user`;
  const OTHER_PROFILE_ID = `${P}other-profile`;

  /** The private facts that must never reach a customer. Written onto the
   *  fixture precisely so the response can be searched for them. */
  const PHONE = '+963991234567';
  const LAT = 33.51378;
  const LNG = 36.29234;
  const WORKSHOP = '12 Baghdad Street, Damascus';

  async function cleanup(): Promise<void> {
    await prisma.providerPortfolioItem.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.mediaAsset.deleteMany({ where: { storageKey: { startsWith: P } } });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { startsWith: P } } });
  }

  async function makeAsset(
    suffix: string,
    visibility: 'PUBLIC' | 'RESTRICTED',
    ownerUserId = USER_ID,
  ): Promise<string> {
    const asset = await prisma.mediaAsset.create({
      data: {
        visibility,
        storageKey: `${P}${suffix}`,
        declaredMimeType: 'image/jpeg',
        sizeBytes: 1024,
        ownerUserId,
        uploadCompletedAt: new Date(),
      },
      select: { id: true },
    });
    return asset.id as string;
  }

  async function makeItem(
    providerProfileId: string,
    mediaAssetId: string,
    moderationState: 'PENDING' | 'APPROVED' | 'REJECTED',
    over: Record<string, unknown> = {},
  ): Promise<void> {
    await prisma.providerPortfolioItem.create({
      data: {
        providerProfileId,
        mediaAssetId,
        moderationState,
        title: 'Rewire',
        description: 'A full rewire.',
        publicationRightAckAt: new Date(),
        publicationRightAckText: '2026.09-portfolio-ack-v1',
        position: 0,
        ...over,
      },
    });
  }

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const {
      ProviderPublicProfileService,
    } = require('../../src/modules/provider/public-profile/provider-public-profile.service');
    service = new ProviderPublicProfileService({ client: prisma, isReady: () => true });

    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();

    await prisma.serviceCategory.create({
      data: {
        id: `${P}leaf`,
        slug: `${P}leaf`,
        labelEn: 'Fault finding',
        labelAr: 'كشف الأعطال',
        icon: 'zap',
        isLeaf: true,
        isActive: true,
      },
    });

    for (const [userId, profileId, name] of [
      [USER_ID, PROFILE_ID, 'Ada Lovelace Services'],
      [OTHER_USER_ID, OTHER_PROFILE_ID, 'Someone Else'],
    ] as const) {
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          passwordHash: 'x',
          firstName: 'A',
          lastName: 'B',
        },
      });
      await prisma.providerProfile.create({
        data: {
          id: profileId,
          userId,
          displayName: name,
          initials: 'AL',
          status: 'DRAFT',
          headline: 'Certified electrician',
          bio: 'I handle residential and light commercial electrical work.',
          // Everything below is PRIVATE and must not appear in the response.
          phoneNumber: PHONE,
          serviceAreaCity: 'Damascus',
          serviceAreaCountry: 'Syria',
          serviceAreaLat: LAT,
          serviceAreaLng: LNG,
          serviceAreaRadiusKm: 25,
          workshopAddressLine: WORKSHOP,
          additionalInformation: 'Please call before 9am.',
          reviewNotes: 'internal reviewer note',
          ratingAvg: 4.833333333333333,
          reviewCount: 12,
          completedJobs: 30,
          verified: true,
        },
      });
    }

    await prisma.providerProfileServiceCategory.create({
      data: { providerProfileId: PROFILE_ID, serviceCategoryId: `${P}leaf` },
    });
  });

  // ── the boundary that matters most ───────────────────────────────────────

  describe('restricted evidence can never surface as portfolio media', () => {
    it('refuses to publish an item pointing at a RESTRICTED asset', async () => {
      // Forced directly into the database, bypassing the create route that
      // would refuse it on the storage key. The point is that the READ refuses
      // it too — the path that would actually publish the file.
      const evidence = await makeAsset('verification/case/id-card.jpg', 'RESTRICTED');
      await makeItem(PROFILE_ID, evidence, 'APPROVED');

      const result = await service.preview(USER_ID, 'en');

      expect(result.profile.portfolio).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('id-card');
    });

    it('publishes a PUBLIC asset beside it, so the filter is the visibility and not the count', async () => {
      const evidence = await makeAsset('verification/case/id-card.jpg', 'RESTRICTED');
      const gallery = await makeAsset('portfolio/ref/work.jpg', 'PUBLIC');
      await makeItem(PROFILE_ID, evidence, 'APPROVED', { position: 0 });
      await makeItem(PROFILE_ID, gallery, 'APPROVED', { position: 1 });

      const result = await service.preview(USER_ID, 'en');

      expect(result.profile.portfolio).toHaveLength(1);
      expect(result.profile.portfolio[0].url).toContain('portfolio/ref/work.jpg');
    });
  });

  // ── moderation, honestly ─────────────────────────────────────────────────

  describe('only reviewed images are public', () => {
    it('publishes nothing while every image is awaiting review', async () => {
      const asset = await makeAsset('portfolio/ref/a.jpg', 'PUBLIC');
      await makeItem(PROFILE_ID, asset, 'PENDING');

      const result = await service.preview(USER_ID, 'en');

      expect({
        portfolio: result.profile.portfolio,
        awaiting: result.awaitingReviewCount,
      }).toEqual({ portfolio: [], awaiting: 1 });
    });

    it('does not publish a REJECTED image, and does not count it as waiting', async () => {
      const asset = await makeAsset('portfolio/ref/b.jpg', 'PUBLIC');
      await makeItem(PROFILE_ID, asset, 'REJECTED');

      const result = await service.preview(USER_ID, 'en');
      expect({
        portfolio: result.profile.portfolio,
        awaiting: result.awaitingReviewCount,
      }).toEqual({ portfolio: [], awaiting: 0 });
    });

    it('reports that no review workflow exists, rather than implying a queue', async () => {
      // Nothing on this platform writes APPROVED. The screen has to say so.
      const result = await service.preview(USER_ID, 'en');
      expect({
        moderation: result.moderationReviewAvailable,
        publicRoute: result.publicProfileRouteAvailable,
      }).toEqual({ moderation: false, publicRoute: false });
    });

    it('ignores a soft-deleted item entirely', async () => {
      const asset = await makeAsset('portfolio/ref/c.jpg', 'PUBLIC');
      await makeItem(PROFILE_ID, asset, 'APPROVED', { deletedAt: new Date() });

      const result = await service.preview(USER_ID, 'en');
      expect(result.profile.portfolio).toEqual([]);
    });
  });

  // ── ownership ────────────────────────────────────────────────────────────

  describe('one provider never sees another in their own preview', () => {
    it('excludes another provider’s approved gallery', async () => {
      const mine = await makeAsset('portfolio/mine/a.jpg', 'PUBLIC');
      const theirs = await makeAsset('portfolio/theirs/b.jpg', 'PUBLIC', OTHER_USER_ID);
      await makeItem(PROFILE_ID, mine, 'APPROVED');
      await makeItem(OTHER_PROFILE_ID, theirs, 'APPROVED');

      const result = await service.preview(USER_ID, 'en');
      expect(result.profile.portfolio.map((p: { url: string }) => p.url)).toEqual([
        expect.stringContaining('portfolio/mine/a.jpg'),
      ]);
    });

    it('404s for a user with no provider profile rather than returning an empty one', async () => {
      await expect(service.preview(`${P}nobody`, 'en')).rejects.toMatchObject({ status: 404 });
    });
  });

  // ── the disclosure check, over the whole response ────────────────────────

  describe('the serialised response carries nothing private', () => {
    it.each([
      ['the phone number', PHONE],
      ['the latitude', String(LAT)],
      ['the longitude', String(LNG)],
      ['the workshop address', WORKSHOP],
      ['the reviewer note', 'internal reviewer note'],
      ['the note meant for the reviewer', 'Please call before 9am.'],
      ['the raw user id', USER_ID],
      ['the raw profile id', PROFILE_ID],
    ])('does not contain %s', async (_name, secret) => {
      const asset = await makeAsset('portfolio/ref/a.jpg', 'PUBLIC');
      await makeItem(PROFILE_ID, asset, 'APPROVED');

      const body = JSON.stringify(await service.preview(USER_ID, 'en'));
      expect({ secret, leaked: body.includes(secret) }).toEqual({ secret, leaked: false });
    });

    it('does not contain the service radius', async () => {
      // Checked separately: "25" is short enough to appear inside an unrelated
      // number, so the assertion is on the FIELD rather than the substring.
      const body = JSON.parse(JSON.stringify(await service.preview(USER_ID, 'en')));
      expect(JSON.stringify(body)).not.toMatch(/radius/i);
    });

    it('publishes the city and country, which are the agreed granularity', async () => {
      const result = await service.preview(USER_ID, 'en');
      expect(result.profile.area).toEqual({ city: 'Damascus', country: 'Syria' });
    });

    it('rounds the rating rather than publishing a fingerprint', async () => {
      const result = await service.preview(USER_ID, 'en');
      expect(result.profile.standing.ratingAvg).toBe(4.8);
      expect(JSON.stringify(result)).not.toContain('4.833333');
    });
  });

  // ── localisation ─────────────────────────────────────────────────────────

  describe('language', () => {
    it('returns Arabic specialty labels when asked', async () => {
      const result = await service.preview(USER_ID, 'ar');
      expect(result.profile.services).toEqual(['كشف الأعطال']);
    });

    it('returns English by default', async () => {
      const result = await service.preview(USER_ID, 'en');
      expect(result.profile.services).toEqual(['Fault finding']);
    });

    it('publishes only APPROVED leaf specialties', async () => {
      // A held category that is not a leaf is a group, and a group is not a
      // skill anyone is approved on.
      await prisma.serviceCategory.create({
        data: {
          id: `${P}group`,
          slug: `${P}group`,
          labelEn: 'Electrical',
          labelAr: 'كهرباء',
          icon: 'zap',
          isLeaf: false,
          isActive: true,
        },
      });
      await prisma.providerProfileServiceCategory.create({
        data: { providerProfileId: PROFILE_ID, serviceCategoryId: `${P}group` },
      });

      const result = await service.preview(USER_ID, 'en');
      expect(result.profile.services).toEqual(['Fault finding']);
    });
  });
});
