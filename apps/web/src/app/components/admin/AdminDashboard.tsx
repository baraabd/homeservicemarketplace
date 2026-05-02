import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  DollarSign,
  AlertTriangle,
  Bell,
  ChevronRight,
  Check,
  X,
  Eye,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  Activity,
  Zap,
  Clock,
  Star,
  CheckCircle2,
  LogOut,
  Menu,
  Flame,
  Settings,
  Save,
  Info,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
} from 'recharts';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
import { useEcosystem, WALLET_TRANSACTIONS } from '../../context/EcosystemContext';
import { useAuthIdentity } from '../../../lib/use-auth-identity';
import { useAuth } from '../../../lib/auth-provider';
import {
  useAdminRoles,
  useAdminUserDetail,
  useAdminUsers,
  useUpdateAdminUserStatus,
} from '../../hooks/admin/useAdminUsers';
import { VerificationSection } from './VerificationSection';
import type {
  AdminUserStatus,
  AdminUserSummary,
  UpdateUserStatusRequest,
} from '@homeservicemarketplace/contracts';

// ─── Types ─────────────────────────────────────────────────────────────────────
type Section = 'dashboard' | 'users' | 'verification' | 'financials' | 'disputes' | 'settings';

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon,
  label,
  value,
  sub,
  trend,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  trend: number;
  color: string;
}) {
  const [displayed, setDisplayed] = useState(0);
  const numVal = typeof value === 'number' ? value : parseFloat(String(value).replace(/\D/g, ''));

  useEffect(() => {
    let start = 0;
    const step = numVal / 40;
    const timer = setInterval(() => {
      start += step;
      if (start >= numVal) {
        setDisplayed(numVal);
        clearInterval(timer);
      } else setDisplayed(Math.floor(start));
    }, 18);
    return () => clearInterval(timer);
  }, [numVal]);

  return (
    <motion.div
      whileHover={{ y: -3, boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}
      className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          {icon}
        </div>
        <div
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full ${trend >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}
        >
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span style={{ fontSize: '11px', fontWeight: 700 }}>{Math.abs(trend)}%</span>
        </div>
      </div>
      <div>
        <p className="text-slate-400 dark:text-slate-500 mb-1" style={{ fontSize: '12px' }}>
          {label}
        </p>
        <p
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '26px', fontWeight: 900, letterSpacing: '-0.02em' }}
        >
          {typeof value === 'string' && value.startsWith('$')
            ? `$${displayed.toLocaleString()}`
            : displayed.toLocaleString()}
        </p>
        <p
          className="text-slate-400 dark:text-slate-500"
          style={{ fontSize: '11px', marginTop: '2px' }}
        >
          {sub}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Heat Map Widget ───────────────────────────────────────────────────────────
const HEAT_GRID = [
  [0, 1, 0, 2, 3, 1, 0, 1],
  [1, 3, 5, 7, 4, 2, 1, 0],
  [0, 2, 8, 9, 6, 3, 1, 0],
  [1, 4, 7, 10, 8, 5, 2, 1],
  [0, 3, 6, 8, 7, 4, 2, 1],
  [1, 2, 5, 6, 5, 3, 1, 0],
  [0, 1, 3, 4, 3, 2, 1, 0],
  [0, 0, 1, 2, 2, 1, 0, 0],
];
const DISTRICTS = [
  'Al Olaya',
  'Al Malqa',
  'Diplomatic Q.',
  'King Fahd Rd',
  'Al Nakheel',
  'Sulaymaniyah',
  'Al Yasmin',
  'Hittin',
];

function HeatMapWidget({ lang }: { lang: string }) {
  const maxVal = 10;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {lang === 'ar' ? 'خريطة حرارة الطلبات' : 'Service Request Heat Map'}
          </h3>
          <p className="text-slate-400" style={{ fontSize: '11px' }}>
            Riyadh City · Live data
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-100 dark:border-red-800">
          <Flame size={12} className="text-red-500" />
          <span
            className="text-red-600 dark:text-red-400"
            style={{ fontSize: '11px', fontWeight: 700 }}
          >
            Live
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 flex flex-col gap-1 mb-3">
        {HEAT_GRID.map((row, ri) => (
          <div key={ri} className="flex gap-1 flex-1">
            {row.map((val, ci) => {
              const intensity = val / maxVal;
              const alpha = 0.08 + intensity * 0.92;
              return (
                <motion.div
                  key={ci}
                  whileHover={{ scale: 1.15, zIndex: 10 }}
                  className="flex-1 rounded-md cursor-default relative group"
                  style={{ background: `rgba(239,68,68,${alpha})` }}
                  title={`${DISTRICTS[ci] ?? ''}: ${val * 3} requests`}
                >
                  {val >= 7 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-white" style={{ fontSize: '8px', fontWeight: 800 }}>
                        {val * 3}
                      </span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2">
        <span className="text-slate-400" style={{ fontSize: '10px' }}>
          {lang === 'ar' ? 'منخفض' : 'Low'}
        </span>
        <div
          className="flex-1 h-2 rounded-full"
          style={{ background: 'linear-gradient(90deg, rgba(239,68,68,0.1), rgba(239,68,68,1))' }}
        />
        <span className="text-slate-400" style={{ fontSize: '10px' }}>
          {lang === 'ar' ? 'مرتفع' : 'High'}
        </span>
      </div>
    </div>
  );
}

// ─── Financials Section ────────────────────────────────────────────────────────
const MONTHLY_DATA = [
  { m: 'Jul', rev: 8200, pay: 6100 },
  { m: 'Aug', rev: 9800, pay: 7300 },
  { m: 'Sep', rev: 11200, pay: 8400 },
  { m: 'Oct', rev: 10500, pay: 7800 },
  { m: 'Nov', rev: 13100, pay: 9900 },
  { m: 'Dec', rev: 14820, pay: 11100 },
];

function FinancialsSection({ lang }: { lang: string }) {
  const L = {
    title: lang === 'ar' ? 'التقارير المالية' : 'Financial Reports',
    revenue: lang === 'ar' ? 'الإيرادات' : 'Revenue',
    payouts: lang === 'ar' ? 'المدفوعات' : 'Payouts',
    netRevenue: lang === 'ar' ? 'صافي الإيرادات' : 'Net Revenue',
    platformFee: lang === 'ar' ? 'عمولة المنصة' : 'Platform Fee',
    byCategory: lang === 'ar' ? 'حسب الفئة' : 'By Category',
    recent: lang === 'ar' ? 'معاملات حديثة' : 'Recent Transactions',
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            val: '$14,820',
            label: L.revenue,
            color: 'text-green-600',
            bg: 'bg-green-50 dark:bg-green-900/20',
          },
          {
            val: '$11,100',
            label: L.payouts,
            color: 'text-blue-600',
            bg: 'bg-blue-50 dark:bg-blue-900/20',
          },
          {
            val: '$3,720',
            label: L.netRevenue,
            color: 'text-amber-600',
            bg: 'bg-amber-50 dark:bg-amber-900/20',
          },
        ].map((c) => (
          <div key={c.label} className={`${c.bg} rounded-2xl p-5`}>
            <p className="text-slate-400" style={{ fontSize: '12px' }}>
              {c.label}
            </p>
            <p className={c.color} style={{ fontSize: '24px', fontWeight: 900 }}>
              {c.val}
            </p>
            <p
              className="text-green-500 mt-1 flex items-center gap-1"
              style={{ fontSize: '11px', fontWeight: 600 }}
            >
              <TrendingUp size={11} />
              +12.4% vs last month
            </p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Revenue chart */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5">
          <p
            className="text-slate-900 dark:text-white mb-4"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            {L.revenue} vs {L.payouts}
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={MONTHLY_DATA} barGap={4}>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="m"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                }}
                formatter={(v: number) => [`$${v.toLocaleString()}`]}
              />
              <Bar dataKey="rev" name="Revenue" fill="#F59E0B" radius={[6, 6, 0, 0]} />
              <Bar dataKey="pay" name="Payouts" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              <Legend iconType="circle" iconSize={8} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <p
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {L.recent}
          </p>
          <button
            className="text-amber-600 flex items-center gap-1"
            style={{ fontSize: '12px', fontWeight: 600 }}
          >
            {lang === 'ar' ? 'عرض الكل' : 'View all'}{' '}
            <ChevronRight size={14} className="rtl:rotate-180" />
          </button>
        </div>
        {WALLET_TRANSACTIONS.slice(0, 5).map((tx) => (
          <div key={tx.id} className={`flex items-center justify-between px-5 py-3.5`}>
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center ${tx.type === 'earning' ? 'bg-green-100 dark:bg-green-900/30' : tx.type === 'pending' ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}
              >
                {tx.type === 'earning' ? (
                  <TrendingUp size={13} className="text-green-600" />
                ) : tx.type === 'pending' ? (
                  <Clock size={13} className="text-amber-600" />
                ) : (
                  <DollarSign size={13} className="text-red-600" />
                )}
              </div>
              <div>
                <p
                  className="text-slate-800 dark:text-slate-100"
                  style={{ fontSize: '13px', fontWeight: 600 }}
                >
                  {lang === 'ar' ? tx.descAr : tx.desc}
                </p>
                <p className="text-slate-400" style={{ fontSize: '11px' }}>
                  {tx.date}
                </p>
              </div>
            </div>
            <p
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: tx.amount > 0 ? '#16a34a' : '#dc2626',
              }}
            >
              {tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Disputes Section ──────────────────────────────────────────────────────────
const DISPUTES = [
  {
    id: 'd1',
    caseId: '#2041',
    seeker: 'Ahmed K.',
    pro: 'Khalid A.',
    service: 'Plumbing',
    issue: 'Job quality',
    amount: '$35',
    status: 'open',
    priority: 'high',
    opened: '2h ago',
  },
  {
    id: 'd2',
    caseId: '#2038',
    seeker: 'Sara R.',
    pro: 'Noura G.',
    service: 'Cleaning',
    issue: 'No-show',
    amount: '$80',
    status: 'review',
    priority: 'medium',
    opened: '5h ago',
  },
  {
    id: 'd3',
    caseId: '#2035',
    seeker: 'Omar H.',
    pro: 'Tariq H.',
    service: 'AC Repair',
    issue: 'Overcharging',
    amount: '$55',
    status: 'resolved',
    priority: 'low',
    opened: '1d ago',
  },
  {
    id: 'd4',
    caseId: '#2031',
    seeker: 'Nora S.',
    pro: 'Hamza R.',
    service: 'Electrical',
    issue: 'Incomplete work',
    amount: '$40',
    status: 'open',
    priority: 'high',
    opened: '1d ago',
  },
];
const DISPUTE_STATUS = {
  open: {
    label: 'Open',
    labelAr: 'مفتوح',
    bg: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  review: {
    label: 'Review',
    labelAr: 'مراجعة',
    bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  resolved: {
    label: 'Resolved',
    labelAr: 'محلول',
    bg: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
};
const PRIORITY_COLOR = { high: 'text-red-500', medium: 'text-amber-500', low: 'text-slate-400' };

function DisputeSection({ lang }: { lang: string }) {
  const [disputes, setDisputes] = useState(DISPUTES);
  const L = {
    title: lang === 'ar' ? 'مركز النزاعات' : 'Dispute Center',
    resolve: lang === 'ar' ? 'حل' : 'Resolve',
    refund: lang === 'ar' ? 'استرداد' : 'Refund',
    view: lang === 'ar' ? 'عرض' : 'View',
    caseId: lang === 'ar' ? 'رقم القضية' : 'Case ID',
    parties: lang === 'ar' ? 'الأطراف' : 'Parties',
    service: lang === 'ar' ? 'الخدمة' : 'Service',
    issue: lang === 'ar' ? 'المشكلة' : 'Issue',
    amount: lang === 'ar' ? 'المبلغ' : 'Amount',
    status: lang === 'ar' ? 'الحالة' : 'Status',
    priority: lang === 'ar' ? 'الأولوية' : 'Priority',
    actions: lang === 'ar' ? 'الإجراءات' : 'Actions',
  };
  const resolve = (id: string) =>
    setDisputes((prev) => prev.map((d) => (d.id === id ? { ...d, status: 'resolved' } : d)));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            val: disputes.filter((d) => d.status === 'open').length,
            label: 'Open',
            color: 'text-red-600',
            bg: 'bg-red-50 dark:bg-red-900/20',
          },
          {
            val: disputes.filter((d) => d.status === 'review').length,
            label: 'In Review',
            color: 'text-amber-600',
            bg: 'bg-amber-50 dark:bg-amber-900/20',
          },
          {
            val: disputes.filter((d) => d.status === 'resolved').length,
            label: 'Resolved',
            color: 'text-green-600',
            bg: 'bg-green-50 dark:bg-green-900/20',
          },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-2xl p-4 flex items-center gap-3`}>
            <AlertTriangle size={20} className={s.color} />
            <div>
              <p className={s.color} style={{ fontSize: '24px', fontWeight: 900 }}>
                {s.val}
              </p>
              <p className="text-slate-400" style={{ fontSize: '12px' }}>
                {s.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <div
          className="grid gap-3 px-5 py-3.5 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700"
          style={{ gridTemplateColumns: '0.8fr 1.6fr 1fr 1.2fr 0.8fr 0.9fr 0.7fr 1.4fr' }}
        >
          {[L.caseId, L.parties, L.service, L.issue, L.amount, L.status, L.priority, L.actions].map(
            (h) => (
              <span
                key={h}
                className="text-slate-400 dark:text-slate-500"
                style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}
              >
                {h}
              </span>
            ),
          )}
        </div>
        {disputes.map((d) => {
          const ss = DISPUTE_STATUS[d.status as keyof typeof DISPUTE_STATUS];
          return (
            <div
              key={d.id}
              className={`grid gap-3 px-5 py-4 items-center border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30`}
              style={{ gridTemplateColumns: '0.8fr 1.6fr 1fr 1.2fr 0.8fr 0.9fr 0.7fr 1.4fr' }}
            >
              <span
                className="text-amber-600 dark:text-amber-400"
                style={{ fontSize: '12px', fontWeight: 700 }}
              >
                {d.caseId}
              </span>
              <div>
                <p
                  className="text-slate-900 dark:text-white"
                  style={{ fontSize: '12px', fontWeight: 600 }}
                >
                  {d.seeker}
                </p>
                <p className="text-slate-400" style={{ fontSize: '11px' }}>
                  vs {d.pro}
                </p>
              </div>
              <span className="text-slate-600 dark:text-slate-300" style={{ fontSize: '12px' }}>
                {d.service}
              </span>
              <span className="text-slate-500 dark:text-slate-400" style={{ fontSize: '12px' }}>
                {d.issue}
              </span>
              <span
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '13px', fontWeight: 700 }}
              >
                {d.amount}
              </span>
              <span
                className={`px-2 py-1 rounded-lg w-fit ${ss.bg}`}
                style={{ fontSize: '11px', fontWeight: 700 }}
              >
                {lang === 'ar' ? ss.labelAr : ss.label}
              </span>
              <span
                className={`${PRIORITY_COLOR[d.priority as keyof typeof PRIORITY_COLOR]} capitalize`}
                style={{ fontSize: '11px', fontWeight: 600 }}
              >
                {d.priority}
              </span>
              <div className="flex items-center gap-1.5">
                {d.status !== 'resolved' && (
                  <button
                    onClick={() => resolve(d.id)}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-green-500 text-white active:scale-95 transition-all shadow-sm"
                    style={{ fontSize: '11px', fontWeight: 700 }}
                  >
                    <Check size={10} />
                    {L.resolve}
                  </button>
                )}
                <button
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 active:scale-95"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {L.refund}
                </button>
                <button
                  className="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 active:scale-95"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  <Eye size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dashboard Overview ────────────────────────────────────────────────────────
function DashboardOverview({ lang }: { lang: string }) {
  const {
    requests,
    adminNotifs,
    markAdminRead,
    totalRevenue,
    activeUsers,
    pendingVerifs,
    activeDisputes,
  } = useEcosystem();

  const L = {
    overview: lang === 'ar' ? 'نظرة عامة' : 'Overview',
    kpi1: lang === 'ar' ? 'المستخدمون النشطون' : 'Active Users',
    kpi2: lang === 'ar' ? 'إيرادات اليوم' : 'Daily Revenue',
    kpi3: lang === 'ar' ? 'طلبات التحقق' : 'Pending Verifs',
    kpi4: lang === 'ar' ? 'النزاعات النشطة' : 'Active Disputes',
    activity: lang === 'ar' ? 'آخر الأنشطة' : 'Recent Activity',
    allReqs: lang === 'ar' ? 'آخر الطلبات' : 'Latest Requests',
    markRead: lang === 'ar' ? 'تحديد الكل' : 'Mark all read',
    pending: lang === 'ar' ? 'انتظار' : 'Pending',
    bidding: lang === 'ar' ? 'عروض' : 'Bidding',
    assigned: lang === 'ar' ? 'مُعيَّن' : 'Assigned',
  };

  const unread = adminNotifs.filter((n) => !n.read).length;

  const NOTIF_ICON: Record<string, React.ReactNode> = {
    new_request: <Zap size={13} className="text-white" />,
    new_bid: <DollarSign size={13} className="text-white" />,
    bid_accepted: <CheckCircle2 size={13} className="text-white" />,
    job_complete: <Star size={13} className="text-white" />,
    new_pro: <Users size={13} className="text-white" />,
  };
  const NOTIF_BG: Record<string, string> = {
    new_request: 'bg-amber-500',
    new_bid: 'bg-blue-500',
    bid_accepted: 'bg-green-500',
    job_complete: 'bg-purple-500',
    new_pro: 'bg-indigo-500',
  };

  return (
    <div className="flex flex-col gap-6">
      {/* KPI grid */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          icon={<Users size={20} className="text-blue-600" />}
          label={L.kpi1}
          value={activeUsers}
          sub="+234 this week"
          trend={8.2}
          color="bg-blue-100 dark:bg-blue-900/30"
        />
        <KpiCard
          icon={<DollarSign size={20} className="text-green-600" />}
          label={L.kpi2}
          value={`$${totalRevenue}`}
          sub="Platform 25% fee"
          trend={12.4}
          color="bg-green-100 dark:bg-green-900/30"
        />
        <KpiCard
          icon={<ShieldCheck size={20} className="text-amber-600" />}
          label={L.kpi3}
          value={pendingVerifs}
          sub="Awaiting review"
          trend={-3.1}
          color="bg-amber-100 dark:bg-amber-900/30"
        />
        <KpiCard
          icon={<AlertTriangle size={20} className="text-red-500" />}
          label={L.kpi4}
          value={activeDisputes}
          sub="2 high priority"
          trend={-5.6}
          color="bg-red-100 dark:bg-red-900/30"
        />
      </div>

      {/* Charts + heat map row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Revenue trend */}
        <div className="col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '15px', fontWeight: 700 }}
            >
              {lang === 'ar' ? 'اتجاه الإيرادات' : 'Revenue Trend'}
            </p>
            <span
              className="px-2.5 py-1 rounded-full bg-green-50 text-green-600"
              style={{ fontSize: '11px', fontWeight: 700 }}
            >
              +12.4%
            </span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={MONTHLY_DATA} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="amberGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="m"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                }}
                formatter={(v: number) => [`$${v.toLocaleString()}`]}
              />
              <Area
                type="monotone"
                dataKey="rev"
                stroke="#F59E0B"
                strokeWidth={2.5}
                fill="url(#amberGrad)"
                dot={{ fill: '#F59E0B', r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {/* Heat map */}
        <HeatMapWidget lang={lang} />
      </div>

      {/* Activity + Requests row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Recent activity */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-slate-500" />
              <p
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '15px', fontWeight: 700 }}
              >
                {L.activity}
              </p>
              {unread > 0 && (
                <span
                  className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                  style={{ fontSize: '10px', fontWeight: 800 }}
                >
                  {unread}
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                onClick={() => adminNotifs.forEach((n) => markAdminRead(n.id))}
                className="text-amber-600 flex items-center gap-1"
                style={{ fontSize: '11px', fontWeight: 600 }}
              >
                <CheckCircle2 size={11} />
                {L.markRead}
              </button>
            )}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '260px', scrollbarWidth: 'none' }}>
            {adminNotifs.slice(0, 8).map((n) => (
              <motion.div
                key={n.id}
                whileHover={{ backgroundColor: 'rgba(0,0,0,0.02)' }}
                onClick={() => markAdminRead(n.id)}
                className={`flex items-start gap-3 px-5 py-3 border-b border-slate-50 dark:border-slate-700 last:border-0 cursor-pointer ${!n.read ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${NOTIF_BG[n.type] ?? 'bg-slate-500'}`}
                >
                  {NOTIF_ICON[n.type] ?? <Bell size={13} className="text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-slate-800 dark:text-slate-100"
                    style={{ fontSize: '12px', fontWeight: n.read ? 400 : 600, lineHeight: '1.3' }}
                  >
                    {lang === 'ar' ? n.msgAr : n.msg}
                  </p>
                  <p className="text-slate-400" style={{ fontSize: '10px', marginTop: '2px' }}>
                    {n.time}
                  </p>
                </div>
                {!n.read && (
                  <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1" />
                )}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Latest requests */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '15px', fontWeight: 700 }}
            >
              {L.allReqs}
            </p>
            <span
              className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center"
              style={{ fontSize: '11px', fontWeight: 800 }}
            >
              {requests.length}
            </span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '260px', scrollbarWidth: 'none' }}>
            {requests.slice(0, 6).map((req) => (
              <div
                key={req.id}
                className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
              >
                <span style={{ fontSize: '20px' }}>{req.serviceIcon}</span>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-slate-900 dark:text-white truncate"
                    style={{ fontSize: '12px', fontWeight: 600 }}
                  >
                    {lang === 'ar' ? req.serviceAr : req.service}
                  </p>
                  <p className="text-slate-400 truncate" style={{ fontSize: '10px' }}>
                    {lang === 'ar' ? req.locationAr : req.location} · {req.seekerName}
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full flex-shrink-0 ${
                    req.status === 'pending'
                      ? 'bg-blue-100 text-blue-700'
                      : req.status === 'bidding'
                        ? 'bg-amber-100 text-amber-700'
                        : req.status === 'assigned'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-600'
                  }`}
                  style={{ fontSize: '10px', fontWeight: 700 }}
                >
                  {req.status === 'pending'
                    ? L.pending
                    : req.status === 'bidding'
                      ? `${req.bids.length} ${L.bidding}`
                      : L.assigned}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pricing Settings Section ─────────────────────────────────────────────────
function PricingSettingsSection({ lang }: { lang: string }) {
  const { showHourlyRate, setShowHourlyRate } = useEcosystem();
  const [localValue, setLocalValue] = useState(showHourlyRate);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const isAr = lang === 'ar';
  const isDirty = localValue !== showHourlyRate;

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      setShowHourlyRate(localValue);
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }, 800);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {isAr ? 'الإعدادات' : 'Settings'}
        </h2>
        <p className="text-slate-400 mt-1" style={{ fontSize: '13px' }}>
          {isAr ? 'إدارة إعدادات المنصة العامة' : 'Manage global platform configuration'}
        </p>
      </div>

      {/* Pricing Settings Card */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden mb-4">
        {/* Card header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <DollarSign size={17} className="text-amber-600" />
          </div>
          <div>
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '15px', fontWeight: 700 }}
            >
              {isAr ? 'إعدادات التسعير' : 'Pricing Settings'}
            </p>
            <p className="text-slate-400 dark:text-slate-500" style={{ fontSize: '11px' }}>
              {isAr
                ? 'التحكم في ما يراه العملاء من معلومات الأسعار'
                : 'Control what pricing info customers see'}
            </p>
          </div>
        </div>

        {/* Toggle row */}
        <div className="px-5 py-5">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <p
                  className="text-slate-800 dark:text-slate-100"
                  style={{ fontSize: '14px', fontWeight: 600 }}
                >
                  {isAr ? 'عرض سعر الساعة للعمال' : 'Show Handyman Hourly Rate'}
                </p>
                <span
                  className={`px-2 py-0.5 rounded-full border ${
                    localValue
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-slate-100 border-slate-200 text-slate-500'
                  }`}
                  style={{ fontSize: '10px', fontWeight: 700 }}
                >
                  {localValue ? (isAr ? 'مفعّل' : 'ON') : isAr ? 'معطّل' : 'OFF'}
                </span>
              </div>
              <p
                className="text-slate-500 dark:text-slate-400"
                style={{ fontSize: '12px', lineHeight: 1.55 }}
              >
                {isAr
                  ? 'فعّل هذا الخيار إذا أردت أن يرى العملاء سعر الساعة للعامل في تطبيق العميل. عطّله إذا لم يكن يجب إظهار الأسعار بالساعة.'
                  : "Enable this option if you want customers to see the handyman's hourly rate in the client app. Disable it if pricing should not be shown by hour."}
              </p>
            </div>
            {/* Toggle */}
            <button
              onClick={() => {
                setLocalValue((v) => !v);
                setSaved(false);
              }}
              className={`relative flex-shrink-0 w-14 h-7 rounded-full border-2 transition-all duration-300 focus:outline-none mt-0.5 ${
                localValue
                  ? 'bg-amber-500 border-amber-500 shadow-md shadow-amber-200 dark:shadow-none'
                  : 'bg-slate-200 dark:bg-slate-600 border-slate-200 dark:border-slate-600'
              }`}
            >
              <motion.div
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm"
                animate={{ x: localValue ? 28 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
          </div>

          {/* Visual preview */}
          <div className="mt-5 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700">
              <p
                className="text-slate-400 dark:text-slate-500"
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {isAr ? 'معاينة — بطاقة مزود الخدمة' : 'Live Preview — Provider Card'}
              </p>
            </div>
            <div className="p-4 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-amber-700" style={{ fontSize: '13px', fontWeight: 800 }}>
                    OK
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-slate-900 dark:text-white"
                    style={{ fontSize: '14px', fontWeight: 700 }}
                  >
                    Omar Al-Khalid
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <svg
                          key={s}
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="#F59E0B"
                          stroke="#F59E0B"
                          strokeWidth="1.5"
                        >
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      ))}
                      <span className="text-slate-500 ms-1" style={{ fontSize: '11px' }}>
                        4.9 (312)
                      </span>
                    </div>
                    <span className="text-slate-400" style={{ fontSize: '11px' }}>
                      · 540 {isAr ? 'وظيفة' : 'jobs'}
                    </span>
                  </div>
                </div>
                <AnimatePresence>
                  {localValue && (
                    <motion.div
                      key="price"
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ duration: 0.2 }}
                      className="flex-shrink-0 text-end"
                    >
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '20px', fontWeight: 800, lineHeight: 1.1 }}
                      >
                        $35
                      </p>
                      <p className="text-slate-400" style={{ fontSize: '11px' }}>
                        /hr
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Info note */}
          <div className="mt-4 flex items-start gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl px-4 py-3">
            <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p
              className="text-blue-700 dark:text-blue-400"
              style={{ fontSize: '12px', lineHeight: 1.5 }}
            >
              {isAr
                ? 'هذا إعداد عام للمنصة. سيُطبَّق على جميع بطاقات مقدمي الخدمة وصفحات العروض في تطبيق العميل فوراً.'
                : 'This is a platform-wide setting. It applies immediately to all provider cards, bid screens, and job detail pages across the client app.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between gap-3">
          <AnimatePresence>
            {saved && (
              <motion.div
                key="saved"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-2 text-green-600"
              >
                <CheckCircle2 size={15} />
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  {isAr ? 'تم الحفظ بنجاح!' : 'Changes saved!'}
                </span>
              </motion.div>
            )}
            {!saved && <div key="empty" />}
          </AnimatePresence>
          <div className="flex items-center gap-2">
            {isDirty && (
              <button
                onClick={() => {
                  setLocalValue(showHourlyRate);
                  setSaved(false);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all active:scale-95"
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {isAr ? 'إلغاء' : 'Discard'}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl transition-all active:scale-95 ${
                isDirty && !saving
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-200 dark:shadow-none hover:bg-amber-600'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
              style={{ fontSize: '13px', fontWeight: 700 }}
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              {saving
                ? isAr
                  ? 'جارٍ الحفظ…'
                  : 'Saving…'
                : isAr
                  ? 'حفظ التغييرات'
                  : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Future pricing modes hint */}
      <div className="bg-slate-100 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
            <Zap size={14} className="text-slate-400" />
          </div>
          <div>
            <p
              className="text-slate-600 dark:text-slate-400"
              style={{ fontSize: '13px', fontWeight: 600 }}
            >
              {isAr ? 'قريباً — أوضاع تسعير متقدمة' : 'Coming Soon — Advanced Pricing Modes'}
            </p>
            <p className="text-slate-400 mt-1" style={{ fontSize: '12px', lineHeight: 1.5 }}>
              {isAr
                ? 'سعر ثابت · من سعر معين · السعر عند الطلب · تسعير لكل مشروع'
                : 'Fixed price · Starting from · Price on request · Per-project pricing'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── User Control (Sprint 6.1) ────────────────────────────────────────────────
//
// Replaces the prior "Coming Soon" placeholder with a real, API-driven
// admin user table: search by query, filter by role + status, open the
// detail drawer, flip the user's status. All mutations are audited
// server-side; the hook tree invalidates the admin/users root on every
// successful PATCH so the table reconciles without a manual refetch.
const STATUS_OPTIONS: ReadonlyArray<AdminUserStatus | 'ALL'> = [
  'ALL',
  'ACTIVE',
  'SUSPENDED',
  'LOCKED',
  'PENDING_VERIFICATION',
];

function statusBadgeClass(status: AdminUserStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'SUSPENDED':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    case 'LOCKED':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'PENDING_VERIFICATION':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'DELETED':
      return 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

function UsersSection({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const [searchInput, setSearchInput] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | undefined>(undefined);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const usersQuery = useAdminUsers({
    query: committedQuery || undefined,
    role: roleFilter,
    status: statusFilter,
    limit: 50,
  });
  const rolesQuery = useAdminRoles();

  const items: AdminUserSummary[] = usersQuery.data?.items ?? [];

  const L = {
    title: isAr ? 'إدارة المستخدمين' : 'User Control',
    searchPlaceholder: isAr ? 'ابحث بالبريد أو الاسم' : 'Search by email or name',
    searchAction: isAr ? 'بحث' : 'Search',
    role: isAr ? 'الدور' : 'Role',
    status: isAr ? 'الحالة' : 'Status',
    allRoles: isAr ? 'كل الأدوار' : 'All roles',
    allStatuses: isAr ? 'كل الحالات' : 'All statuses',
    columns: {
      name: isAr ? 'المستخدم' : 'User',
      roles: isAr ? 'الأدوار' : 'Roles',
      status: isAr ? 'الحالة' : 'Status',
      created: isAr ? 'منذ' : 'Created',
    },
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    failed: isAr
      ? 'تعذّر تحميل المستخدمين. حاول مرة أخرى.'
      : 'Could not load users. Please try again.',
    empty: isAr ? 'لا يوجد مستخدمون مطابقون.' : 'No users match the current filters.',
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header + filter bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <div className="flex flex-wrap gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCommittedQuery(searchInput.trim());
            }}
            className="flex gap-2"
          >
            <div className="relative">
              <Search
                size={14}
                className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400"
              />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={L.searchPlaceholder}
                className="ps-9 pe-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                style={{ fontSize: '13px', minWidth: '240px' }}
                aria-label={L.searchPlaceholder}
              />
            </div>
            <button
              type="submit"
              className="px-3 py-2 rounded-2xl bg-blue-600 text-white"
              style={{ fontSize: '13px', fontWeight: 700 }}
            >
              {L.searchAction}
            </button>
          </form>
          <select
            value={roleFilter ?? ''}
            onChange={(e) => setRoleFilter(e.target.value || undefined)}
            className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            style={{ fontSize: '13px' }}
            aria-label={L.role}
          >
            <option value="">{L.allRoles}</option>
            {(rolesQuery.data?.items ?? []).map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter ?? 'ALL'}
            onChange={(e) =>
              setStatusFilter(
                e.target.value === 'ALL' ? undefined : (e.target.value as AdminUserStatus),
              )
            }
            className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            style={{ fontSize: '13px' }}
            aria-label={L.status}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'ALL' ? L.allStatuses : s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {usersQuery.isPending ? (
          <p
            className="py-12 text-center text-slate-400"
            role="status"
            style={{ fontSize: '13px' }}
          >
            {L.loading}
          </p>
        ) : usersQuery.isError ? (
          <p className="py-12 text-center text-rose-600" role="status" style={{ fontSize: '13px' }}>
            {L.failed}
          </p>
        ) : items.length === 0 ? (
          <p
            className="py-12 text-center text-slate-400"
            role="status"
            style={{ fontSize: '13px' }}
          >
            {L.empty}
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 text-start">
                <th
                  className="px-4 py-3 text-slate-500 text-start"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {L.columns.name}
                </th>
                <th
                  className="px-4 py-3 text-slate-500 text-start"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {L.columns.roles}
                </th>
                <th
                  className="px-4 py-3 text-slate-500 text-start"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {L.columns.status}
                </th>
                <th
                  className="px-4 py-3 text-slate-500 text-start"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {L.columns.created}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  className="border-b border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '13px', fontWeight: 600 }}
                    >
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="text-slate-400" style={{ fontSize: '11px' }}>
                      {u.email}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span
                          key={r}
                          className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                          style={{ fontSize: '10px', fontWeight: 600 }}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full ${statusBadgeClass(u.status)}`}
                      style={{ fontSize: '10px', fontWeight: 700 }}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500" style={{ fontSize: '11px' }}>
                    {new Date(u.createdAt).toLocaleDateString(isAr ? 'ar' : 'en')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedUserId ? (
        <UserDetailDrawer
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          lang={lang}
        />
      ) : null}
    </div>
  );
}

function UserDetailDrawer({
  userId,
  onClose,
  lang,
}: {
  userId: string;
  onClose: () => void;
  lang: string;
}) {
  const isAr = lang === 'ar';
  const detailQuery = useAdminUserDetail(userId);
  const setStatus = useUpdateAdminUserStatus();
  const { user: meUser } = useAuth();
  const isSelf = meUser?.id === userId;
  const user = detailQuery.data;

  const L = {
    detail: isAr ? 'تفاصيل المستخدم' : 'User detail',
    close: isAr ? 'إغلاق' : 'Close',
    suspend: isAr ? 'تعليق' : 'Suspend',
    activate: isAr ? 'تفعيل' : 'Activate',
    selfWarning: isAr ? 'لا يمكنك تعطيل حسابك الخاص.' : 'You cannot disable your own account.',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    error: isAr ? 'تعذّر تحميل التفاصيل.' : 'Could not load user details.',
    saving: isAr ? 'جارٍ الحفظ…' : 'Saving…',
    saveFailed: isAr ? 'فشل التحديث.' : 'Update failed.',
  };

  const onFlip = async (next: 'ACTIVE' | 'SUSPENDED') => {
    if (!user) return;
    const body: UpdateUserStatusRequest = { status: next };
    await setStatus.mutateAsync({ userId: user.id, body });
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-label={L.close} />
      <div className="relative ms-auto w-full max-w-md bg-white dark:bg-slate-800 h-full overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '18px', fontWeight: 800 }}
          >
            {L.detail}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
            aria-label={L.close}
          >
            <X size={18} />
          </button>
        </div>

        {detailQuery.isPending ? (
          <p className="text-slate-400" role="status" style={{ fontSize: '13px' }}>
            {L.loading}
          </p>
        ) : detailQuery.isError || !user ? (
          <p className="text-rose-600" role="status" style={{ fontSize: '13px' }}>
            {L.error}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '16px', fontWeight: 700 }}
              >
                {user.firstName} {user.lastName}
              </p>
              <p className="text-slate-500" style={{ fontSize: '13px' }}>
                {user.email}
              </p>
              <span
                className={`mt-1 inline-block w-fit px-2 py-1 rounded-full ${statusBadgeClass(user.status)}`}
                style={{ fontSize: '10px', fontWeight: 700 }}
              >
                {user.status}
              </span>
            </div>

            <div>
              <p className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
                {isAr ? 'الأدوار' : 'Roles'}
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {user.roles.map((r) => (
                  <span
                    key={r}
                    className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                    style={{ fontSize: '11px', fontWeight: 600 }}
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-slate-500" style={{ fontSize: '11px' }}>
              <div>
                <p style={{ fontWeight: 700 }}>{isAr ? 'تم التحقق' : 'Email verified'}</p>
                <p>
                  {user.emailVerifiedAt ? new Date(user.emailVerifiedAt).toLocaleString() : '—'}
                </p>
              </div>
              <div>
                <p style={{ fontWeight: 700 }}>MFA</p>
                <p>{user.mfaEnabled ? '✓' : '—'}</p>
              </div>
              <div>
                <p style={{ fontWeight: 700 }}>{isAr ? 'تاريخ الإنشاء' : 'Created'}</p>
                <p>{new Date(user.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p style={{ fontWeight: 700 }}>{isAr ? 'آخر تحديث' : 'Updated'}</p>
                <p>{new Date(user.updatedAt).toLocaleString()}</p>
              </div>
            </div>

            <div className="mt-2 flex flex-col gap-2">
              {isSelf ? (
                <p className="text-amber-600" style={{ fontSize: '12px' }} role="status">
                  {L.selfWarning}
                </p>
              ) : null}
              {user.status === 'ACTIVE' ? (
                <button
                  type="button"
                  disabled={isSelf || setStatus.isPending}
                  onClick={() => onFlip('SUSPENDED')}
                  className="w-full py-2 rounded-2xl bg-rose-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontSize: '14px', fontWeight: 700 }}
                >
                  {setStatus.isPending ? L.saving : L.suspend}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={setStatus.isPending}
                  onClick={() => onFlip('ACTIVE')}
                  className="w-full py-2 rounded-2xl bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontSize: '14px', fontWeight: 700 }}
                >
                  {setStatus.isPending ? L.saving : L.activate}
                </button>
              )}
              {setStatus.isError ? (
                <p className="text-rose-600" style={{ fontSize: '12px' }} role="status">
                  {L.saveFailed}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────
const SIDEBAR_ITEMS: { id: Section; icon: React.ReactNode; en: string; ar: string }[] = [
  { id: 'dashboard', icon: <LayoutDashboard size={18} />, en: 'Dashboard', ar: 'لوحة التحكم' },
  { id: 'users', icon: <Users size={18} />, en: 'User Control', ar: 'إدارة المستخدمين' },
  {
    id: 'verification',
    icon: <ShieldCheck size={18} />,
    en: 'Pro Verification',
    ar: 'توثيق المحترفين',
  },
  { id: 'financials', icon: <DollarSign size={18} />, en: 'Financials', ar: 'الماليات' },
  { id: 'disputes', icon: <AlertTriangle size={18} />, en: 'Dispute Center', ar: 'مركز النزاعات' },
  { id: 'settings', icon: <Settings size={18} />, en: 'Settings', ar: 'الإعدادات' },
];

// ─── Admin Dashboard shell ────────────────────────────────────────────────────
export function AdminDashboard() {
  const { lang, dir, darkMode, toggleDarkMode } = useLang();
  const { adminNotifs } = useEcosystem();
  const [activeSection, setActiveSection] = useState<Section>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const unread = adminNotifs.filter((n) => !n.read).length;

  // Identity binding (Sprint admin-identity patch). `useAuthIdentity`
  // returns null fields while /auth/me is loading or absent — we render
  // those as empty so the existing visual containers stay in place
  // without flashing fake "AD" / "admin@fixnow.app" copy. The "Platform
  // Administrator" string below is a generic role label, not a personal
  // name; it sits next to the user's real identity instead of replacing
  // it. RequireAdmin already gated this route, so reaching this render
  // means a real authenticated admin session exists once /me resolves.
  const identity = useAuthIdentity();
  const displayName = identity.displayName ?? '';
  const initials = identity.initials ?? '';
  const email = identity.email ?? '';
  const roleLabel = lang === 'ar' ? 'مدير المنصة' : 'Platform Administrator';

  const SECTION_TITLES: Record<Section, { en: string; ar: string }> = {
    dashboard: { en: 'Dashboard', ar: 'لوحة التحكم' },
    users: { en: 'User Control', ar: 'إدارة المستخدمين' },
    verification: { en: 'Pro Verification', ar: 'توثيق المحترفين' },
    financials: { en: 'Financials', ar: 'التقارير المالية' },
    disputes: { en: 'Dispute Center', ar: 'مركز النزاعات' },
    settings: { en: 'Settings', ar: 'الإعدادات' },
  };

  const fontFamily = lang === 'ar' ? "'Cairo','Inter',sans-serif" : "'Inter',sans-serif";

  return (
    <div
      className={`flex ${darkMode ? 'dark' : ''} min-h-screen`}
      style={{ fontFamily, direction: dir, background: '#f8fafc' }}
      dir={dir}
    >
      {/* ── Sidebar ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: dir === 'rtl' ? '100%' : '-100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir === 'rtl' ? '100%' : '-100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-64 flex-shrink-0 bg-slate-900 dark:bg-slate-950 flex flex-col min-h-screen z-20"
          >
            {/* Logo */}
            <div className="flex items-center gap-3 px-5 py-6 border-b border-white/10">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                <Zap size={18} className="text-white" />
              </div>
              <div>
                <p className="text-white" style={{ fontSize: '16px', fontWeight: 800 }}>
                  FixNow
                </p>
                <p className="text-white/40" style={{ fontSize: '10px' }}>
                  {lang === 'ar' ? 'لوحة الإدارة' : 'Admin Panel'}
                </p>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
              {SIDEBAR_ITEMS.map(({ id, icon, en, ar }) => {
                const active = activeSection === id;
                return (
                  <motion.button
                    key={id}
                    onClick={() => setActiveSection(id)}
                    whileTap={{ scale: 0.97 }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-start transition-all ${
                      active
                        ? 'bg-amber-500 text-white shadow-lg shadow-amber-900/40'
                        : 'text-white/60 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className={active ? 'text-white' : 'text-white/40'}>{icon}</span>
                    <span style={{ fontSize: '14px', fontWeight: active ? 700 : 400 }}>
                      {lang === 'ar' ? ar : en}
                    </span>
                    {id === 'verification' && (
                      <span
                        className="ms-auto w-5 h-5 rounded-full bg-amber-400/20 text-amber-300 flex items-center justify-center"
                        style={{ fontSize: '10px', fontWeight: 800 }}
                      >
                        7
                      </span>
                    )}
                    {id === 'disputes' && (
                      <span
                        className="ms-auto w-5 h-5 rounded-full bg-red-400/20 text-red-400 flex items-center justify-center"
                        style={{ fontSize: '10px', fontWeight: 800 }}
                      >
                        3
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </nav>

            {/* Sidebar footer */}
            <div className="px-3 py-4 border-t border-white/10">
              <div className="flex items-center gap-3 px-4 py-3">
                <div
                  data-testid="admin-sidebar-avatar"
                  className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0"
                >
                  <span className="text-white" style={{ fontSize: '12px', fontWeight: 800 }}>
                    {initials}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    data-testid="admin-sidebar-name"
                    className="text-white truncate"
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    {displayName}
                  </p>
                  <p
                    data-testid="admin-sidebar-email"
                    className="text-white/40 truncate"
                    style={{ fontSize: '10px' }}
                  >
                    {email || roleLabel}
                  </p>
                </div>
                <button
                  aria-label={lang === 'ar' ? 'تسجيل الخروج' : 'Sign out'}
                  className="text-white/40 hover:text-white/70 transition-colors"
                >
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Top bar */}
        <header className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm flex items-center justify-between px-6 py-4 z-10 sticky top-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition-all"
            >
              <Menu size={18} className="text-slate-600 dark:text-slate-300" />
            </button>
            <div>
              <h1
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '18px', fontWeight: 800 }}
              >
                {lang === 'ar'
                  ? SECTION_TITLES[activeSection].ar
                  : SECTION_TITLES[activeSection].en}
              </h1>
              <p className="text-slate-400" style={{ fontSize: '12px' }}>
                {new Date().toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="hidden md:flex items-center gap-2 bg-slate-100 dark:bg-slate-700 rounded-xl px-4 py-2.5 w-64">
              <Search size={14} className="text-slate-400" />
              <input
                placeholder={lang === 'ar' ? 'بحث…' : 'Search…'}
                className="flex-1 bg-transparent text-slate-600 dark:text-slate-300 placeholder-slate-400 outline-none"
                style={{ fontSize: '13px' }}
              />
            </div>

            {/* Dark mode */}
            <button
              onClick={toggleDarkMode}
              className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition-all"
            >
              <span style={{ fontSize: '14px' }}>{darkMode ? '☀️' : '🌙'}</span>
            </button>

            {/* Lang toggle */}
            <LangToggle />

            {/* Notifications */}
            <button className="relative w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition-all">
              <Bell size={17} className="text-slate-600 dark:text-slate-300" />
              {unread > 0 && (
                <span
                  className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center border-2 border-white dark:border-slate-800"
                  style={{ fontSize: '8px', fontWeight: 800 }}
                >
                  {unread}
                </span>
              )}
            </button>

            {/* Admin avatar */}
            <div
              data-testid="admin-topbar-avatar"
              title={displayName || roleLabel}
              className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"
            >
              <span className="text-white" style={{ fontSize: '11px', fontWeight: 800 }}>
                {initials}
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6 overflow-auto dark:bg-slate-900">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {activeSection === 'dashboard' && <DashboardOverview lang={lang} />}
              {activeSection === 'verification' && <VerificationSection />}
              {activeSection === 'financials' && <FinancialsSection lang={lang} />}
              {activeSection === 'disputes' && <DisputeSection lang={lang} />}
              {activeSection === 'settings' && <PricingSettingsSection lang={lang} />}
              {activeSection === 'users' && <UsersSection lang={lang} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
