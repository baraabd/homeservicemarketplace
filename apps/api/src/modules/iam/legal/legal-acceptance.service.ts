import { Injectable } from '@nestjs/common';
import {
  CURRENT_LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KINDS,
  isApprovedLegalDocument,
  type LegalAcceptanceInput,
  type LegalDocumentsResponse,
  type LegalVersionStaleDetails,
} from '@homeservicemarketplace/contracts';
import type { Prisma } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../config/app-config.service';
import { AppError } from '../../../shared/errors/app-error';

type Tx = Prisma.TransactionClient;

// K02 — server-owned public policy acceptance.
//
// The current version of each document is code (contracts registry), not a
// client claim. A signup that names any other version is refused with 409 so
// the person is never recorded as accepting text they did not see. DRAFT
// acceptance is available only outside production. Approved documents always
// require a nonblank approval reference and a non-draft release identifier.
@Injectable()
export class LegalAcceptanceService {
  constructor(private readonly config: AppConfigService) {}

  documents(): LegalDocumentsResponse {
    return {
      documents: LEGAL_DOCUMENT_KINDS.map((kind) => ({ ...CURRENT_LEGAL_DOCUMENTS[kind] })),
      acceptanceOpen: this.acceptanceOpen(),
    };
  }

  /**
   * Validate before any account lookup, so a refused version answers the
   * same for a new and an existing email (registration stays non-enumerating).
   */
  assertAcceptable(input: LegalAcceptanceInput): void {
    const terms = CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE;
    const privacy = CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE;
    if (input.termsVersion !== terms.version || input.privacyVersion !== privacy.version) {
      const details: LegalVersionStaleDetails & { reason: string } = {
        reason: 'LEGAL_VERSION_STALE',
        termsVersion: terms.version,
        privacyVersion: privacy.version,
      };
      throw new AppError(
        'CONFLICT',
        'The terms or privacy notice changed. Review the current version and try again.',
        409,
        details,
      );
    }
    if (!this.acceptanceOpen()) {
      throw new AppError(
        'CONFLICT',
        'Sign-up is not open yet: the terms and privacy notice are awaiting approval.',
        409,
        { reason: 'LEGAL_ACCEPTANCE_CLOSED' },
      );
    }
  }

  /** Records both documents in the caller's transaction, with server time. */
  async recordSignupAcceptance(
    userId: string,
    input: LegalAcceptanceInput,
    trx: Tx,
  ): Promise<void> {
    const acceptedAt = new Date();
    await trx.userLegalAcceptance.createMany({
      data: [
        {
          userId,
          documentKind: 'TERMS_OF_SERVICE',
          version: input.termsVersion,
          locale: input.locale,
          source: 'SIGNUP',
          acceptedAt,
        },
        {
          userId,
          documentKind: 'PRIVACY_NOTICE',
          version: input.privacyVersion,
          locale: input.locale,
          source: 'SIGNUP',
          acceptedAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  private acceptanceOpen(): boolean {
    const nodeEnv = this.config.get('NODE_ENV');
    const appEnv = this.config.get('APP_ENV');
    const rehearsal = this.config.get('LEGAL_DRAFT_ACCEPTANCE_ALLOWED');
    // Hosted staging also uses NODE_ENV=production. Only its explicit APP_ENV
    // identity may opt into draft rehearsal; production still fails closed.
    const production = appEnv === 'prod' || (nodeEnv === 'production' && appEnv !== 'staging');
    const staging = appEnv === 'staging' || nodeEnv === 'staging';
    const allowDrafts = !production && (rehearsal ?? !staging);
    return LEGAL_DOCUMENT_KINDS.every((kind) => {
      const document = CURRENT_LEGAL_DOCUMENTS[kind];
      if (document.status === 'DRAFT') return allowDrafts;
      return isApprovedLegalDocument(document);
    });
  }
}
