import { Injectable, Logger } from '@nestjs/common';
import { ADMIN_SETTINGS_SCHEMA } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { PlatformSettingRepository } from '../../../infrastructure/persistence/settings/platform-setting.repository';

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
