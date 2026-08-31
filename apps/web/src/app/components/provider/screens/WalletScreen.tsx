// Extracted from ProviderApp.tsx (Mode B, workspace routing IA).
//
// Earnings summary, chart and transactions. Owns the recharts import.
//
// ProviderApp.tsx was 3,251 lines holding every workspace screen plus the
// shell, and the shell chose between them with `useState('jobs')`. That made
// the screens unreachable by URL and unsplittable by the bundler. Each screen
// is now its own module behind its own route; behaviour is unchanged by this
// move.

import { useMemo, useState } from 'react';
import { useLang } from '../../../i18n/LanguageContext';
import {
  useProviderEarningsChart,
  useProviderEarningsSummary,
  useProviderEarningsTransactions,
} from '../../../hooks/provider/useProviderEarnings';
import type { EarningsChartRange } from '@homeservicemarketplace/contracts';
import { formatRelativeTime } from '../../../../lib/provider/available-jobs-adapter';
import { Wallet, TrendingUp } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

const WEEKDAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LABELS_AR = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

export function WalletScreen() {
  const { lang } = useLang();

  // Sprint 5.6 (refined): canonical /v1/provider/earnings/* read model.
  // Withdrawals are intentionally out of scope; the CTA stays disabled
  // until the payouts module ships.
  const summaryQuery = useProviderEarningsSummary();
  const txQuery = useProviderEarningsTransactions({});
  const [chartRange, setChartRange] = useState<EarningsChartRange>('30d');
  const chartQuery = useProviderEarningsChart(chartRange);

  const summary = summaryQuery.data;
  const currency = summary?.currency ?? 'USD';
  const transactions = txQuery.data?.items ?? [];

  // Build the AreaChart data from the canonical /chart buckets. Every
  // bucket has a stable ISO date and a gross amount; no client-side
  // bucketing math is needed beyond mapping ISO → weekday/short-date.
  const chartData = useMemo(() => {
    const buckets = chartQuery.data?.buckets ?? [];
    return buckets.map((b) => {
      const d = new Date(`${b.date}T00:00:00Z`);
      const wkLabels = lang === 'ar' ? WEEKDAY_LABELS_AR : WEEKDAY_LABELS_EN;
      // For 7d ranges show weekday labels; for longer windows show
      // 'MM-DD' so the axis stays legible at 30/90 ticks.
      const tick =
        chartRange === '7d' ? (wkLabels[d.getUTCDay()] ?? b.date.slice(5)) : b.date.slice(5);
      return { tick, gross: b.grossEarnings / 100, net: b.netEarnings / 100 };
    });
  }, [chartQuery.data, chartRange, lang]);

  const L = {
    title: lang === 'ar' ? 'المحفظة والأرباح' : 'Wallet & Earnings',
    available: lang === 'ar' ? 'الرصيد المتاح' : 'Available Balance',
    gross: lang === 'ar' ? 'إجمالي' : 'Gross',
    fees: lang === 'ar' ? 'العمولة' : 'Platform Fees',
    pending: lang === 'ar' ? 'معلق' : 'Pending',
    completed: lang === 'ar' ? 'مهام منجزة' : 'Jobs Done',
    payoutCta: lang === 'ar' ? 'السحب البنكي قريباً' : 'Bank withdrawals — coming soon',
    history: lang === 'ar' ? 'سجل المعاملات' : 'Transaction History',
    historyEmpty:
      lang === 'ar'
        ? 'لا توجد معاملات بعد. أكمل أول حجز لتظهر هنا.'
        : 'No transactions yet. Complete your first booking to see them here.',
    rangeTitle: lang === 'ar' ? 'الأرباح اليومية' : 'Daily earnings',
    range7d: lang === 'ar' ? '٧ أيام' : '7d',
    range30d: lang === 'ar' ? '٣٠ يوم' : '30d',
    range90d: lang === 'ar' ? '٩٠ يوم' : '90d',
    loading: lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…',
    failed:
      lang === 'ar'
        ? 'تعذّر تحميل الأرباح. حاول مرة أخرى لاحقاً.'
        : 'Could not load earnings. Try again later.',
    feeFootnote: (bps: number) =>
      lang === 'ar'
        ? `بعد عمولة المنصة ${(bps / 100).toFixed(0)}٪`
        : `After ${(bps / 100).toFixed(0)}% platform fee`,
  };

  // Format an integer marketplace currency unit (cents-equivalent in
  // the schema) into a human-readable string. `currency` comes from
  // the server and reflects the dominant booking currency.
  const formatAmount = (amount: number) =>
    new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount / 100);

  const summaryError = summaryQuery.isError;

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Header card — Available Balance is the headline value. Gross,
         platform fees, and pending sit underneath as supporting tiles. */}
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 mx-4 mt-4 rounded-3xl p-6 relative overflow-hidden">
        <div className="absolute -top-8 -end-8 w-36 h-36 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 start-0 w-24 h-24 rounded-full bg-purple-500/20" />
        <div className="relative">
          <p className="text-white/70 mb-1" style={{ fontSize: '12px' }}>
            {L.available}
          </p>
          <p
            className="text-white"
            style={{ fontSize: '38px', fontWeight: 900, letterSpacing: '-0.02em' }}
          >
            {summary ? formatAmount(summary.availableBalance) : summaryError ? '—' : '…'}
          </p>
          {summary ? (
            <p className="text-white/60 mt-1" style={{ fontSize: '11px' }}>
              {L.feeFootnote(summary.platformFeeRateBps)}
            </p>
          ) : null}
          <div className="flex gap-3 mt-4 flex-wrap">
            <div className="bg-white/15 rounded-2xl px-3 py-2 flex-1 min-w-[80px]">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.gross}
              </p>
              <p className="text-white" style={{ fontSize: '14px', fontWeight: 700 }}>
                {summary ? formatAmount(summary.grossEarnings) : '…'}
              </p>
            </div>
            <div className="bg-white/15 rounded-2xl px-3 py-2 flex-1 min-w-[80px]">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.fees}
              </p>
              <p className="text-white" style={{ fontSize: '14px', fontWeight: 700 }}>
                {summary ? `−${formatAmount(summary.platformFees)}` : '…'}
              </p>
            </div>
            <div className="bg-white/15 rounded-2xl px-3 py-2 flex-1 min-w-[80px]">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.pending}
              </p>
              <p className="text-white" style={{ fontSize: '14px', fontWeight: 700 }}>
                {summary ? formatAmount(summary.pendingBalance) : '…'}
              </p>
            </div>
            <div className="bg-white/15 rounded-2xl px-3 py-2 flex-1 min-w-[80px]">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.completed}
              </p>
              <p className="text-white" style={{ fontSize: '14px', fontWeight: 700 }}>
                {summary ? summary.completedBookingsCount : '…'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {summaryError ? (
        <div className="mx-4 mt-3 text-rose-600 text-center" style={{ fontSize: '12px' }}>
          {L.failed}
        </div>
      ) : null}

      {/* Payout placeholder — withdrawals are out of scope until the
         payouts module ships. Disabled to make the affordance honest;
         no fake setTimeout success. */}
      <div className="px-4 mt-3">
        <button
          disabled
          className="w-full py-4 rounded-2xl flex items-center justify-center gap-2.5 bg-slate-200 dark:bg-slate-700 text-slate-500 cursor-not-allowed"
          style={{ fontSize: '15px', fontWeight: 800 }}
          aria-disabled="true"
        >
          <TrendingUp size={18} />
          {L.payoutCta}
        </button>
      </div>

      {/* Daily-earnings chart — server-side buckets from /v1/provider/
         earnings/chart. Range toggle: 7d / 30d / 90d. */}
      <div className="mx-4 mt-4 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <p
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            {L.rangeTitle}
          </p>
          <div className="flex bg-slate-100 dark:bg-slate-700 rounded-full p-0.5">
            {(['7d', '30d', '90d'] as const).map((r) => {
              const active = chartRange === r;
              const label = r === '7d' ? L.range7d : r === '30d' ? L.range30d : L.range90d;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setChartRange(r)}
                  className={`px-3 py-1 rounded-full transition-colors ${
                    active ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-sm' : 'text-slate-500'
                  }`}
                  style={{ fontSize: '11px', fontWeight: 700 }}
                  aria-pressed={active}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {chartQuery.isPending ? (
          <p className="text-slate-400 py-8 text-center" style={{ fontSize: '12px' }}>
            {L.loading}
          </p>
        ) : chartQuery.isError ? (
          <p className="text-rose-600 py-8 text-center" style={{ fontSize: '12px' }}>
            {L.failed}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
              <defs>
                <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="tick"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={chartRange === '7d' ? 0 : 24}
              />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                  fontSize: '12px',
                }}
                formatter={(v: number) => [formatAmount(v * 100), L.gross]}
              />
              <Area
                type="monotone"
                dataKey="gross"
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill="url(#blueGrad)"
                dot={chartRange === '7d' ? { fill: '#3b82f6', r: 3 } : false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Transaction history — COMPLETED-only canonical rows. */}
      <div className="mx-4 mt-4 mb-4">
        <p
          className="text-slate-900 dark:text-white mb-3"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {L.history}
        </p>
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          {transactions.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-10 px-4 gap-3 text-center"
              role="status"
            >
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <Wallet size={24} className="text-slate-300" />
              </div>
              <p className="text-slate-400" style={{ fontSize: '13px' }}>
                {txQuery.isError ? L.failed : txQuery.isPending ? L.loading : L.historyEmpty}
              </p>
            </div>
          ) : (
            transactions.map((tx, i) => {
              const label =
                (lang === 'ar' ? tx.service.categoryLabelAr : tx.service.categoryLabelEn) ??
                tx.service.customServiceText ??
                tx.bookingId;
              return (
                <div
                  key={tx.id}
                  className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-slate-50 dark:border-slate-700' : ''}`}
                >
                  <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 bg-green-100 dark:bg-green-900/30">
                    <TrendingUp size={14} className="text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-slate-800 dark:text-slate-100"
                      style={{ fontSize: '13px', fontWeight: 600 }}
                    >
                      {label}
                    </p>
                    <p className="text-slate-400" style={{ fontSize: '11px' }}>
                      {tx.city ? `${tx.city} · ` : ''}
                      {formatRelativeTime(tx.occurredAt, lang)}
                    </p>
                  </div>
                  <div className="text-end">
                    <p style={{ fontSize: '14px', fontWeight: 700, color: '#16a34a' }}>
                      +{formatAmount(tx.netAmount)}
                    </p>
                    <p className="text-slate-400" style={{ fontSize: '10px' }}>
                      {formatAmount(tx.amount)} − {formatAmount(tx.platformFee)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
