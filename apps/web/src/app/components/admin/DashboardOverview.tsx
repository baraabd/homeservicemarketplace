import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, DollarSign, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsDateRangeQuery } from '@homeservicemarketplace/contracts';

import {
  useAdminAnalyticsOverview,
  useAdminAnalyticsRevenue,
} from '../../hooks/admin/useAdminAnalytics';

// Sprint 6.4 — extracted, real, API-driven dashboard overview.
// Replaces the prior hardcoded KPIs + MONTHLY_DATA mock chart.
//
// Layout:
//   • Range selector (7d / 30d / 90d default 30d)
//   • 6 KPI cards bound to /admin/analytics/overview
//   • Revenue area chart bound to /admin/analytics/revenue
//
// Cancelled bookings are shown alongside the completed count for
// operator context but do not count toward revenue.

/** Intl puts a no-break space between a currency code and its amount. */
const NBSP = String.fromCharCode(0xa0);

const RANGE_OPTIONS: ReadonlyArray<{ key: string; days: number; en: string; ar: string }> = [
  { key: '7d', days: 7, en: '7d', ar: '٧ أيام' },
  { key: '30d', days: 30, en: '30d', ar: '٣٠ يوم' },
  { key: '90d', days: 90, en: '90d', ar: '٩٠ يوم' },
];

function rangeFor(days: number): AnalyticsDateRangeQuery {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function DashboardOverview({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const [rangeKey, setRangeKey] = useState<string>('30d');
  const range = useMemo(() => {
    const opt = RANGE_OPTIONS.find((r) => r.key === rangeKey) ?? RANGE_OPTIONS[1];
    return rangeFor(opt.days);
  }, [rangeKey]);

  const overviewQuery = useAdminAnalyticsOverview(range);
  const revenueQuery = useAdminAnalyticsRevenue(range);

  const overview = overviewQuery.data;
  const series = useMemo(() => revenueQuery.data?.series ?? [], [revenueQuery.data]);
  const [chartCurrency, setChartCurrency] = useState<string | null>(null);

  const L = {
    title: isAr ? 'لوحة التحكم' : 'Dashboard',
    range: isAr ? 'النطاق' : 'Range',
    kpis: {
      // R17-D: booked value of completed bookings — not payments, not revenue.
      revenue: isAr ? 'قيمة الحجوزات المنجزة (في النطاق)' : 'Completed booking value (in range)',
      lifetime: isAr ? 'قيمة الحجوزات المنجزة (الإجمالي)' : 'Completed booking value (lifetime)',
      providers: isAr ? 'المزودون' : 'Providers',
      users: isAr ? 'المستخدمون' : 'Users',
      completed: isAr ? 'حجوزات منجزة' : 'Bookings completed',
      disputes: isAr ? 'نزاعات مفتوحة' : 'Open disputes',
    },
    revenueChart: isAr ? 'قيمة الحجوزات المنجزة يومياً' : 'Daily completed booking value',
    chartCurrency: isAr ? 'العملة' : 'Currency',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    failed: isAr ? 'تعذّر تحميل البيانات.' : 'Could not load analytics.',
    noCompletions: isAr ? 'لا توجد حجوزات منجزة' : 'No completed bookings',
    valueNote: isAr
      ? 'قيم الحجوزات وليست مدفوعات. لا توجد عمولة منصة معتمدة، ولا تُجمع العملات المختلفة معاً.'
      : 'Booking values, not payments. No platform fee is approved, and currencies are never added together.',
    undated: (n: number) =>
      isAr
        ? `${n} حجز منجز بلا سجل إنجاز مؤرَّخ، فلا يُحتسب ضمن النطاق.`
        : `${n} completed booking(s) have no dated completion record and are not counted in a range.`,
  };

  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(isAr ? 'ar' : 'en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  // One figure per currency; never a sum across currencies.
  const perCurrency = (pick: 'bookedValueWithinRange' | 'bookedValueLifetime') => {
    if (!overview) return overviewQuery.isError ? '—' : '…';
    // A payload without the breakdown is unknown, not zero, and must not crash
    // the admin shell.
    if (!Array.isArray(overview.revenueByCurrency)) return '—';
    const rows = overview.revenueByCurrency.filter((r) => r[pick] > 0);
    if (rows.length === 0) return L.noCompletions;
    if (rows.length === 1) return money(rows[0][pick], rows[0].currency);
    // Several currencies: one isolated line each, so nothing reads as a sum
    // and nothing overflows a narrow card.
    return (
      <ul className="flex flex-col" style={{ fontSize: '14px', overflowWrap: 'normal' }}>
        {rows.map((r) => (
          <li key={r.currency}>
            {/* A breakable space between code and amount: on a narrow card the
                line may wrap there, never inside the code or the number. */}
            <bdi>{money(r[pick], r.currency).split(NBSP).join(' ')}</bdi>
          </li>
        ))}
      </ul>
    );
  };
  const count = (n: number | undefined) =>
    overview && n !== undefined ? String(n) : overviewQuery.isError ? '—' : '…';

  // Honour reduced motion: the chart must not animate its values in.
  const reduceMotion =
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const activeSeries = series.find((s) => s.currency === chartCurrency) ?? series[0] ?? null;
  const chartData = (activeSeries?.buckets ?? []).map((b) => ({
    date: b.date.slice(5), // 'MM-DD'
    value: b.bookedValue / 100,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <div
          className="flex bg-slate-100 dark:bg-slate-700 rounded-full p-0.5"
          role="tablist"
          aria-label={L.range}
        >
          {RANGE_OPTIONS.map((r) => {
            const active = r.key === rangeKey;
            return (
              <button
                key={r.key}
                role="tab"
                type="button"
                onClick={() => setRangeKey(r.key)}
                aria-selected={active}
                className={`px-3 py-1 rounded-full transition-colors ${
                  active ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-sm' : 'text-slate-500'
                }`}
                style={{ fontSize: '11px', fontWeight: 700 }}
              >
                {isAr ? r.ar : r.en}
              </button>
            );
          })}
        </div>
      </div>

      {overviewQuery.isError ? (
        <p
          className="text-rose-600 px-4 py-2 rounded-2xl bg-rose-50 dark:bg-rose-900/30"
          role="status"
          style={{ fontSize: '12px' }}
        >
          {L.failed}
        </p>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          icon={<DollarSign size={16} />}
          label={L.kpis.revenue}
          value={perCurrency('bookedValueWithinRange')}
          tone="green"
          testId="kpi-value-in-range"
        />
        <KpiCard
          icon={<TrendingUp size={16} />}
          label={L.kpis.lifetime}
          value={perCurrency('bookedValueLifetime')}
          tone="indigo"
          testId="kpi-value-lifetime"
        />
        <KpiCard
          icon={<ShieldCheck size={16} />}
          label={L.kpis.providers}
          value={count(overview?.counts.providers)}
          tone="blue"
        />
        <KpiCard
          icon={<Users size={16} />}
          label={L.kpis.users}
          value={count(overview?.counts.users)}
          tone="slate"
        />
        <KpiCard
          icon={<Activity size={16} />}
          label={L.kpis.completed}
          value={count(overview?.counts.bookingsCompleted)}
          tone="emerald"
        />
        <KpiCard
          icon={<AlertTriangle size={16} />}
          label={L.kpis.disputes}
          value={count(overview?.counts.disputesOpen)}
          tone="amber"
        />
      </div>
      <p className="text-slate-500" style={{ fontSize: '11px' }} data-testid="analytics-value-note">
        {L.valueNote}
        {overview && overview.counts.undatedCompletions > 0
          ? ` ${L.undated(overview.counts.undatedCompletions)}`
          : ''}
      </p>

      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            {L.revenueChart}
            {activeSeries ? ` (${activeSeries.currency})` : ''}
          </p>
          {series.length > 1 ? (
            <label className="flex items-center gap-1.5" style={{ fontSize: '11px' }}>
              <span className="text-slate-500">{L.chartCurrency}</span>
              <select
                value={activeSeries?.currency ?? ''}
                onChange={(e) => setChartCurrency(e.target.value)}
                className="px-2 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                {series.map((s) => (
                  <option key={s.currency} value={s.currency}>
                    {s.currency}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {revenueQuery.isPending ? (
          <p
            className="text-slate-400 py-12 text-center"
            role="status"
            style={{ fontSize: '12px' }}
          >
            {L.loading}
          </p>
        ) : revenueQuery.isError ? (
          <p className="text-rose-600 py-12 text-center" role="status" style={{ fontSize: '12px' }}>
            {L.failed}
          </p>
        ) : !activeSeries ? (
          <p
            className="text-slate-400 py-12 text-center"
            role="status"
            style={{ fontSize: '12px' }}
          >
            {L.noCompletions}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="adminRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                  fontSize: '12px',
                }}
                formatter={(v: number) => [money(v * 100, activeSeries.currency), L.revenueChart]}
              />
              <Area
                type="monotone"
                dataKey="value"
                isAnimationActive={!reduceMotion}
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill="url(#adminRevenueGrad)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

const TONE_BG: Record<string, string> = {
  green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
  indigo: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300',
  blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
  emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
  slate: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
};

function KpiCard({
  icon,
  label,
  value,
  tone,
  footnote,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: keyof typeof TONE_BG;
  footnote?: string;
  testId?: string;
}) {
  return (
    <div
      className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 flex items-start gap-3"
      data-testid={testId}
    >
      <div
        className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${TONE_BG[tone]}`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
          {label}
        </p>
        <div
          className="text-slate-900 dark:text-white"
          style={{
            fontSize: '22px',
            fontWeight: 800,
            letterSpacing: '-0.01em',
            overflowWrap: 'anywhere',
          }}
        >
          {value}
        </div>
        {footnote ? (
          <p className="text-slate-400 mt-0.5" style={{ fontSize: '10px' }}>
            {footnote}
          </p>
        ) : null}
      </div>
    </div>
  );
}
