import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Map,
  Briefcase,
  Wallet,
  User,
  ChevronRight,
  ChevronUp,
  X,
  Clock,
  DollarSign,
  Star,
  CheckCircle2,
  ArrowLeft,
  TrendingUp,
  Bell,
  WifiOff,
  MapPin,
  Navigation,
  Send,
  Award,
  BarChart2,
  LogOut,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
// Sprint 5.3 retired the legacy `useEcosystem` mock from this file —
// LiveJobsScreen + MyBidsScreen now read from the API. WALLET / EARNINGS
// constants are still imported for the WalletScreen which migrates in
// Sprint 5.6.
import { WALLET_TRANSACTIONS, EARNINGS_CHART_DATA } from '../../context/EcosystemContext';
import type { ServiceRequest } from '../../context/EcosystemContext';
import { ImageWithFallback } from '../ui/ImageWithFallback';
import {
  useProviderProfile,
  useUpdateProviderAvailability,
  useUpgradeToProvider,
} from '../../hooks/provider/useProviderProfile';
import { useAvailableJobs } from '../../hooks/provider/useAvailableJobs';
// useWithdrawBid is exported from the hook module for the My Bids
// follow-on UI work; the current ProviderApp only consumes useMyBids
// + useSubmitBid in this file. Listed here so the shape stays
// consistent when Sprint 5.4 adds withdraw buttons to the bid cards.
import { useMyBids, useSubmitBid } from '../../hooks/provider/useMyBids';
import {
  formatRelativeTime,
  formatResponseTime,
  iconForCategorySlug,
  mapAvailableJobToLegacy,
} from '../../../lib/provider/available-jobs-adapter';
import { useAuthIdentity } from '../../../lib/use-auth-identity';
import type {
  ProviderAvailability,
  ProviderProfileSummary,
} from '@homeservicemarketplace/contracts';
import { ProviderStatusState } from './ProviderStatusState';

// ─── Map image (unsplash) ────────────────────────────────────────────────────
const MAP_IMG =
  'https://images.unsplash.com/photo-1554616242-a3e806a99481?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjaXR5JTIwYWVyaWFsJTIwbWFwJTIwc3RyZWV0cyUyMHNhdGVsbGl0ZSUyMHZpZXd8ZW58MXx8fHwxNzczMjQ4NTc5fDA&ixlib=rb-4.1.0&q=80&w=1080';

// ─── Bidding Modal ────────────────────────────────────────────────────────────
// Time chip → response-time-in-minutes lookup. Used by the real
// /v1/me/provider/bids submit path (Sprint 5.3) so the wire carries
// `responseTimeMinutes` rather than the human-readable chip label.
const TIME_CHIP_MINUTES: Record<string, number> = {
  '30 min': 30,
  '1 hour': 60,
  '1–2 hours': 120,
  '2–4 hours': 240,
  'Half day': 240,
  'Full day': 480,
};

function BiddingModal({
  request,
  onClose,
  onSubmit,
}: {
  request: ServiceRequest;
  onClose: () => void;
  // Returns a promise that resolves on success, rejects on failure.
  // The modal drives its own sending / done / error state from the
  // promise — no setTimeout placeholders.
  onSubmit: (input: {
    price: number;
    timeLabel: string;
    responseTimeMinutes: number;
    note: string;
  }) => Promise<void>;
}) {
  const { lang } = useLang();
  const [price, setPrice] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const TIME_CHIPS = ['30 min', '1 hour', '1–2 hours', '2–4 hours', 'Half day', 'Full day'];
  const TIME_CHIPS_AR = ['30 دقيقة', 'ساعة', 'ساعة–ساعتين', '2–4 ساعات', 'نصف يوم', 'يوم كامل'];

  const L = {
    title: lang === 'ar' ? 'تقديم عرض' : 'Submit Offer',
    requestFor: lang === 'ar' ? 'طلب:' : 'For:',
    priceLabel: lang === 'ar' ? 'سعرك ($/ساعة)' : 'Your Price ($/hr)',
    pricePlh: lang === 'ar' ? 'مثال: 35' : 'e.g. 35',
    timeLabel: lang === 'ar' ? 'وقت التنفيذ' : 'Execution Time',
    noteLabel: lang === 'ar' ? 'ملاحظة للعميل' : 'Note to Client',
    notePlh: lang === 'ar' ? 'أخبر العميل عن خبرتك…' : 'Tell the client about your experience…',
    submit: lang === 'ar' ? 'إرسال العرض' : 'Send Offer',
    sending: lang === 'ar' ? 'جارٍ الإرسال…' : 'Sending…',
    sent: lang === 'ar' ? 'تم إرسال عرضك! 🎉' : 'Offer sent! 🎉',
    budget: lang === 'ar' ? 'ميزانية الطلب:' : 'Budget:',
    failed:
      lang === 'ar'
        ? 'تعذّر إرسال العرض. الرجاء المحاولة مرة أخرى.'
        : 'Could not send your offer. Please try again.',
  };

  const handleSubmit = async () => {
    if (!price || !time || sending) return;
    const amount = Math.round(parseFloat(price));
    if (!Number.isFinite(amount) || amount < 1) return;
    setSending(true);
    setSubmitError(null);
    try {
      await onSubmit({
        price: amount,
        timeLabel: time,
        responseTimeMinutes: TIME_CHIP_MINUTES[time] ?? 60,
        note,
      });
      setSending(false);
      setDone(true);
      // Auto-dismiss after a beat so the success cue is readable.
      setTimeout(() => {
        onClose();
        setDone(false);
      }, 1600);
    } catch {
      // Error message comes from the mutation; the wire body never
      // contains internal stack traces — the API maps everything to
      // safe envelopes.
      setSending(false);
      setSubmitError(L.failed);
    }
  };

  return (
    <>
      <motion.div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm z-30"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="absolute bottom-0 start-0 end-0 bg-white dark:bg-slate-800 rounded-t-3xl z-40 overflow-hidden"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600 mx-auto mt-3 mb-4" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 mb-4">
          <div>
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '18px', fontWeight: 800 }}
            >
              {L.title}
            </p>
            <p className="text-slate-400" style={{ fontSize: '12px' }}>
              {L.requestFor}{' '}
              <span className="text-amber-600 font-semibold">
                {lang === 'ar' ? request.serviceAr : request.service}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90"
          >
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        {/* Budget note */}
        <div className="mx-5 mb-4 flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 rounded-2xl px-4 py-2.5">
          <DollarSign size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <p className="text-blue-700 dark:text-blue-300" style={{ fontSize: '12px' }}>
            {L.budget} <span style={{ fontWeight: 700 }}>{request.budget}</span>
          </p>
        </div>

        {done ? (
          <motion.div
            className="flex flex-col items-center justify-center py-10 gap-3"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-green-500" />
            </div>
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '16px', fontWeight: 700 }}
            >
              {L.sent}
            </p>
          </motion.div>
        ) : (
          <div className="px-5 pb-6 flex flex-col gap-4">
            {/* Price */}
            <div>
              <p
                className="text-slate-600 dark:text-slate-300 mb-2"
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {L.priceLabel}
              </p>
              <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-3">
                <DollarSign size={16} className="text-slate-400" />
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={L.pricePlh}
                  min={1}
                  max={999}
                  className="flex-1 bg-transparent outline-none text-slate-900 dark:text-white placeholder-slate-400"
                  style={{ fontSize: '18px', fontWeight: 700 }}
                />
                <span className="text-slate-400" style={{ fontSize: '12px' }}>
                  USD/hr
                </span>
              </div>
            </div>

            {/* Time chips */}
            <div>
              <p
                className="text-slate-600 dark:text-slate-300 mb-2"
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {L.timeLabel}
              </p>
              <div className="flex flex-wrap gap-2">
                {TIME_CHIPS.map((chip, i) => {
                  const label = lang === 'ar' ? TIME_CHIPS_AR[i] : chip;
                  return (
                    <button
                      key={chip}
                      onClick={() => setTime(chip)}
                      className={`px-3 py-2 rounded-xl border-2 transition-all active:scale-95 ${
                        time === chip
                          ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                      }`}
                      style={{ fontSize: '12px', fontWeight: 600 }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note */}
            <div>
              <p
                className="text-slate-600 dark:text-slate-300 mb-2"
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {L.noteLabel}
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={L.notePlh}
                rows={2}
                className="w-full bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-3 text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                style={{ fontSize: '13px' }}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!price || !time || sending}
              className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl transition-all active:scale-95 ${
                !price || !time
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white shadow-lg shadow-blue-300/40'
              }`}
              style={{ fontSize: '15px', fontWeight: 800 }}
            >
              {sending ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  {L.sending}
                </>
              ) : (
                <>
                  <Send size={16} />
                  {L.submit}
                </>
              )}
            </button>

            {submitError && (
              <p
                role="alert"
                className="text-red-600 dark:text-red-400 text-center"
                style={{ fontSize: '12px', fontWeight: 600 }}
              >
                {submitError}
              </p>
            )}
          </div>
        )}
      </motion.div>
    </>
  );
}

// ─── Job pin component ────────────────────────────────────────────────────────
function JobPin({
  req,
  onTap,
  isSelected,
}: {
  req: ServiceRequest;
  onTap: () => void;
  isSelected: boolean;
}) {
  const urgentColor = req.urgency === 'urgent' ? '#ef4444' : '#3b82f6';
  const statusColor =
    req.status === 'pending' ? urgentColor : req.status === 'bidding' ? '#f59e0b' : '#10b981';
  return (
    <div
      className="absolute cursor-pointer"
      style={{
        left: `${req.mapX}%`,
        top: `${req.mapY}%`,
        transform: 'translate(-50%,-50%)',
        zIndex: isSelected ? 20 : 10,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
    >
      {/* Ripple */}
      {req.status === 'pending' && (
        <div
          className="absolute inset-0 rounded-full animate-ping opacity-40"
          style={{ background: statusColor, transform: 'scale(2)' }}
        />
      )}
      <motion.div
        whileHover={{ scale: 1.2 }}
        whileTap={{ scale: 0.9 }}
        className="relative w-10 h-10 rounded-2xl flex items-center justify-center shadow-xl border-2 border-white"
        style={{ background: statusColor }}
      >
        <span style={{ fontSize: '18px' }}>{req.serviceIcon}</span>
      </motion.div>
      {isSelected && (
        <motion.div
          initial={{ opacity: 0, y: 4, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="absolute bottom-full mb-2 start-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-3 w-44 border border-slate-100 dark:border-slate-700"
        >
          <p
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '13px', fontWeight: 700 }}
          >
            {req.service}
          </p>
          <p className="text-slate-400" style={{ fontSize: '11px' }}>
            {req.distance}km · {req.budget}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: statusColor }}
            />
            <span style={{ fontSize: '10px', color: statusColor, fontWeight: 600 }}>
              {req.status === 'pending'
                ? 'Awaiting bids'
                : req.status === 'bidding'
                  ? `${req.bids.length} bids`
                  : 'Assigned'}
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ─── Live Jobs Screen (Map) ───────────────────────────────────────────────────
function LiveJobsScreen() {
  const { lang } = useLang();
  const profileQuery = useProviderProfile();
  // Sprint 5.2: live feed of OPEN_FOR_BIDS service requests, polled
  // every 15s. The hook scopes to the provider's configured categories
  // server-side (or to all categories if none configured); explicit
  // category/city filters can be added once the marketplace UI grows
  // its filter chips.
  const availableJobsQuery = useAvailableJobs();
  const apiRequests = useMemo(
    () => (availableJobsQuery.data?.items ?? []).map(mapAvailableJobToLegacy),
    [availableJobsQuery.data],
  );
  // Sprint 5.3: real submit-bid mutation. Replaces the
  // `useEcosystem().submitBid` mock; the modal awaits the mutation
  // and React Query invalidates `provider/jobs` and `provider/bids`
  // on success so the feed and My Bids reflect the new state.
  const submitBidMutation = useSubmitBid();
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [biddingReq, setBiddingReq] = useState<ServiceRequest | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'bidding'>('all');

  // Map status pill: prefer the provider's configured service area; fall
  // back to a neutral "Online" label when none is set, never hardcoded
  // city text.
  const serviceAreaLabel = (() => {
    const profile = profileQuery.data?.profile;
    if (!profile) return lang === 'ar' ? 'متصل' : 'Online';
    const city = profile.serviceAreaCity?.trim();
    const country = profile.serviceAreaCountry?.trim();
    if (city && country) return `${city}, ${country}`;
    if (city) return city;
    if (country) return country;
    return lang === 'ar' ? 'متصل' : 'Online';
  })();

  // The feed only ships OPEN_FOR_BIDS rows (status maps to 'pending'
  // when bidsCount === 0 and 'bidding' otherwise). Sprint 5.4 will add
  // SCHEDULED bookings into a separate view; until then 'assigned' /
  // 'completed' do not appear here.
  const activeReqs = apiRequests;
  const filteredReqs =
    filterStatus === 'all' ? activeReqs : activeReqs.filter((r) => r.status === filterStatus);

  const L = {
    title: lang === 'ar' ? 'الوظائف النشطة' : 'Live Jobs',
    online: lang === 'ar' ? 'متصل · جاهز' : 'Online · Ready',
    all: lang === 'ar' ? 'الكل' : 'All',
    pending: lang === 'ar' ? 'جديد' : 'New',
    bidding: lang === 'ar' ? 'عروض' : 'Bidding',
    bid: lang === 'ar' ? 'قدم عرض' : 'Place Bid',
    km: lang === 'ar' ? 'كم' : 'km',
    nearby: lang === 'ar' ? 'طلبات قريبة منك' : 'Nearby requests',
    noJobs: lang === 'ar' ? 'لا توجد وظائف حالياً' : 'No jobs right now',
    drag: lang === 'ar' ? 'اسحب للأعلى لرؤية الطلبات' : 'Pull up to see requests',
    urgentTag: lang === 'ar' ? 'عاجل' : 'Urgent',
  };

  // Real submit. The mutation wraps the /v1/me/provider/bids POST;
  // it throws on failure so the modal can surface the safe error
  // copy. We deliberately do NOT close the modal on failure — the
  // user may correct the input and retry.
  const handleBidSubmit = async (input: {
    price: number;
    timeLabel: string;
    responseTimeMinutes: number;
    note: string;
  }) => {
    if (!biddingReq) return;
    await submitBidMutation.mutateAsync({
      requestId: biddingReq.id,
      amount: input.price,
      pricingType: 'HOURLY',
      note: input.note ? input.note : null,
      responseTimeMinutes: input.responseTimeMinutes,
    });
    setBiddingReq(null);
  };

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* Map */}
      <div className="flex-1 relative overflow-hidden" onClick={() => setSelectedPin(null)}>
        <ImageWithFallback
          src={MAP_IMG}
          alt="City map"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'brightness(0.7) saturate(0.8)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/30 to-slate-900/10" />

        {/* Top status bar */}
        <div className="absolute top-4 start-4 end-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md rounded-2xl px-3 py-2 border border-white/10">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white" style={{ fontSize: '12px', fontWeight: 600 }}>
              {L.online}
            </span>
          </div>
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md rounded-2xl px-3 py-2 border border-white/10">
            <Navigation size={12} className="text-blue-400" />
            <span className="text-white" style={{ fontSize: '12px' }}>
              {serviceAreaLabel}
            </span>
          </div>
        </div>

        {/* Job pins */}
        {activeReqs.map((req) => (
          <JobPin
            key={req.id}
            req={req}
            isSelected={selectedPin === req.id}
            onTap={() => setSelectedPin((prev) => (prev === req.id ? null : req.id))}
          />
        ))}

        {/* Drag handle */}
        {!sheetOpen && (
          <motion.button
            className="absolute bottom-4 start-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
            onClick={() => setSheetOpen(true)}
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 1.8 }}
          >
            <div className="bg-white/90 backdrop-blur-md rounded-full px-4 py-2 shadow-lg border border-white/20 flex items-center gap-2">
              <ChevronUp size={14} className="text-slate-500" />
              <span className="text-slate-700" style={{ fontSize: '12px', fontWeight: 600 }}>
                {L.drag}
              </span>
              <span
                className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center"
                style={{ fontSize: '10px', fontWeight: 800 }}
              >
                {activeReqs.filter((r) => r.status === 'pending').length}
              </span>
            </div>
          </motion.button>
        )}
      </div>

      {/* Bottom Sheet */}
      <AnimatePresence>
        {sheetOpen && (
          <motion.div
            className="absolute bottom-0 start-0 end-0 bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl z-20 flex flex-col"
            style={{ maxHeight: '65%' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Handle */}
            <div className="flex-shrink-0 flex flex-col items-center pt-3 pb-2">
              <button
                onClick={() => setSheetOpen(false)}
                className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600 mb-2"
              />
              <div className="flex items-center justify-between w-full px-4 pb-2">
                <p
                  className="text-slate-900 dark:text-white"
                  style={{ fontSize: '16px', fontWeight: 800 }}
                >
                  {L.nearby} · <span className="text-blue-600">{activeReqs.length}</span>
                </p>
                <div className="flex gap-1">
                  {(['all', 'pending', 'bidding'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilterStatus(f)}
                      className={`px-3 py-1.5 rounded-xl transition-all ${
                        filterStatus === f
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                      }`}
                      style={{ fontSize: '11px', fontWeight: 700 }}
                    >
                      {f === 'all' ? L.all : f === 'pending' ? L.pending : L.bidding}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Leads list */}
            <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'none' }}>
              {filteredReqs.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <MapPin size={24} className="text-slate-300" />
                  </div>
                  <p className="text-slate-400" style={{ fontSize: '14px' }}>
                    {L.noJobs}
                  </p>
                </div>
              ) : (
                filteredReqs.map((req) => (
                  <motion.div
                    key={req.id}
                    whileTap={{ scale: 0.98 }}
                    className="bg-slate-50 dark:bg-slate-700 rounded-3xl p-4 mb-3 cursor-pointer"
                    onClick={() => setSelectedPin(req.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 text-2xl">
                        {req.serviceIcon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p
                            className="text-slate-900 dark:text-white"
                            style={{ fontSize: '14px', fontWeight: 700 }}
                          >
                            {lang === 'ar' ? req.serviceAr : req.service}
                          </p>
                          {req.urgency === 'urgent' && (
                            <span
                              className="px-1.5 py-0.5 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
                              style={{ fontSize: '9px', fontWeight: 700 }}
                            >
                              {L.urgentTag}
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded-lg ${
                              req.status === 'pending'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                            style={{ fontSize: '9px', fontWeight: 700 }}
                          >
                            {req.status === 'pending' ? 'New' : `${req.bids.length} bids`}
                          </span>
                        </div>
                        <p
                          className="text-slate-400 dark:text-slate-400"
                          style={{ fontSize: '12px' }}
                        >
                          {lang === 'ar' ? req.locationAr : req.location}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <div className="flex items-center gap-1">
                            <MapPin size={11} className="text-blue-500" />
                            <span
                              className="text-blue-600 dark:text-blue-400"
                              style={{ fontSize: '11px', fontWeight: 600 }}
                            >
                              {req.distance}
                              {L.km}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <DollarSign size={11} className="text-green-500" />
                            <span
                              className="text-green-600 dark:text-green-400"
                              style={{ fontSize: '11px', fontWeight: 600 }}
                            >
                              {req.budget}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Star size={11} className="text-amber-500 fill-amber-500" />
                            <span className="text-slate-500" style={{ fontSize: '11px' }}>
                              {req.seekerName}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {req.status !== 'assigned' && req.status !== 'completed' && (
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                          e.stopPropagation();
                          setBiddingReq(req);
                          setSheetOpen(false);
                        }}
                        className="w-full mt-3 py-2.5 rounded-2xl bg-blue-600 text-white flex items-center justify-center gap-2 shadow-md shadow-blue-200 dark:shadow-none"
                        style={{ fontSize: '13px', fontWeight: 700 }}
                      >
                        <Send size={14} />
                        {L.bid}
                      </motion.button>
                    )}
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bidding modal */}
      <AnimatePresence>
        {biddingReq && (
          <BiddingModal
            request={biddingReq}
            onClose={() => setBiddingReq(null)}
            onSubmit={handleBidSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── My Bids Screen ───────────────────────────────────────────────────────────
// Sprint 5.3 — live read from /v1/me/provider/bids. The screen filters
// out WITHDRAWN bids client-side because the existing UI only renders
// 'pending' / 'accepted' / 'rejected' tabs.
function MyBidsScreen() {
  const { lang } = useLang();
  const myBidsQuery = useMyBids();

  const myBids = useMemo(() => {
    const items = myBidsQuery.data?.items ?? [];
    return items
      .filter((b) => b.status !== 'WITHDRAWN')
      .map((b) => {
        const labelEn = b.request.category?.labelEn ?? b.request.customServiceText ?? '';
        const labelAr = b.request.category?.labelAr ?? b.request.customServiceText ?? '';
        const icon = iconForCategorySlug(b.request.category?.slug ?? null);
        return {
          id: b.id,
          requestService: labelEn,
          requestServiceAr: labelAr,
          requestIcon: icon,
          // Wire deliberately omits seeker identity. Show city as the
          // anonymised "where" label until the bid is accepted, after
          // which the booking conversation surfaces the seeker name.
          seekerName: b.request.city,
          status: b.status.toLowerCase() as 'pending' | 'accepted' | 'rejected',
          price: b.amount,
          executionTime: formatResponseTime(b.responseTimeMinutes, lang),
          note: b.note ?? '',
          submittedAt: formatRelativeTime(b.submittedAt, lang),
        };
      });
  }, [myBidsQuery.data, lang]);

  const L = {
    title: lang === 'ar' ? 'عروضي' : 'My Bids',
    pending: lang === 'ar' ? 'قيد الانتظار' : 'Pending',
    accepted: lang === 'ar' ? 'مقبول' : 'Accepted',
    rejected: lang === 'ar' ? 'مرفوض' : 'Rejected',
    price: lang === 'ar' ? 'السعر:' : 'Price:',
    time: lang === 'ar' ? 'الوقت:' : 'Time:',
    startJob: lang === 'ar' ? 'ابدأ العمل' : 'Start Job',
    noBids: lang === 'ar' ? 'لم تقدم أي عروض بعد' : 'No bids submitted yet',
    noBidsSub:
      lang === 'ar'
        ? 'ابدأ بتقديم عروض على الطلبات القريبة'
        : 'Start placing bids on nearby requests',
    for: lang === 'ar' ? 'من' : 'for',
  };

  const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
    pending: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-700 dark:text-amber-400',
      label: L.pending,
    },
    accepted: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-700 dark:text-green-400',
      label: L.accepted,
    },
    rejected: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-red-600 dark:text-red-400',
      label: L.rejected,
    },
  };

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-5 pb-4">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <div className="flex gap-2 mt-3">
          {(['pending', 'accepted', 'rejected'] as const).map((s) => {
            const cnt = myBids.filter((b) => b.status === s).length;
            return (
              <div
                key={s}
                className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 ${STATUS_STYLE[s].bg}`}
              >
                <span
                  className={STATUS_STYLE[s].text}
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {STATUS_STYLE[s].label}
                </span>
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center ${STATUS_STYLE[s].text}`}
                  style={{ fontSize: '9px', fontWeight: 800, background: 'rgba(0,0,0,0.08)' }}
                >
                  {cnt}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-4">
        {myBids.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Briefcase size={32} className="text-slate-300" />
            </div>
            <div className="text-center">
              <p
                className="text-slate-700 dark:text-white"
                style={{ fontSize: '16px', fontWeight: 700 }}
              >
                {L.noBids}
              </p>
              <p className="text-slate-400 mt-1" style={{ fontSize: '13px' }}>
                {L.noBidsSub}
              </p>
            </div>
          </div>
        ) : (
          myBids.map((bid) => {
            const ss = STATUS_STYLE[bid.status];
            return (
              <motion.div
                key={bid.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-3"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-2xl flex-shrink-0">
                    {bid.requestIcon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '14px', fontWeight: 700 }}
                      >
                        {lang === 'ar' ? bid.requestServiceAr : bid.requestService}
                      </p>
                      <span
                        className={`px-2 py-0.5 rounded-lg ${ss.bg} ${ss.text}`}
                        style={{ fontSize: '10px', fontWeight: 700 }}
                      >
                        {ss.label}
                      </span>
                    </div>
                    <p className="text-slate-400" style={{ fontSize: '12px' }}>
                      {L.for} {bid.seekerName} · {bid.submittedAt}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 mb-3">
                  <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                    <p className="text-slate-400" style={{ fontSize: '10px' }}>
                      {L.price}
                    </p>
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '16px', fontWeight: 800 }}
                    >
                      ${bid.price}/hr
                    </p>
                  </div>
                  <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                    <p className="text-slate-400" style={{ fontSize: '10px' }}>
                      {L.time}
                    </p>
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '13px', fontWeight: 700 }}
                    >
                      {bid.executionTime}
                    </p>
                  </div>
                </div>

                {bid.note && (
                  <div className="bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2 mb-3">
                    <p
                      className="text-slate-500 dark:text-slate-400"
                      style={{ fontSize: '12px', lineHeight: '1.4' }}
                    >
                      "{bid.note}"
                    </p>
                  </div>
                )}

                {bid.status === 'accepted' && (
                  <button
                    className="w-full py-3 rounded-2xl bg-green-600 text-white flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md shadow-green-200 dark:shadow-none"
                    style={{ fontSize: '14px', fontWeight: 700 }}
                  >
                    <CheckCircle2 size={16} />
                    {L.startJob}
                  </button>
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Wallet Screen ────────────────────────────────────────────────────────────
function WalletScreen() {
  const { lang } = useLang();
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);

  const L = {
    title: lang === 'ar' ? 'المحفظة والأرباح' : 'Wallet & Earnings',
    balance: lang === 'ar' ? 'الرصيد الحالي' : 'Available Balance',
    pending: lang === 'ar' ? 'معلق' : 'Pending',
    thisWeek: lang === 'ar' ? 'هذا الأسبوع' : 'This Week',
    thisMonth: lang === 'ar' ? 'هذا الشهر' : 'This Month',
    withdraw: lang === 'ar' ? 'سحب الأرباح' : 'Withdraw Earnings',
    withdrwing: lang === 'ar' ? 'جارٍ السحب…' : 'Processing…',
    withdrawn: lang === 'ar' ? 'تم إرسال $200 للبنك ✓' : '$200 sent to bank ✓',
    history: lang === 'ar' ? 'سجل المعاملات' : 'Transaction History',
    earning: lang === 'ar' ? 'أرباح' : 'Earning',
    payout: lang === 'ar' ? 'سحب' : 'Payout',
    weeklyEarn: lang === 'ar' ? 'أرباح الأسبوع' : 'Weekly Earnings',
  };

  const handleWithdraw = () => {
    setWithdrawing(true);
    setTimeout(() => {
      setWithdrawing(false);
      setWithdrawn(true);
      setTimeout(() => setWithdrawn(false), 3000);
    }, 1500);
  };

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Header card */}
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 mx-4 mt-4 rounded-3xl p-6 relative overflow-hidden">
        <div className="absolute -top-8 -end-8 w-36 h-36 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 start-0 w-24 h-24 rounded-full bg-purple-500/20" />
        <div className="relative">
          <p className="text-white/70 mb-1" style={{ fontSize: '12px' }}>
            {L.balance}
          </p>
          <p
            className="text-white"
            style={{ fontSize: '38px', fontWeight: 900, letterSpacing: '-0.02em' }}
          >
            $1,240.00
          </p>
          <div className="flex gap-4 mt-4">
            <div className="bg-white/15 rounded-2xl px-3 py-2">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.pending}
              </p>
              <p className="text-white" style={{ fontSize: '16px', fontWeight: 700 }}>
                $45.00
              </p>
            </div>
            <div className="bg-white/15 rounded-2xl px-3 py-2">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.thisWeek}
              </p>
              <p className="text-white" style={{ fontSize: '16px', fontWeight: 700 }}>
                $310.00
              </p>
            </div>
            <div className="bg-white/15 rounded-2xl px-3 py-2">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.thisMonth}
              </p>
              <p className="text-white" style={{ fontSize: '16px', fontWeight: 700 }}>
                $1,240
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Withdraw button */}
      <div className="px-4 mt-3">
        <button
          onClick={handleWithdraw}
          className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2.5 transition-all active:scale-95 ${
            withdrawn
              ? 'bg-green-600 text-white'
              : 'bg-blue-600 text-white shadow-lg shadow-blue-200 dark:shadow-none'
          }`}
          style={{ fontSize: '15px', fontWeight: 800 }}
        >
          {withdrawing ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              {L.withdrwing}
            </>
          ) : withdrawn ? (
            <>
              <CheckCircle2 size={18} />
              {L.withdrawn}
            </>
          ) : (
            <>
              <TrendingUp size={18} />
              {L.withdraw}
            </>
          )}
        </button>
      </div>

      {/* Chart */}
      <div className="mx-4 mt-4 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4">
        <p
          className="text-slate-900 dark:text-white mb-3"
          style={{ fontSize: '14px', fontWeight: 700 }}
        >
          {L.weeklyEarn}
        </p>
        <ResponsiveContainer width="100%" height={110}>
          <AreaChart data={EARNINGS_CHART_DATA} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
            <defs>
              <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
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
                fontSize: '12px',
              }}
              formatter={(v: number) => [`$${v}`, 'Earnings']}
            />
            <Area
              type="monotone"
              dataKey="earn"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#blueGrad)"
              dot={{ fill: '#3b82f6', r: 3 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Transaction history */}
      <div className="mx-4 mt-4 mb-4">
        <p
          className="text-slate-900 dark:text-white mb-3"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {L.history}
        </p>
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          {WALLET_TRANSACTIONS.map((tx, i) => (
            <div
              key={tx.id}
              className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-slate-50 dark:border-slate-700' : ''}`}
            >
              <div
                className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  tx.type === 'earning'
                    ? 'bg-green-100 dark:bg-green-900/30'
                    : tx.type === 'pending'
                      ? 'bg-amber-100 dark:bg-amber-900/30'
                      : 'bg-red-100 dark:bg-red-900/30'
                }`}
              >
                {tx.type === 'earning' ? (
                  <TrendingUp size={14} className="text-green-600" />
                ) : tx.type === 'pending' ? (
                  <Clock size={14} className="text-amber-600" />
                ) : (
                  <ArrowLeft size={14} className="text-red-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
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
              <div className="text-end">
                <p
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: tx.amount > 0 ? '#16a34a' : '#dc2626',
                  }}
                >
                  {tx.amount > 0 ? '+' : ''}${Math.abs(tx.amount)}
                </p>
                {tx.status === 'pending' && (
                  <span className="text-amber-600" style={{ fontSize: '10px', fontWeight: 600 }}>
                    {lang === 'ar' ? 'معلق' : 'Pending'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Provider Profile ─────────────────────────────────────────────────────────
// Tailwind palette for skill chips. Cycled by index so the chip colours
// stay distinct without the previous hardcoded mapping (which only
// covered the four English skill names that no longer drive the data).
const SKILL_CHIP_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-amber-100 text-amber-700',
  'bg-cyan-100 text-cyan-700',
  'bg-orange-100 text-orange-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
];

// "Member since Jan 2023" formatter. Localised to en-US / ar-SA so the
// month name flips with language. Falls back to an empty string when
// the wire timestamp is somehow missing — the surrounding paragraph
// hides cleanly.
function formatMemberSince(iso: string, lang: 'en' | 'ar'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    month: 'short',
    year: 'numeric',
  });
}

function ProviderProfileScreen() {
  const { lang } = useLang();
  const profileQuery = useProviderProfile();
  const upgradeMut = useUpgradeToProvider();
  const availabilityMut = useUpdateProviderAvailability();

  const profile = profileQuery.data?.profile ?? null;
  // Onboarding: only when the cache has NO profile yet AND the last GET
  // came back 403/404. Once the upgrade mutation seeds the cache, `profile`
  // is non-null and we render the real surface even if React Query is
  // mid-refetch (the prior 403 error is still pinned to the query state
  // until the next fetch resolves).
  const upgradeNeeded = (() => {
    if (profile) return false;
    const status = profileQuery.error?.response?.status;
    return status === 403 || status === 404;
  })();

  const L = {
    title: lang === 'ar' ? 'ملف المحترف' : 'My Profile',
    online: lang === 'ar' ? 'متاح للعمل' : 'Available for work',
    offline: lang === 'ar' ? 'غير متاح' : 'Unavailable',
    paused: lang === 'ar' ? 'متوقف مؤقتاً' : 'Paused',
    skills: lang === 'ar' ? 'مهاراتي' : 'My Skills',
    skillsEmpty: lang === 'ar' ? 'لم تضف مهارات بعد' : 'No skills added yet',
    jobsDone: lang === 'ar' ? 'مهام منجزة' : 'Jobs Done',
    rating: lang === 'ar' ? 'التقييم' : 'Rating',
    reviews: lang === 'ar' ? 'مراجعات' : 'Reviews',
    editProfile: lang === 'ar' ? 'تعديل الملف' : 'Edit Profile',
    settings: lang === 'ar' ? 'الإعدادات' : 'Settings',
    support: lang === 'ar' ? 'الدعم الفني' : 'Support',
    signOut: lang === 'ar' ? 'تسجيل الخروج' : 'Sign Out',
    level: lang === 'ar' ? 'محترف Pro' : 'Pro Professional',
    levelStandard: lang === 'ar' ? 'محترف' : 'Professional',
    memberSince: lang === 'ar' ? 'عضو منذ' : 'Member since',
    receivingRequests: lang === 'ar' ? 'تستقبل الطلبات' : 'Receiving requests',
    hiddenFromMap: lang === 'ar' ? 'مخفي عن الخريطة' : 'Hidden from map',
    onboardingTitle: lang === 'ar' ? 'كن مزوّد خدمة على المنصة' : 'Become a service provider',
    onboardingBody:
      lang === 'ar'
        ? 'فعّل حسابك كمحترف لرؤية الطلبات القريبة وتقديم العروض.'
        : 'Activate your professional account to see nearby requests and submit bids.',
    onboardingCta: lang === 'ar' ? 'تفعيل حساب المحترف' : 'Activate Provider Account',
    onboardingPending: lang === 'ar' ? 'جارٍ التفعيل…' : 'Activating…',
    upgradeError:
      lang === 'ar'
        ? 'تعذر تفعيل الحساب. حاول مرة أخرى.'
        : "We couldn't activate your provider account. Please try again.",
    availabilityError:
      lang === 'ar'
        ? 'تعذر تحديث الحالة. حاول مرة أخرى.'
        : "We couldn't update your availability. Please try again.",
    profileError:
      lang === 'ar'
        ? 'تعذر تحميل ملف المحترف. حاول مرة أخرى.'
        : "We couldn't load your provider profile. Please try again.",
  };

  // ── Onboarding state — same gradient hero, no fake stats ────────────────
  if (upgradeNeeded) {
    return (
      <div
        className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
          <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
          <p className="text-white relative" style={{ fontSize: '20px', fontWeight: 800 }}>
            {L.onboardingTitle}
          </p>
          <p
            className="text-white/70 relative mt-1.5"
            style={{ fontSize: '13px', lineHeight: '1.5' }}
          >
            {L.onboardingBody}
          </p>
        </div>
        <div className="px-4 -mt-3 z-10 relative">
          <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 mb-4 flex flex-col items-stretch">
            <button
              onClick={() => upgradeMut.mutate()}
              disabled={upgradeMut.isPending}
              className="w-full flex items-center justify-center gap-2.5 py-4 bg-blue-600 text-white rounded-2xl shadow-md shadow-blue-200 dark:shadow-none active:scale-95 transition-all disabled:opacity-60"
              style={{ fontSize: '15px', fontWeight: 800 }}
            >
              {upgradeMut.isPending ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  {L.onboardingPending}
                </>
              ) : (
                <>
                  <Award size={18} />
                  {L.onboardingCta}
                </>
              )}
            </button>
            {upgradeMut.isError && (
              <p
                className="mt-3 text-red-600"
                style={{ fontSize: '12px', fontWeight: 600 }}
                role="alert"
              >
                {L.upgradeError}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Loading skeleton — preserve hero shape so the layout doesn't jump ───
  if (!profile) {
    return (
      <div
        className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
          <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
          <div className="flex items-center gap-4 relative">
            <div className="w-20 h-20 rounded-3xl bg-white/20 border-2 border-white/30" />
            <div className="space-y-2">
              <div className="h-5 w-40 rounded bg-white/30" />
              <div className="h-3 w-24 rounded bg-white/20" />
            </div>
          </div>
        </div>
        {profileQuery.isError && !upgradeNeeded && (
          <div className="px-4 mt-4">
            <p
              className="px-4 py-3 rounded-2xl bg-red-50 border border-red-100 text-red-700"
              style={{ fontSize: '13px', fontWeight: 600 }}
              role="alert"
            >
              {L.profileError}
            </p>
          </div>
        )}
      </div>
    );
  }

  const isOnline = profile.availability === 'ONLINE';
  const isPaused = profile.availability === 'PAUSED';
  const availabilityLabel = isOnline ? L.online : isPaused ? L.paused : L.offline;
  const availabilityHint = isOnline ? L.receivingRequests : L.hiddenFromMap;

  const handleAvailabilityToggle = () => {
    if (availabilityMut.isPending) return;
    const next: ProviderAvailability = isOnline ? 'OFFLINE' : 'ONLINE';
    availabilityMut.mutate({ availability: next });
  };

  const memberSince = formatMemberSince(profile.createdAt, lang === 'ar' ? 'ar' : 'en');
  const ratingDisplay = profile.reviewCount > 0 ? `${profile.ratingAvg.toFixed(1)}★` : '—';
  const proLabel = profile.topPro ? L.level : L.levelStandard;

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
        <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
        <div className="flex items-center gap-4 relative">
          <div className="w-20 h-20 rounded-3xl bg-white/20 border-2 border-white/30 flex items-center justify-center">
            <span className="text-white" style={{ fontSize: '24px', fontWeight: 900 }}>
              {profile.initials}
            </span>
          </div>
          <div>
            <p className="text-white" style={{ fontSize: '20px', fontWeight: 800 }}>
              {profile.displayName}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <Award size={12} className="text-amber-300" />
              <span className="text-white/70" style={{ fontSize: '12px' }}>
                {proLabel}
              </span>
            </div>
            {memberSince && (
              <p className="text-white/50 mt-0.5" style={{ fontSize: '11px' }}>
                {L.memberSince} {memberSince}
              </p>
            )}
          </div>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mt-5 relative">
          {[
            { val: String(profile.completedJobs), label: L.jobsDone },
            { val: ratingDisplay, label: L.rating },
            { val: String(profile.reviewCount), label: L.reviews },
          ].map((s) => (
            <div key={s.label} className="bg-white/15 rounded-2xl py-3 flex flex-col items-center">
              <span className="text-white" style={{ fontSize: '15px', fontWeight: 800 }}>
                {s.val}
              </span>
              <span className="text-white/60" style={{ fontSize: '10px' }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 -mt-3 z-10 relative">
        {/* Availability toggle */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${isOnline ? 'bg-green-100' : 'bg-slate-100'}`}
            >
              {isOnline ? (
                <CheckCircle2 size={16} className="text-green-600" />
              ) : (
                <WifiOff size={16} className="text-slate-500" />
              )}
            </div>
            <div>
              <p
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '14px', fontWeight: 700 }}
              >
                {availabilityLabel}
              </p>
              <p className="text-slate-400" style={{ fontSize: '11px' }}>
                {availabilityHint}
              </p>
            </div>
          </div>
          <button
            onClick={handleAvailabilityToggle}
            disabled={availabilityMut.isPending}
            className={`w-12 h-7 rounded-full border-2 transition-all duration-300 flex items-center px-0.5 disabled:opacity-60 ${isOnline ? 'bg-green-500 border-green-500' : 'bg-slate-300 border-slate-300'}`}
            aria-label={availabilityLabel}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${isOnline ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
        {availabilityMut.isError && (
          <p
            className="-mt-3 mb-4 px-4 py-2 rounded-xl bg-red-50 border border-red-100 text-red-700"
            style={{ fontSize: '12px', fontWeight: 600 }}
            role="alert"
          >
            {L.availabilityError}
          </p>
        )}

        {/* Skills */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-4">
          <p
            className="text-slate-900 dark:text-white mb-3"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {L.skills}
          </p>
          {profile.serviceCategories.length === 0 ? (
            <p className="text-slate-400" style={{ fontSize: '13px' }}>
              {L.skillsEmpty}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {profile.serviceCategories.map((cat, i) => (
                <span
                  key={cat.id}
                  className={`px-3 py-1.5 rounded-xl ${SKILL_CHIP_COLORS[i % SKILL_CHIP_COLORS.length]} dark:bg-slate-700 dark:text-slate-200`}
                  style={{ fontSize: '13px', fontWeight: 600 }}
                >
                  {lang === 'ar' ? cat.labelAr : cat.labelEn}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Menu */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden mb-4">
          {[
            { icon: <User size={16} />, label: L.editProfile },
            { icon: <BarChart2 size={16} />, label: lang === 'ar' ? 'إحصائياتي' : 'My Analytics' },
            { icon: <Bell size={16} />, label: lang === 'ar' ? 'الإشعارات' : 'Notifications' },
            { icon: <Star size={16} />, label: lang === 'ar' ? 'تقييماتي' : 'My Reviews' },
          ].map(({ icon, label }, i) => (
            <button
              key={i}
              className={`w-full flex items-center gap-3 px-4 py-3.5 active:bg-slate-50 dark:active:bg-slate-700/50 transition-all text-start ${i > 0 ? 'border-t border-slate-50 dark:border-slate-700' : ''}`}
            >
              <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                {icon}
              </div>
              <span
                className="flex-1 text-slate-700 dark:text-slate-200"
                style={{ fontSize: '14px', fontWeight: 500 }}
              >
                {label}
              </span>
              <ChevronRight
                size={16}
                className="text-slate-300 dark:text-slate-600 rtl:rotate-180"
              />
            </button>
          ))}
        </div>

        {/* Sign out */}
        <button className="w-full flex items-center justify-center gap-2.5 py-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-3xl mb-6 active:bg-red-100 transition-all">
          <LogOut size={18} className="text-red-500" />
          <span
            className="text-red-600 dark:text-red-400"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {L.signOut}
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────
const PROVIDER_NAV = [
  { id: 'jobs', icon: Map, labelEn: 'Live Jobs', labelAr: 'الوظائف' },
  { id: 'bids', icon: Briefcase, labelEn: 'My Bids', labelAr: 'عروضي' },
  { id: 'wallet', icon: Wallet, labelEn: 'Wallet', labelAr: 'المحفظة' },
  { id: 'profile', icon: User, labelEn: 'Profile', labelAr: 'ملفي' },
];

// ─── Provider App Shell ───────────────────────────────────────────────────────
// Compute the identity strings used by the top bar. Prefer the Provider
// profile when it exists (server-derived displayName + initials, matches
// what the rest of the Provider surface shows). Otherwise fall back to
// the auth-side identity so a logged-in customer who hasn't yet
// activated their provider account still sees a real name in the bar
// instead of a hardcoded "Omar Al-Khalid".
function deriveShellIdentity(
  profile: ProviderProfileSummary | null,
  fallback: { displayName: string | null; initials: string | null },
): { displayName: string; initials: string } {
  if (profile) return { displayName: profile.displayName, initials: profile.initials };
  return {
    displayName: fallback.displayName ?? '',
    initials: fallback.initials ?? '',
  };
}

export function ProviderApp() {
  const { lang, dir, darkMode } = useLang();
  const [activeTab, setActiveTab] = useState('jobs');
  const fontFamily = lang === 'ar' ? "'Cairo', 'Inter', sans-serif" : "'Inter', sans-serif";

  const profileQuery = useProviderProfile();
  const authIdentity = useAuthIdentity();
  const shellIdentity = useMemo(
    () => deriveShellIdentity(profileQuery.data?.profile ?? null, authIdentity),
    [profileQuery.data, authIdentity],
  );

  // Sprint 5.1.2 status gate: a provider whose profile is not ACTIVE
  // gets a focused status surface in place of the live shell — the live
  // map / bids / wallet are intentionally NOT mounted so the user
  // cannot bid before approval. The 'profile' tab still owns the
  // initial onboarding-when-no-profile flow (handled by
  // ProviderProfileScreen). The 'profile' route is exposed as a deep
  // link for DRAFT users via onContinueOnboarding so they can jump to
  // the upgrade button without losing the status surface as a back
  // stop.
  const profile = profileQuery.data?.profile ?? null;
  if (profile && profile.status !== 'ACTIVE') {
    return (
      <ProviderStatusState
        status={profile.status}
        onContinueOnboarding={() => setActiveTab('profile')}
      />
    );
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'jobs':
        return <LiveJobsScreen />;
      case 'bids':
        return <MyBidsScreen />;
      case 'wallet':
        return <WalletScreen />;
      case 'profile':
        return <ProviderProfileScreen />;
      default:
        return <LiveJobsScreen />;
    }
  };

  return (
    <div
      className={`flex flex-col ${darkMode ? 'dark bg-slate-900' : 'bg-white'}`}
      style={{ height: '100svh', fontFamily, direction: dir }}
      dir={dir}
    >
      {/* Top bar (hidden on map tab) */}
      {activeTab !== 'jobs' && (
        <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm z-20">
          <div className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-sm">
                <span className="text-white" style={{ fontSize: '12px', fontWeight: 800 }}>
                  {shellIdentity.initials}
                </span>
              </div>
              <div>
                <p className="text-slate-400" style={{ fontSize: '11px' }}>
                  {lang === 'ar' ? 'مرحباً 👋' : 'Welcome back 👋'}
                </p>
                <p
                  className="text-slate-900 dark:text-white"
                  style={{ fontSize: '14px', fontWeight: 700 }}
                >
                  {shellIdentity.displayName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <LangToggle />
              <button className="relative w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all">
                <Bell size={17} className="text-slate-600 dark:text-slate-300" />
                <span
                  className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center border-2 border-white"
                  style={{ fontSize: '8px', fontWeight: 800 }}
                >
                  2
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {renderTab()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-20">
        <div className="flex items-center justify-around px-2 pt-2 pb-3">
          {PROVIDER_NAV.map(({ id, icon: Icon, labelEn, labelAr }) => {
            const active = activeTab === id;
            return (
              <motion.button
                key={id}
                onClick={() => setActiveTab(id)}
                whileTap={{ scale: 0.88 }}
                className="relative flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl transition-all min-w-[60px]"
              >
                {active && (
                  <motion.div
                    layoutId="provider-nav-pill"
                    className="absolute inset-0 bg-blue-50 dark:bg-blue-900/20 rounded-2xl"
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                  />
                )}
                <Icon
                  size={22}
                  className={`relative z-10 transition-colors ${active ? 'text-blue-600' : 'text-slate-400'}`}
                />
                <span
                  className="relative z-10"
                  style={{
                    fontSize: '10px',
                    fontWeight: active ? 700 : 500,
                    color: active ? '#2563eb' : '#94a3b8',
                  }}
                >
                  {lang === 'ar' ? labelAr : labelEn}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
