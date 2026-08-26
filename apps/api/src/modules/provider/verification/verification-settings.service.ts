import { Injectable, Logger } from '@nestjs/common';
import { ADMIN_SETTINGS_SCHEMA } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { PlatformSettingRepository } from '../../../infrastructure/persistence/settings/platform-setting.repository';
import { CONSENT_VERSION_KEY } from '../onboarding/provider-onboarding-wizard.service';
import { GRANT_VALIDITY_DAYS_KEY } from './grant/grant-validity';

// Sprint 9B.2 — verification limits, read from the canonical settings
// mechanism.
//
// This class is deliberately thin. It reads the same PlatformSetting row the
// admin screen writes, and falls back to the same ADMIN_SETTINGS_SCHEMA default
// the admin screen displays. Anything cleverer — a cache, a local constant, a
// second settings table — would let the number this service enforces drift from
// the number an admin was told they set, which is the failure mode the
// whitelisted schema exists to prevent.
//
// Same shape as ProviderOnboardingWizardService's `numberSetting`, which reads
// provider_onboarding_max_* the same way.

export const VERIFICATION_POLICY_MAX_DOCUMENTS_KEY = 'verification_policy_max_documents';

// Sprint 9B.3 — evidence upload limits. Same mechanism, same fallback rules.
export const EVIDENCE_MAX_BYTES_KEY = 'verification_evidence_max_bytes';
export const EVIDENCE_MAX_DOCUMENTS_PER_CASE_KEY = 'verification_evidence_max_documents_per_case';
export const EVIDENCE_UPLOAD_TTL_SECONDS_KEY = 'verification_evidence_upload_ttl_seconds';

// Sprint 9B.7 — how long an approval's work-access grant lasts (ADR 0013).
export { GRANT_VALIDITY_DAYS_KEY } from './grant/grant-validity';

/** The schema entry, so bounds and default are read from one place. */
function field(key: string) {
  return ADMIN_SETTINGS_SCHEMA.find((f) => f.key === key);
}

@Injectable()
export class VerificationSettingsService {
  private readonly logger = new Logger(VerificationSettingsService.name);

  constructor(private readonly settings: PlatformSettingRepository) {}

  /**
   * How many document kinds one policy version may require.
   *
   * A publication-time CEILING: it can only refuse a publish, never grant
   * anything. That asymmetry is why an absent, malformed or out-of-band value
   * falls back to the schema default instead of failing closed — refusing every
   * publish because a settings row is missing would be a worse outage than a
   * slightly conservative ceiling, and no access decision depends on it.
   *
   * Access decisions in this area DO fail closed: resolveRequirements() throws
   * NO_POLICY_IN_FORCE rather than resolving to an empty requirement set.
   */
  async policyMaxDocuments(tx?: PrismaTx): Promise<number> {
    return this.boundedInteger(VERIFICATION_POLICY_MAX_DOCUMENTS_KEY, tx);
  }

  /**
   * The evidence upload limits, resolved together.
   *
   * One call because they are used together and a partially-resolved limit set
   * is a bug waiting to happen: a service that read the size ceiling but forgot
   * the count ceiling would enforce half the policy silently.
   *
   * Same asymmetry as the policy ceiling — every one of these can only REFUSE
   * an upload, never widen access to something already stored — so an absent
   * or malformed row falls back to the schema default rather than blocking
   * uploads over a missing settings row.
   */
  async evidenceLimits(tx?: PrismaTx): Promise<{
    maxBytes: number;
    maxDocumentsPerCase: number;
    uploadTtlSeconds: number;
  }> {
    const [maxBytes, maxDocumentsPerCase, uploadTtlSeconds] = await Promise.all([
      this.boundedInteger(EVIDENCE_MAX_BYTES_KEY, tx),
      this.boundedInteger(EVIDENCE_MAX_DOCUMENTS_PER_CASE_KEY, tx),
      this.boundedInteger(EVIDENCE_UPLOAD_TTL_SECONDS_KEY, tx),
    ]);
    return { maxBytes, maxDocumentsPerCase, uploadTtlSeconds };
  }

  /**
   * The consent document version a provider must have accepted to submit.
   *
   * Reads the SAME PlatformSetting row the onboarding wizard writes and
   * validates against, via the same exported key. A second key, or a local
   * constant, is how a provider accepts terms on one screen and is refused by
   * the next for not having accepted them.
   *
   * Returns null when nothing is configured, and null means "no requirement" —
   * this service does not invent an obligation nobody stated. It differs from
   * the wizard's default on purpose: the wizard is ASKING for consent and needs
   * a version to show, while this is CHECKING it and must not manufacture a
   * requirement out of a fallback.
   */
  async requiredConsentVersion(tx?: PrismaTx): Promise<string | null> {
    try {
      const row = await this.settings.findByKey(CONSENT_VERSION_KEY, tx);
      const value = typeof row?.value === 'string' ? row.value.trim() : '';
      return value.length > 0 ? value : null;
    } catch {
      // Same asymmetry as the limits above: a missing settings row must not
      // block every submission. It can only ever ADD a requirement, so absent
      // means absent.
      this.logger.warn({ msg: 'verification.setting.read.failed', key: CONSENT_VERSION_KEY });
      return null;
    }
  }

  /**
   * How many days a work-access grant issued by an approval lasts.
   *
   * UNLIKE the ceilings above, this one can GRANT rather than only refuse: a
   * larger number means longer access. It still falls back to the schema
   * default rather than failing closed, and that is deliberate — refusing every
   * approval because a settings row is missing would stop the review queue
   * dead, while the fallback is the documented ADR 0013 default (365) that an
   * admin would have been shown anyway.
   *
   * What it must never do is fall back to something OPEN-ENDED. boundedInteger
   * cannot return null or Infinity, and computeGrantWindow refuses anything
   * non-positive, so there is no path from a broken settings row to a grant
   * that never expires.
   */
  async workGrantValidityDays(tx?: PrismaTx): Promise<number> {
    return this.boundedInteger(GRANT_VALIDITY_DAYS_KEY, tx);
  }

  private async boundedInteger(key: string, tx?: PrismaTx): Promise<number> {
    const spec = field(key);
    const fallback = spec?.default as number;

    let value: unknown;
    try {
      const row = await this.settings.findByKey(key, tx);
      value = row?.value;
    } catch (err) {
      // A settings outage must not stop an admin publishing a policy.
      this.logger.warn({
        msg: 'verification.setting.read.failed',
        key,
        err: (err as Error).message,
      });
      return fallback;
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      return fallback;
    }

    // The admin path validates against these bounds, so a row outside them was
    // written by something that bypassed validation. Honouring it would either
    // make every verifying policy unpublishable (below min) or widen a ceiling
    // past what the schema says is reviewable (above max).
    if (spec?.min !== undefined && value < spec.min) return fallback;
    if (spec?.max !== undefined && value > spec.max) return spec.max;

    return value;
  }
}
