import { Prisma, prisma } from './index';

// K02 — production-safe initialization of the Saudi launch market.
//
// The production seed deliberately skips the development market registry
// (SY/SE/SA/CA, seed.ts upsertDevSupportedMarkets), so a fresh production
// database has NO supported market and provider onboarding fails closed with
// MARKET_REGISTRY_MISSING. This routine is the reviewed operator path that
// writes exactly the approved launch registry:
//
//   SA, enabled, display key market.SA, timezone Asia/Riyadh (single zone,
//   no DST), coarse bounding envelope (not a border — see supported-market.ts).
//
// Guarantees:
//   • one transaction: the setting, its PlatformSettingHistory row and an
//     ADMIN_SETTING_UPDATED AuditEvent commit together or not at all;
//   • idempotent: an identical existing value changes nothing and writes no
//     history/audit row;
//   • never silently overwrites: a DIFFERENT existing registry is refused
//     unless `replace` is set (then the previous value is preserved in
//     history);
//   • production requires ALLOW_PROD_MARKET_INIT=true;
//   • the value is re-validated by the API's parseSupportedMarkets in
//     apps/api/test/unit/k02-saudi-market.spec.ts, so it cannot drift from
//     the registry the API accepts.
//
// Run: pnpm --filter @homeservicemarketplace/database market:init:ksa [--dry-run] [--replace]

export const SUPPORTED_MARKETS_KEY = 'platform_supported_markets';

export const SAUDI_LAUNCH_MARKET_REGISTRY = Object.freeze([
  Object.freeze({
    countryCode: 'SA',
    enabled: true,
    displayNameKey: 'market.SA',
    defaultTimezone: 'Asia/Riyadh',
    bounds: Object.freeze({ south: 16.3, west: 34.4, north: 32.2, east: 55.7 }),
  }),
]);

const ACTOR_SYSTEM = 'operator-cli:market-init-ksa';
const REASON = 'K02 Saudi launch market initialization (SA, Asia/Riyadh)';

export type MarketInitOutcome =
  | 'CREATED'
  | 'UNCHANGED'
  | 'REPLACED'
  | 'REFUSED_DIFFERENT'
  | 'DRY_RUN';

export interface MarketInitSummary {
  outcome: MarketInitOutcome;
  key: string;
  previousCountryCodes: string[] | null;
}

type TxCapable = Pick<typeof prisma, '$transaction'>;

export function assertMarketInitAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_PROD_MARKET_INIT !== 'true') {
    throw new Error(
      'Refusing to initialize the market registry in production without ALLOW_PROD_MARKET_INIT=true.',
    );
  }
}

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(value));
}

function countryCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((m) =>
    m && typeof m === 'object' && typeof (m as { countryCode?: unknown }).countryCode === 'string'
      ? (m as { countryCode: string }).countryCode
      : '?',
  );
}

export async function initSaudiLaunchMarket(
  client: TxCapable,
  options: { dryRun?: boolean; replace?: boolean } = {},
): Promise<MarketInitSummary> {
  const target = plain(SAUDI_LAUNCH_MARKET_REGISTRY) as Prisma.InputJsonValue;
  return client.$transaction(
    async (tx) => {
      // Serialize concurrent operator runs on the setting key.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SUPPORTED_MARKETS_KEY}))`;
      const existing = await tx.platformSetting.findUnique({
        where: { key: SUPPORTED_MARKETS_KEY },
      });
      const previousCountryCodes = existing ? countryCodes(existing.value) : null;
      if (existing && canonical(existing.value) === canonical(target)) {
        return { outcome: 'UNCHANGED', key: SUPPORTED_MARKETS_KEY, previousCountryCodes };
      }
      if (existing && !options.replace) {
        return { outcome: 'REFUSED_DIFFERENT', key: SUPPORTED_MARKETS_KEY, previousCountryCodes };
      }
      if (options.dryRun) {
        return { outcome: 'DRY_RUN', key: SUPPORTED_MARKETS_KEY, previousCountryCodes };
      }
      await tx.platformSetting.upsert({
        where: { key: SUPPORTED_MARKETS_KEY },
        create: { key: SUPPORTED_MARKETS_KEY, value: target, updatedBy: null },
        update: { value: target, updatedBy: null },
      });
      await tx.platformSettingHistory.create({
        data: {
          key: SUPPORTED_MARKETS_KEY,
          previousValue: existing ? (existing.value as Prisma.InputJsonValue) : Prisma.DbNull,
          newValue: target,
          changedBy: null,
          reason: REASON,
        },
      });
      await tx.auditEvent.create({
        data: {
          userId: null,
          type: 'ADMIN_SETTING_UPDATED',
          metadata: {
            key: SUPPORTED_MARKETS_KEY,
            actorSystem: ACTOR_SYSTEM,
            reason: REASON,
            previousCountryCodes,
            newCountryCodes: ['SA'],
          },
        },
      });
      return {
        outcome: existing ? 'REPLACED' : 'CREATED',
        key: SUPPORTED_MARKETS_KEY,
        previousCountryCodes,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function cliMain(): Promise<void> {
  assertMarketInitAllowed();
  const argv = process.argv.slice(2);
  const summary = await initSaudiLaunchMarket(prisma, {
    dryRun: argv.includes('--dry-run'),
    replace: argv.includes('--replace'),
  });
  console.log(JSON.stringify({ ok: summary.outcome !== 'REFUSED_DIFFERENT', ...summary }));
  if (summary.outcome === 'REFUSED_DIFFERENT') {
    console.error(
      'A different market registry already exists. Review it, then re-run with --replace to ' +
        'replace it (the previous value is kept in PlatformSettingHistory).',
    );
    process.exit(3);
  }
}

if (require.main === module) {
  cliMain()
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`market-init failed: ${msg}`);
      process.exit(1);
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
