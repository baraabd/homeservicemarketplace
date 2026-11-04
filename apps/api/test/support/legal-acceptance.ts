import {
  CURRENT_LEGAL_DOCUMENTS,
  type LegalAcceptanceInput,
  type LegalLocale,
} from '@homeservicemarketplace/contracts';

import { LegalAcceptanceService } from '../../src/modules/iam/legal/legal-acceptance.service';
import type { AppConfigService } from '../../src/config/app-config.service';

// K02 — the exact current Terms/Privacy versions a signup must name.
export function currentLegalAcceptance(locale: LegalLocale = 'en'): LegalAcceptanceInput {
  return {
    termsVersion: CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version,
    privacyVersion: CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version,
    locale,
  };
}

// For specs that construct AuthenticationService by hand. Reads the real
// config when given one; otherwise NODE_ENV=test with the flag unset, which
// opens acceptance of the DRAFT documents (non-production default).
export function legalAcceptanceServiceFor(
  config?: Pick<AppConfigService, 'get'>,
): LegalAcceptanceService {
  const fallback = {
    get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined),
  } as unknown as AppConfigService;
  return new LegalAcceptanceService((config as AppConfigService | undefined) ?? fallback);
}
