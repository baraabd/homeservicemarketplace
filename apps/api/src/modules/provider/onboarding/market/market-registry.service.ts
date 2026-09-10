import { Injectable, Logger } from '@nestjs/common';

import { PlatformSettingRepository } from '../../../../infrastructure/persistence/settings/platform-setting.repository';
import type { PrismaTx } from '../../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../../shared/errors/app-error';
import {
  SUPPORTED_MARKETS_SETTING,
  enabledMarkets,
  findEnabledMarket,
  MarketRegistryError,
  parseSupportedMarkets,
  type SupportedMarket,
} from './supported-market';

// Sprint 09B.29 Phase 5 — reading the operator's market registry.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// The parsing lives next door in `supported-market.ts` and is pure. This class
// is the thin part: read the row, hand it to the parser, and turn a
// configuration mistake into something a caller can act on.
//
// WHY A CONFIG MISTAKE IS A 500 AND NOT A 400
//
// A malformed registry is not the provider's fault and there is nothing they
// can do about it. Answering 400 would blame the request; answering 404 would
// imply the market does not exist. `INTERNAL` with a stable reason is the
// honest shape: the platform is misconfigured, an operator has to fix it, and
// the log line names the setting key so they can.
//
// The error message deliberately does NOT carry the parser's detail to the
// client. An operator needs "market at index 2 has countryCode \"ZZ\""; a
// provider needs "this is not something you can fix". The detail goes to the
// log.

@Injectable()
export class MarketRegistryService {
  private readonly log = new Logger(MarketRegistryService.name);

  constructor(private readonly settings: PlatformSettingRepository) {}

  /**
   * Every configured market, enabled or not.
   *
   * Not cached. The registry is read on the onboarding paths that need it,
   * which are not hot, and a cache here would mean an operator disabling a
   * market watched it keep working for an unpredictable interval — the one
   * behaviour a withdrawal must not have.
   */
  async all(tx?: PrismaTx): Promise<SupportedMarket[]> {
    const row = await this.settings.findByKey(SUPPORTED_MARKETS_SETTING, tx);

    if (row == null) {
      // Distinct from a malformed value: nobody has configured this platform
      // at all. Same answer to the caller, different sentence in the log.
      this.log.error({
        msg: 'market.registry.missing',
        setting: SUPPORTED_MARKETS_SETTING,
      });
      throw this.misconfigured('MARKET_REGISTRY_MISSING');
    }

    try {
      return parseSupportedMarkets(row.value);
    } catch (err) {
      if (err instanceof MarketRegistryError) {
        this.log.error({
          msg: 'market.registry.invalid',
          setting: SUPPORTED_MARKETS_SETTING,
          reason: err.code,
          detail: err.message,
        });
        throw this.misconfigured(`MARKET_REGISTRY_${err.code}`);
      }
      throw err;
    }
  }

  /** The markets a provider may actually be placed in, in operator order. */
  async enabled(tx?: PrismaTx): Promise<SupportedMarket[]> {
    return enabledMarkets(await this.all(tx));
  }

  /**
   * The enabled market for a code, or null.
   *
   * Null for unknown, malformed AND disabled alike — the caller is asking "may
   * a provider operate here", and all three are the same answer to that.
   */
  async findEnabled(code: unknown, tx?: PrismaTx): Promise<SupportedMarket | null> {
    return findEnabledMarket(await this.enabled(tx), code);
  }

  private misconfigured(reason: string): AppError {
    return new AppError(
      'INTERNAL',
      'Provider onboarding is temporarily unavailable in this region. Please try again later.',
      500,
      { reason },
    );
  }
}
