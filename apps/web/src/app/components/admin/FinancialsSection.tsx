import {
  useAdminFinancialsBookings,
  useAdminFinancialsProviderEarnings,
  useAdminFinancialsSummary,
} from '../../hooks/admin/useAdminFinancials';

// Sprint 6.4 — extracted, real, API-driven Financials section.
// Replaces the prior $14,820/$11,100/$3,720 hardcoded values + the
// WALLET_TRANSACTIONS mock list. Three calls share the panel:
//
//   • /admin/financials/summary — KPI tiles (revenue / fees /
//     provider earnings / pending)
//   • /admin/financials/bookings — recent completed bookings table
//   • /admin/financials/provider-earnings — top providers rollup
//
// Cancelled bookings are excluded server-side. Refunds aren't
// tracked yet (totalRefunds is constant 0 until that flow ships).

export function FinancialsSection({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const summaryQuery = useAdminFinancialsSummary();
  const bookingsQuery = useAdminFinancialsBookings({ limit: 25 });
  const providerEarningsQuery = useAdminFinancialsProviderEarnings({ limit: 10 });

  const summary = summaryQuery.data;
  const currency = summary?.currency ?? 'USD';

  const fmt = (amount: number) =>
    new Intl.NumberFormat(isAr ? 'ar' : 'en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount / 100);

  const L = {
    title: isAr ? 'التقارير المالية' : 'Financial Reports',
    revenue: isAr ? 'إجمالي الإيرادات' : 'Total revenue',
    fees: isAr ? 'عمولات المنصة' : 'Platform fees',
    providers: isAr ? 'أرباح المزودين' : 'Provider earnings',
    pending: isAr ? 'معلق' : 'Pending',
    refunds: isAr ? 'الاستردادات' : 'Refunds',
    completedBookings: isAr ? 'الحجوزات المنجزة' : 'Completed bookings',
    feeRate: (bps: number) =>
      isAr ? `معدل العمولة ${(bps / 100).toFixed(0)}٪` : `${(bps / 100).toFixed(0)}% platform fee`,
    bookingsTitle: isAr ? 'الحجوزات الأخيرة' : 'Recent bookings',
    bookingsEmpty: isAr ? 'لا توجد حجوزات منجزة بعد.' : 'No completed bookings yet.',
    providersTitle: isAr ? 'أعلى المزودين دخلاً' : 'Top earners',
    providersEmpty: isAr ? 'لا توجد بيانات بعد.' : 'No data yet.',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    failed: isAr ? 'تعذّر تحميل البيانات.' : 'Could not load financials.',
    cols: {
      booking: isAr ? 'الحجز' : 'Booking',
      provider: isAr ? 'المزود' : 'Provider',
      amount: isAr ? 'المبلغ' : 'Amount',
      net: isAr ? 'الصافي' : 'Net',
      when: isAr ? 'متى' : 'When',
      providerCol: isAr ? 'المزود' : 'Provider',
      bookings: isAr ? 'حجوزات' : 'Bookings',
      gross: isAr ? 'إجمالي' : 'Gross',
      netCol: isAr ? 'صافي' : 'Net',
    },
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-slate-900 dark:text-white" style={{ fontSize: '22px', fontWeight: 800 }}>
        {L.title}
      </h2>

      {summaryQuery.isError ? (
        <p
          className="text-rose-600 px-4 py-2 rounded-2xl bg-rose-50 dark:bg-rose-900/30"
          role="status"
          style={{ fontSize: '12px' }}
        >
          {L.failed}
        </p>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile
          label={L.revenue}
          value={summary ? fmt(summary.totalRevenue) : '…'}
          tone="green"
        />
        <SummaryTile
          label={L.fees}
          value={summary ? `−${fmt(summary.totalPlatformFees)}` : '…'}
          tone="amber"
          footnote={summary ? L.feeRate(summary.platformFeeRateBps) : undefined}
        />
        <SummaryTile
          label={L.providers}
          value={summary ? fmt(summary.totalProviderEarnings) : '…'}
          tone="indigo"
        />
        <SummaryTile
          label={L.pending}
          value={summary ? fmt(summary.pendingBalance) : '…'}
          tone="blue"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 text-slate-500" style={{ fontSize: '11px' }}>
        <div>
          {L.completedBookings}: <strong>{summary ? summary.completedBookingsCount : '—'}</strong>
        </div>
        <div>
          {L.refunds}: <strong>{summary ? fmt(summary.totalRefunds) : '—'}</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BookingsTable
          isPending={bookingsQuery.isPending}
          isError={bookingsQuery.isError}
          rows={bookingsQuery.data?.items ?? []}
          fmt={fmt}
          isAr={isAr}
          labels={L}
        />
        <ProviderEarningsTable
          isPending={providerEarningsQuery.isPending}
          isError={providerEarningsQuery.isError}
          rows={providerEarningsQuery.data?.items ?? []}
          fmt={fmt}
          labels={L}
        />
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
  amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
  indigo: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300',
  blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
};

function SummaryTile({
  label,
  value,
  tone,
  footnote,
}: {
  label: string;
  value: string;
  tone: keyof typeof TONE;
  footnote?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 ${TONE[tone]}`}
    >
      <p style={{ fontSize: '11px', fontWeight: 700 }}>{label}</p>
      <p style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.01em' }}>{value}</p>
      {footnote ? (
        <p className="opacity-70 mt-0.5" style={{ fontSize: '10px' }}>
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

interface FinancialsBookingRowLite {
  id: string;
  amount: number;
  netAmount: number;
  occurredAt: string;
  service: {
    categoryLabelEn: string | null;
    categoryLabelAr: string | null;
    customServiceText: string | null;
  };
  provider: { displayName: string };
}

function BookingsTable({
  isPending,
  isError,
  rows,
  fmt,
  isAr,
  labels,
}: {
  isPending: boolean;
  isError: boolean;
  rows: FinancialsBookingRowLite[];
  fmt: (n: number) => string;
  isAr: boolean;
  labels: {
    bookingsTitle: string;
    bookingsEmpty: string;
    loading: string;
    failed: string;
    cols: { booking: string; provider: string; amount: string; net: string; when: string };
  };
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
      <p
        className="px-4 py-3 text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700"
        style={{ fontSize: '14px', fontWeight: 700 }}
      >
        {labels.bookingsTitle}
      </p>
      {isPending ? (
        <p className="py-10 text-center text-slate-400" role="status" style={{ fontSize: '12px' }}>
          {labels.loading}
        </p>
      ) : isError ? (
        <p className="py-10 text-center text-rose-600" role="status" style={{ fontSize: '12px' }}>
          {labels.failed}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-slate-400" role="status" style={{ fontSize: '12px' }}>
          {labels.bookingsEmpty}
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-700">
              {[
                labels.cols.booking,
                labels.cols.provider,
                labels.cols.amount,
                labels.cols.net,
                labels.cols.when,
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-slate-500 text-start"
                  style={{ fontSize: '10px', fontWeight: 700 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const label =
                (isAr ? r.service.categoryLabelAr : r.service.categoryLabelEn) ??
                r.service.customServiceText ??
                r.id;
              return (
                <tr key={r.id} className="border-b border-slate-50 dark:border-slate-700">
                  <td className="px-3 py-2" style={{ fontSize: '12px', fontWeight: 600 }}>
                    {label}
                  </td>
                  <td className="px-3 py-2 text-slate-500" style={{ fontSize: '12px' }}>
                    {r.provider.displayName}
                  </td>
                  <td className="px-3 py-2" style={{ fontSize: '12px', fontWeight: 700 }}>
                    {fmt(r.amount)}
                  </td>
                  <td
                    className="px-3 py-2 text-green-600"
                    style={{ fontSize: '12px', fontWeight: 700 }}
                  >
                    {fmt(r.netAmount)}
                  </td>
                  <td className="px-3 py-2 text-slate-400" style={{ fontSize: '11px' }}>
                    {new Date(r.occurredAt).toLocaleDateString(isAr ? 'ar' : 'en')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface ProviderEarningsRowLite {
  providerId: string;
  displayName: string;
  completedBookings: number;
  grossEarnings: number;
  netEarnings: number;
}

function ProviderEarningsTable({
  isPending,
  isError,
  rows,
  fmt,
  labels,
}: {
  isPending: boolean;
  isError: boolean;
  rows: ProviderEarningsRowLite[];
  fmt: (n: number) => string;
  labels: {
    providersTitle: string;
    providersEmpty: string;
    loading: string;
    failed: string;
    cols: { providerCol: string; bookings: string; gross: string; netCol: string };
  };
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
      <p
        className="px-4 py-3 text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700"
        style={{ fontSize: '14px', fontWeight: 700 }}
      >
        {labels.providersTitle}
      </p>
      {isPending ? (
        <p className="py-10 text-center text-slate-400" role="status" style={{ fontSize: '12px' }}>
          {labels.loading}
        </p>
      ) : isError ? (
        <p className="py-10 text-center text-rose-600" role="status" style={{ fontSize: '12px' }}>
          {labels.failed}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-slate-400" role="status" style={{ fontSize: '12px' }}>
          {labels.providersEmpty}
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-700">
              {[
                labels.cols.providerCol,
                labels.cols.bookings,
                labels.cols.gross,
                labels.cols.netCol,
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-slate-500 text-start"
                  style={{ fontSize: '10px', fontWeight: 700 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.providerId} className="border-b border-slate-50 dark:border-slate-700">
                <td className="px-3 py-2" style={{ fontSize: '12px', fontWeight: 600 }}>
                  {r.displayName}
                </td>
                <td className="px-3 py-2 text-slate-500" style={{ fontSize: '12px' }}>
                  {r.completedBookings}
                </td>
                <td className="px-3 py-2" style={{ fontSize: '12px', fontWeight: 700 }}>
                  {fmt(r.grossEarnings)}
                </td>
                <td
                  className="px-3 py-2 text-green-600"
                  style={{ fontSize: '12px', fontWeight: 700 }}
                >
                  {fmt(r.netEarnings)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
