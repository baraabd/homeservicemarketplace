import { z } from 'zod';

import type { PolicyRequirements } from './requirement-resolver';

// Sprint 9B.2 — the shape a policy version is allowed to have.
//
// docs/adr/0010-policy-versioned-verification.md
//
// `VerificationRequirementPolicy.requirements` is JSON precisely so that adding
// a document kind needs no migration. The cost is that the database constrains
// nothing about it, so this module is the only thing between a mistyped admin
// request and a requirement set that cannot be satisfied.
//
// Everything here is checked at PUBLISH time. A policy that is already
// referenced by a case is never re-validated, because re-validating history
// would let a rule added today invalidate a decision made honestly last month.

/** The document kinds a policy may name. Mirrors the Prisma enum; kept as a
 *  literal list so an unknown value is a validation error rather than a
 *  runtime cast. */
const DOCUMENT_KINDS = [
  'INDIVIDUAL_IDENTITY',
  'BUSINESS_REGISTRATION',
  'AUTHORIZED_REPRESENTATIVE_IDENTITY',
  'CATEGORY_LICENSE',
] as const;

export type PolicyPayloadErrorCode =
  | 'MALFORMED'
  | 'UNSATISFIABLE'
  | 'CONTRADICTORY'
  | 'CATEGORY_SCOPE_MISMATCH'
  | 'DUPLICATE_DOCUMENT'
  | 'TOO_MANY_DOCUMENTS';

export class PolicyPayloadError extends Error {
  constructor(
    message: string,
    readonly code: PolicyPayloadErrorCode,
  ) {
    super(message);
    this.name = 'PolicyPayloadError';
  }
}

// `.strip()` is the default and is what we want: unknown keys are DROPPED
// rather than rejected or stored. An older API must not choke on a field a
// newer one added, but it must not persist something it cannot interpret
// either — a stored policy that says more than the code enforces is a policy
// nobody can review.
const schema = z.object({
  documents: z.array(z.enum(DOCUMENT_KINDS)),
  verificationRequired: z.boolean(),
});

export interface PolicyScope {
  /** null for a base policy; set for a category-scoped one. */
  categoryId: string | null;
  /** From dynamic settings, never a constant here. */
  maxDocuments: number;
}

/**
 * Validate and normalise a policy's `requirements` payload.
 *
 * Throws `PolicyPayloadError` rather than returning a result object so a
 * caller cannot forget to check — publishing an invalid policy is not a
 * recoverable partial success.
 */
export function parsePolicyRequirements(input: unknown, scope: PolicyScope): PolicyRequirements {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new PolicyPayloadError(
      `Policy requirements are malformed: ${result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')}`,
      'MALFORMED',
    );
  }

  const { documents, verificationRequired } = result.data;

  const duplicates = documents.filter((kind, i) => documents.indexOf(kind) !== i);
  if (duplicates.length > 0) {
    throw new PolicyPayloadError(
      `Duplicated document kind(s): ${[...new Set(duplicates)].join(', ')}. ` +
        'Asking for the same thing twice is a checklist bug, not two requirements.',
      'DUPLICATE_DOCUMENT',
    );
  }

  if (documents.length > scope.maxDocuments) {
    throw new PolicyPayloadError(
      `A policy may name at most ${scope.maxDocuments} document(s); this one names ${documents.length}.`,
      'TOO_MANY_DOCUMENTS',
    );
  }

  // Unsatisfiable: the provider is told to verify and given nothing to submit.
  // It presents as a permanently stuck case rather than as an error, which is
  // why it is refused here.
  if (verificationRequired && documents.length === 0) {
    throw new PolicyPayloadError(
      'verificationRequired is true but no documents are listed, so no provider could ever satisfy this policy.',
      'UNSATISFIABLE',
    );
  }

  // Contradictory: documents that nothing will ever ask for. Reading it either
  // way — enforce them, or ignore them — is a guess about intent.
  if (!verificationRequired && documents.length > 0) {
    throw new PolicyPayloadError(
      'verificationRequired is false but documents are listed. Remove the documents, or require verification.',
      'CONTRADICTORY',
    );
  }

  // Category scope. CATEGORY_LICENSE carries the trade it satisfies, so it is
  // meaningless without one; and a category policy is ADDITIVE onto the base,
  // so anything other than a licence there would duplicate a base requirement.
  const licences = documents.filter((k) => k === 'CATEGORY_LICENSE');
  if (scope.categoryId === null && licences.length > 0) {
    throw new PolicyPayloadError(
      'CATEGORY_LICENSE requires a category-scoped policy: a licence with no trade attached cannot be checked against anything.',
      'CATEGORY_SCOPE_MISMATCH',
    );
  }
  if (scope.categoryId !== null && licences.length !== documents.length) {
    throw new PolicyPayloadError(
      'A category-scoped policy may only require CATEGORY_LICENSE; it adds to the base policy rather than restating it.',
      'CATEGORY_SCOPE_MISMATCH',
    );
  }

  return { documents, verificationRequired };
}
