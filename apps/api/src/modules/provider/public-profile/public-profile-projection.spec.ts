import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CURRENT_PUBLICATION_ACK_VERSION,
  LEGACY_PUBLICATION_ACK_TEXT,
  PUBLICATION_ACK_WORDINGS,
  isCurrentPublicationAckVersion,
  publicationAckWording,
} from '@homeservicemarketplace/contracts';

import { buildPublicProfile, type PublicProfileSource } from './public-profile-projection';

// Sprint 9B.22 — what a customer may see, and what they must never.
//
// docs/sprint-09b22/PUBLIC_PROFILE_AND_PORTFOLIO.md
//
// The behavioural tests below are the ordinary half. The STRUCTURAL ones are
// the half that keeps working: a test of what one function returns today passes
// forever while a field added tomorrow publishes a phone number. So the shape
// of the public contract is asserted directly, the way Sprint 9B.19 asserts the
// location-privacy boundary.

function source(over: Partial<PublicProfileSource> = {}): PublicProfileSource {
  return {
    displayName: 'Ada Lovelace Services',
    initials: 'AL',
    avatarUrl: '/v1/media/files/avatars/ref/a.jpg',
    headline: 'Certified electrician',
    bio: 'I handle residential and light commercial electrical work.',
    serviceAreaCity: 'Damascus',
    serviceAreaCountry: 'Syria',
    ratingAvg: 4.8,
    reviewCount: 12,
    completedJobs: 30,
    verified: true,
    approvedPortfolio: [],
    approvedServices: ['Fault finding'],
    ...over,
  };
}

describe('the public projection publishes exactly what it is given', () => {
  it('carries the provider’s own words and standing', () => {
    const profile = buildPublicProfile(source());
    expect(profile).toEqual({
      displayName: 'Ada Lovelace Services',
      initials: 'AL',
      avatarUrl: '/v1/media/files/avatars/ref/a.jpg',
      about: {
        headline: 'Certified electrician',
        bio: 'I handle residential and light commercial electrical work.',
      },
      area: { city: 'Damascus', country: 'Syria' },
      standing: { ratingAvg: 4.8, reviewCount: 12, completedJobs: 30, verified: true },
      portfolio: [],
      services: ['Fault finding'],
    });
  });

  it('rounds the rating to the precision the product displays', () => {
    // An un-rounded float is a fingerprint: 4.833333333333333 identifies a
    // provider far more precisely than "4.8", and nothing public needs it.
    const profile = buildPublicProfile(source({ ratingAvg: 4.833333333333333 }));
    expect(profile.standing.ratingAvg).toBe(4.8);
  });

  it('treats blank as absent, so nothing renders as an empty line', () => {
    const profile = buildPublicProfile(
      source({ headline: '   ', bio: '', serviceAreaCity: ' ', serviceAreaCountry: null }),
    );
    expect({ about: profile.about, area: profile.area }).toEqual({
      about: { headline: null, bio: null },
      area: { city: null, country: null },
    });
  });

  it('trims what it does publish', () => {
    const profile = buildPublicProfile(source({ headline: '  Electrician  ' }));
    expect(profile.about.headline).toBe('Electrician');
  });

  it('copies portfolio images as url, title and description — nothing else', () => {
    const profile = buildPublicProfile(
      source({
        approvedPortfolio: [
          { url: '/v1/media/files/portfolio/ref/a.jpg', title: 'Rewire', description: null },
        ],
      }),
    );
    expect(profile.portfolio).toEqual([
      { url: '/v1/media/files/portfolio/ref/a.jpg', title: 'Rewire', description: null },
    ]);
    expect(Object.keys(profile.portfolio[0]!).sort()).toEqual(['description', 'title', 'url']);
  });

  it('does not alias the caller’s arrays', () => {
    // A returned array that shares identity with the source is a mutation
    // channel back into whatever the caller held.
    const services = ['Fault finding'];
    const profile = buildPublicProfile(source({ approvedServices: services }));
    expect(profile.services).not.toBe(services);
  });

  it('publishes exactly six top-level keys, so a new one is a deliberate act', () => {
    expect(Object.keys(buildPublicProfile(source())).sort()).toEqual([
      'about',
      'area',
      'avatarUrl',
      'displayName',
      'initials',
      'portfolio',
      'services',
      'standing',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURAL — the guarantee that survives code nobody re-reads.
// ─────────────────────────────────────────────────────────────────────────────

/** The contract source, read as text. Asserting on the DECLARATION is what
 *  makes this a claim about every response rather than about one fixture. */
function contractSource(): string {
  return readFileSync(
    join(__dirname, '../../../../../../packages/contracts/src/provider/public-profile/index.ts'),
    'utf8',
  );
}

/** Only the interface bodies — the prose above them names these fields in order
 *  to say they are excluded, and matching that would be matching the comment
 *  rather than the type. */
function declaredFields(text: string): string {
  return text
    .split('\n')
    .filter((line) => /^\s{2}\w+[?]?:/.test(line))
    .join('\n');
}

describe('the public contract has nowhere to put a private fact', () => {
  it.each([
    ['phoneNumber', 'a contact detail the platform exists to mediate'],
    ['phoneVerifiedAt', 'implies the number itself'],
    ['email', 'a contact detail'],
    ['userId', 'a raw internal identifier, correlatable across surfaces'],
    ['providerProfileId', 'the same'],
    ['serviceAreaLat', 'an exact coordinate — usually a home'],
    ['serviceAreaLng', 'an exact coordinate'],
    ['serviceAreaRadiusKm', 'operational, and narrows where they live'],
    ['workshopAddressLine', 'an exact address'],
    ['workshopLat', 'an exact coordinate'],
    ['storageKey', 'a storage key is a capability in this system'],
    ['mediaAssetId', 'an internal id for a file'],
    ['moderationState', 'an internal review state'],
    ['moderationReason', 'reviewer text'],
    ['reviewNotes', 'admin-only'],
    ['rejectionReason', 'admin-only'],
    ['legalBusinessName', 'not published; displayName is the public name'],
    ['additionalInformation', 'a free-text note to the reviewer, not to customers'],
  ])('declares no %s field (%s)', (field) => {
    expect(declaredFields(contractSource())).not.toMatch(new RegExp(`\\b${field}\\b`));
  });

  it('names every field the projection is allowed to READ, and no more', () => {
    // The input type is an allowlist too. A caller cannot hand this function a
    // phone number, because there is no field for one — which is what makes the
    // guarantee readable in thirty lines instead of auditable across every
    // query that touches a provider row.
    const projection = readFileSync(join(__dirname, 'public-profile-projection.ts'), 'utf8');
    const inputBody = projection.slice(
      projection.indexOf('export interface PublicProfileSource'),
      projection.indexOf('export function buildPublicProfile'),
    );
    for (const forbidden of [
      'phoneNumber',
      'userId',
      'serviceAreaLat',
      'serviceAreaLng',
      'serviceAreaRadiusKm',
      'workshopAddressLine',
      'storageKey',
    ]) {
      expect({ forbidden, present: new RegExp(`\\b${forbidden}\\b`).test(inputBody) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('builds the public url the same way the portfolio service does', () => {
    // Two files compose `/v1/media/files/<key>`. If they ever disagree, the
    // preview shows images that 404 while the gallery shows them fine.
    const portfolio = readFileSync(
      join(__dirname, '../portfolio/provider-portfolio.service.ts'),
      'utf8',
    );
    const publicProfile = readFileSync(
      join(__dirname, 'provider-public-profile.service.ts'),
      'utf8',
    );
    const pattern = /return `\/v1\/media\/files\/\$\{storageKey\}`;/;
    expect({ portfolio: pattern.test(portfolio), preview: pattern.test(publicProfile) }).toEqual({
      portfolio: true,
      preview: true,
    });
  });

  it('never spreads its source, which is how a new column publishes itself', () => {
    const projection = readFileSync(join(__dirname, 'public-profile-projection.ts'), 'utf8');
    const body = projection.slice(projection.indexOf('export function buildPublicProfile'));
    // The whole OBJECT, spread into the result — `...source,` or `...source}`.
    // `[...source.approvedServices]` is deliberately not matched: copying one
    // named array is the opposite of the hazard, and it is what stops the
    // result aliasing the caller's array.
    expect(body).not.toMatch(/\.\.\.source\s*[,}]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The publication-right acknowledgement.
// ─────────────────────────────────────────────────────────────────────────────

describe('the publication acknowledgement is versioned, not a bare checkbox', () => {
  it('has wording for the current version in both languages', () => {
    const wording = publicationAckWording(CURRENT_PUBLICATION_ACK_VERSION);
    expect(wording).not.toBeNull();
    expect(wording!.en.length).toBeGreaterThan(20);
    expect(wording!.ar.length).toBeGreaterThan(20);
  });

  it('says plainly that a customer’s home needs their permission', () => {
    // The whole point of the assertion. Wording that only says "I own this
    // photo" misses the case the column exists for.
    const wording = publicationAckWording(CURRENT_PUBLICATION_ACK_VERSION)!;
    expect(wording.en.toLowerCase()).toContain('permission');
    expect(wording.ar).toContain('إذن');
  });

  it('uses the sortable version format the rest of the platform uses', () => {
    expect(CURRENT_PUBLICATION_ACK_VERSION).toMatch(/^\d{4}\.\d{2}-[a-z0-9-]+-v\d+$/);
  });

  it('returns null for a version it does not know, rather than inventing words', () => {
    expect(publicationAckWording('2099.01-portfolio-ack-v9')).toBeNull();
    expect(publicationAckWording(LEGACY_PUBLICATION_ACK_TEXT)).toBeNull();
    expect(publicationAckWording(null)).toBeNull();
    expect(publicationAckWording(undefined)).toBeNull();
  });

  it('recognises only the current version as current', () => {
    expect(isCurrentPublicationAckVersion(CURRENT_PUBLICATION_ACK_VERSION)).toBe(true);
    expect(isCurrentPublicationAckVersion('2026.01-portfolio-ack-v0')).toBe(false);
    expect(isCurrentPublicationAckVersion(LEGACY_PUBLICATION_ACK_TEXT)).toBe(false);
    expect(isCurrentPublicationAckVersion(true)).toBe(false);
    expect(isCurrentPublicationAckVersion(undefined)).toBe(false);
  });

  it('keeps every published wording, so an old record stays readable', () => {
    // Append-only. Editing an entry rewrites what past providers are recorded
    // as having agreed to, which is the thing the table exists to prevent.
    expect(Object.keys(PUBLICATION_ACK_WORDINGS)).toContain(CURRENT_PUBLICATION_ACK_VERSION);
    expect(Object.isFrozen(PUBLICATION_ACK_WORDINGS)).toBe(true);
  });
});
