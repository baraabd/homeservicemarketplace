import { parsePolicyRequirements, PolicyPayloadError } from './policy-payload';

// Sprint 9B.2 — what a policy version is allowed to say.
//
// docs/adr/0010-policy-versioned-verification.md
//
// The `requirements` column is JSON so a new document kind needs no migration.
// The price of that is that nothing in the database constrains its shape, so
// this is the only thing standing between a typo in an admin request and a
// requirement set that either cannot be satisfied or silently demands nothing.
//
// Two failure modes are worse than a rejected publish and drive most of these
// rules:
//
//   UNSATISFIABLE  verification is required and no document is listed, so the
//                  provider can never finish. It looks like a stuck queue.
//   VACUOUS        verification is required and the list is empty-by-accident,
//                  which reads downstream as "nothing to check".
//
// Both are publication-time errors, which is the cheapest place to catch them.

const MAX = 10;

describe('a well-formed policy payload', () => {
  it('accepts a base policy that requires identity', () => {
    const parsed = parsePolicyRequirements(
      { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
      { categoryId: null, maxDocuments: MAX },
    );
    expect(parsed).toEqual({ documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true });
  });

  it('accepts a policy that requires no verification at all', () => {
    // Explicit rather than inferred from an empty list: "not required here" and
    // "nobody has configured this yet" are different facts, and only one is
    // safe to act on.
    const parsed = parsePolicyRequirements(
      { documents: [], verificationRequired: false },
      { categoryId: null, maxDocuments: MAX },
    );
    expect(parsed.verificationRequired).toBe(false);
    expect(parsed.documents).toEqual([]);
  });

  it('accepts a business policy naming several distinct documents', () => {
    const parsed = parsePolicyRequirements(
      {
        documents: ['BUSINESS_REGISTRATION', 'AUTHORIZED_REPRESENTATIVE_IDENTITY'],
        verificationRequired: true,
      },
      { categoryId: null, maxDocuments: MAX },
    );
    expect(parsed.documents).toHaveLength(2);
  });

  it('accepts a category policy that adds a licence', () => {
    const parsed = parsePolicyRequirements(
      { documents: ['CATEGORY_LICENSE'], verificationRequired: true },
      { categoryId: 'cat-electrical', maxDocuments: MAX },
    );
    expect(parsed.documents).toEqual(['CATEGORY_LICENSE']);
  });

  it('ignores unknown top-level keys rather than storing them', () => {
    // Forward compatibility in one direction only: an older API must not choke
    // on a newer field, but it must not persist something it cannot interpret
    // either, or the stored policy stops matching what the code enforces.
    const parsed = parsePolicyRequirements(
      { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true, futureField: 'x' },
      { categoryId: null, maxDocuments: MAX },
    );
    expect(parsed).not.toHaveProperty('futureField');
  });
});

describe('a payload that cannot be satisfied is refused at publish time', () => {
  it('refuses verificationRequired with no documents', () => {
    expect(() =>
      parsePolicyRequirements(
        { documents: [], verificationRequired: true },
        { categoryId: null, maxDocuments: MAX },
      ),
    ).toThrow(PolicyPayloadError);
  });

  it('names the reason as UNSATISFIABLE', () => {
    try {
      parsePolicyRequirements(
        { documents: [], verificationRequired: true },
        { categoryId: null, maxDocuments: MAX },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyPayloadError).code).toBe('UNSATISFIABLE');
    }
  });

  it('refuses documents on a policy that requires no verification', () => {
    // Listing documents that nothing will ever ask for is a contradiction, and
    // reading it either way is a guess.
    expect(() =>
      parsePolicyRequirements(
        { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: false },
        { categoryId: null, maxDocuments: MAX },
      ),
    ).toThrow(PolicyPayloadError);
  });
});

describe('category scope and document kind must agree', () => {
  it('refuses CATEGORY_LICENSE on a policy with no category', () => {
    // A licence with no trade attached cannot be checked against anything.
    try {
      parsePolicyRequirements(
        { documents: ['CATEGORY_LICENSE'], verificationRequired: true },
        { categoryId: null, maxDocuments: MAX },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyPayloadError).code).toBe('CATEGORY_SCOPE_MISMATCH');
    }
  });

  it('refuses a non-licence document on a category-scoped policy', () => {
    // Category policies are ADDITIVE (they union onto the base). A category row
    // demanding identity would silently duplicate the base requirement.
    try {
      parsePolicyRequirements(
        { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
        { categoryId: 'cat-electrical', maxDocuments: MAX },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyPayloadError).code).toBe('CATEGORY_SCOPE_MISMATCH');
    }
  });
});

describe('shape errors', () => {
  it.each([
    ['null', null],
    ['a string', 'INDIVIDUAL_IDENTITY'],
    ['an array', ['INDIVIDUAL_IDENTITY']],
    ['a number', 3],
  ])('refuses %s as a payload', (_label, value) => {
    expect(() => parsePolicyRequirements(value, { categoryId: null, maxDocuments: MAX })).toThrow(
      PolicyPayloadError,
    );
  });

  it('refuses an unknown document kind', () => {
    expect(() =>
      parsePolicyRequirements(
        { documents: ['PASSPORT_PHOTOCOPY'], verificationRequired: true },
        { categoryId: null, maxDocuments: MAX },
      ),
    ).toThrow(PolicyPayloadError);
  });

  it('refuses a duplicated document kind', () => {
    // Asking for the same thing twice is a checklist bug, not two requirements.
    try {
      parsePolicyRequirements(
        { documents: ['INDIVIDUAL_IDENTITY', 'INDIVIDUAL_IDENTITY'], verificationRequired: true },
        { categoryId: null, maxDocuments: MAX },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyPayloadError).code).toBe('DUPLICATE_DOCUMENT');
    }
  });

  it('refuses a missing verificationRequired flag', () => {
    expect(() =>
      parsePolicyRequirements(
        { documents: ['INDIVIDUAL_IDENTITY'] },
        { categoryId: null, maxDocuments: MAX },
      ),
    ).toThrow(PolicyPayloadError);
  });
});

describe('the document limit comes from configuration, not from a constant', () => {
  it('accepts exactly the configured maximum', () => {
    const parsed = parsePolicyRequirements(
      { documents: ['INDIVIDUAL_IDENTITY', 'BUSINESS_REGISTRATION'], verificationRequired: true },
      { categoryId: null, maxDocuments: 2 },
    );
    expect(parsed.documents).toHaveLength(2);
  });

  it('refuses one more than the configured maximum', () => {
    try {
      parsePolicyRequirements(
        {
          documents: ['INDIVIDUAL_IDENTITY', 'BUSINESS_REGISTRATION'],
          verificationRequired: true,
        },
        { categoryId: null, maxDocuments: 1 },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PolicyPayloadError).code).toBe('TOO_MANY_DOCUMENTS');
    }
  });
});
