import { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  Star,
  Zap,
  RefreshCw,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import { ProBidCard } from '../ds/ProBidCard';
import { LeadCardProps } from './LeadCard';
import { useSwipe } from '../../hooks/useSwipe';
import { useLang } from '../../i18n/LanguageContext';
import { useEcosystem } from '../../context/EcosystemContext';

// ─── Mock bid data ─────────────────────────────────────────────────────────────
interface Bid {
  id: string;
  name: string;
  initials: string;
  avatarBg: string;
  avatarColor: string;
  rating: number;
  reviewCount: number;
  jobCount: number;
  price: number;
  tags: string[];
  verified: boolean;
  topPro: boolean;
  responseTime: string;
  badge: 'bestMatch' | 'bestValue' | 'fastest' | null;
}

const SEED_BIDS: Bid[] = [
  {
    id: 'b1',
    name: 'Omar Al-Khalid',
    initials: 'OK',
    avatarBg: 'bg-amber-100',
    avatarColor: 'text-amber-700',
    rating: 4.9,
    reviewCount: 312,
    jobCount: 540,
    price: 35,
    tags: ['Licensed', 'Insured', 'Top Rated'],
    verified: true,
    topPro: true,
    responseTime: 'within 5 min',
    badge: 'bestMatch',
  },
  {
    id: 'b2',
    name: 'Khalid Hassan',
    initials: 'KH',
    avatarBg: 'bg-blue-100',
    avatarColor: 'text-blue-700',
    rating: 4.7,
    reviewCount: 156,
    jobCount: 220,
    price: 28,
    tags: ['Budget-Friendly', 'Quick Response'],
    verified: true,
    topPro: false,
    responseTime: 'within 20 min',
    badge: 'bestValue',
  },
  {
    id: 'b3',
    name: 'Ali Al-Rashid',
    initials: 'AR',
    avatarBg: 'bg-green-100',
    avatarColor: 'text-green-700',
    rating: 4.6,
    reviewCount: 89,
    jobCount: 180,
    price: 30,
    tags: ['Available Now', 'Fast'],
    verified: true,
    topPro: false,
    responseTime: 'within 10 min',
    badge: 'fastest',
  },
  {
    id: 'b4',
    name: 'Mohammed Al-Zahra',
    initials: 'MZ',
    avatarBg: 'bg-purple-100',
    avatarColor: 'text-purple-700',
    rating: 4.8,
    reviewCount: 67,
    jobCount: 145,
    price: 40,
    tags: ['Premium Service', 'Certified'],
    verified: false,
    topPro: false,
    responseTime: 'within 30 min',
    badge: null,
  },
  {
    id: 'b5',
    name: 'Hassan Mustafa',
    initials: 'HM',
    avatarBg: 'bg-slate-100',
    avatarColor: 'text-slate-700',
    rating: 4.5,
    reviewCount: 42,
    jobCount: 78,
    price: 25,
    tags: ['New Pro', 'Eco Products'],
    verified: false,
    topPro: false,
    responseTime: 'within 45 min',
    badge: null,
  },
];

const LIVE_BID: Bid = {
  id: 'b6',
  name: 'Faisal Al-Nasser',
  initials: 'FN',
  avatarBg: 'bg-red-100',
  avatarColor: 'text-red-700',
  rating: 4.8,
  reviewCount: 189,
  jobCount: 310,
  price: 32,
  tags: ['Top Rated', 'Lightning Fast'],
  verified: true,
  topPro: false,
  responseTime: 'within 15 min',
  badge: null,
};

// ─── Badge config ─────────────────────────────────────────────────────────────
const BADGE_CONFIG_EN = {
  bestMatch: { label: '⭐ Best Match', bg: 'bg-amber-500', text: 'text-white' },
  bestValue: { label: '💰 Best Value', bg: 'bg-green-500', text: 'text-white' },
  fastest: { label: '⚡ Fastest', bg: 'bg-blue-500', text: 'text-white' },
};
const BADGE_CONFIG_AR = {
  bestMatch: { label: '⭐ الأنسب', bg: 'bg-amber-500', text: 'text-white' },
  bestValue: { label: '💰 الأوفر', bg: 'bg-green-500', text: 'text-white' },
  fastest: { label: '⚡ الأسرع', bg: 'bg-blue-500', text: 'text-white' },
};

type SortKey = 'recommended' | 'price' | 'rating';

// ─── Price Range Chart ────────────────────────────────────────────────────────
function PriceChart({ bids, selectedId }: { bids: Bid[]; selectedId: string | null }) {
  const { t } = useLang();
  const prices = bids.map((b) => b.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
  const range = max - min || 1;

  return (
    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-600" style={{ fontSize: '12px', fontWeight: 600 }}>
          {t('priceComparison')}
        </span>
        <span className="text-slate-400" style={{ fontSize: '11px' }}>
          Avg: <strong className="text-slate-700">${avg}/hr</strong>
        </span>
      </div>

      {/* Bar */}
      <div className="relative h-6 mb-1">
        <div className="absolute inset-y-0 start-0 end-0 flex items-center">
          <div className="w-full h-1.5 bg-slate-200 rounded-full" />
        </div>
        <div
          className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
          style={{ left: `${((avg - min) / range) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <div className="w-px h-6 bg-amber-400 opacity-60" />
        </div>
        {bids.map((bid) => {
          const pct = ((bid.price - min) / range) * 100;
          const isSelected = bid.id === selectedId;
          return (
            <div
              key={bid.id}
              className="absolute top-1/2 -translate-y-1/2"
              style={{ left: `${pct}%`, transform: `translate(-50%, -50%)` }}
            >
              <div
                className={`rounded-full border-2 transition-all duration-200 ${
                  isSelected
                    ? 'w-4 h-4 bg-amber-500 border-amber-500 shadow-md shadow-amber-200'
                    : 'w-3 h-3 bg-white border-slate-400'
                }`}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-2">
        <span className="text-green-600" style={{ fontSize: '11px', fontWeight: 700 }}>
          ${min} low
        </span>
        <span className="text-slate-400" style={{ fontSize: '10px' }}>
          avg ${avg}
        </span>
        <span className="text-red-400" style={{ fontSize: '11px', fontWeight: 700 }}>
          ${max} high
        </span>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface BidsScreenProps {
  lead: LeadCardProps;
  onBack: () => void;
  onBookBid: (bidderName: string) => void;
}

// ═════════════════════════════════════════════════════════════════════════════
export function BidsScreen({ lead, onBack, onBookBid }: BidsScreenProps) {
  const { t, lang, dir } = useLang();
  const { showHourlyRate } = useEcosystem();
  const [bids, setBids] = useState<Bid[]>(SEED_BIDS);
  const [sortKey, setSortKey] = useState<SortKey>('recommended');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [newBidPending, setNewBidPending] = useState(false);
  const [newBidFlashId, setNewBidFlashId] = useState<string | null>(null);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);

  const BADGE_CONFIG = lang === 'ar' ? BADGE_CONFIG_AR : BADGE_CONFIG_EN;

  // ── Simulate live bid arriving ────────────────────────────────────────────
  useEffect(() => {
    const t1 = setTimeout(() => setNewBidPending(true), 8_000);
    const t2 = setTimeout(() => {
      setNewBidPending(false);
      setBids((prev) => [LIVE_BID, ...prev]);
      setNewBidFlashId(LIVE_BID.id);
    }, 11_000);
    const t3 = setTimeout(() => setNewBidFlashId(null), 14_000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // ── Swipe right (LTR) or left (RTL) → back ───────────────────────────────
  const { onTouchStart, onTouchMove, onTouchEnd, dragX } = useSwipe({
    onSwipeRight: dir === 'ltr' ? onBack : undefined,
    onSwipeLeft: dir === 'rtl' ? onBack : undefined,
    threshold: 70,
    edgeStartOnly: true,
    edgeWidth: 55,
  });

  const sorted = [...bids].sort((a, b) => {
    if (sortKey === 'price') return a.price - b.price;
    if (sortKey === 'rating') return b.rating - a.rating;
    const score = (x: Bid) => (x.badge ? 999 : x.rating * 10 - x.price * 0.3);
    return score(b) - score(a);
  });

  const handleBook = (bid: Bid) => {
    setAcceptedId(bid.id);
    setTimeout(() => onBookBid(bid.name), 900);
  };

  return (
    <div
      className="absolute inset-0 bg-slate-50 flex flex-col z-20"
      style={{
        transform: `translateX(${dir === 'ltr' ? Math.max(dragX, 0) : Math.min(dragX, 0)}px)`,
        transition: dragX !== 0 ? 'none' : 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* ── Sticky Header ── */}
      <div className="flex-shrink-0 bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
          >
            {dir === 'rtl' ? (
              <ChevronRight size={20} className="text-slate-700" />
            ) : (
              <ChevronLeft size={20} className="text-slate-700" />
            )}
          </button>
          <div className="flex-1">
            <p className="text-slate-900" style={{ fontSize: '16px', fontWeight: 800 }}>
              {bids.length} {t('bids')} · {lead.service}
            </p>
            <p className="text-slate-400" style={{ fontSize: '11px' }}>
              {t('postedAt')} {lead.postedAt}
            </p>
          </div>
          <button className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center active:scale-90 transition-all">
            <Filter size={16} className="text-slate-600" />
          </button>
        </div>

        {/* Sort tabs */}
        <div className="flex px-4 gap-2 pb-3">
          {(
            [
              { id: 'recommended', labelKey: 'bestMatch', icon: <Star size={11} /> },
              { id: 'price', labelKey: 'bestValue', icon: <TrendingDown size={11} /> },
              { id: 'rating', labelKey: 'fastest', icon: <Zap size={11} /> },
            ] as { id: SortKey; labelKey: string; icon: React.ReactNode }[]
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSortKey(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all active:scale-95 ${
                sortKey === tab.id
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              style={{ fontSize: '11px', fontWeight: 700 }}
            >
              {tab.icon}
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: 'none' }}>
        {showHourlyRate && <PriceChart bids={bids} selectedId={hoveredId} />}

        {/* Live bid indicator */}
        {newBidPending && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 my-3">
            <div className="w-7 h-7 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
              <RefreshCw
                size={13}
                className="text-white animate-spin"
                style={{ animationDuration: '1.2s' }}
              />
            </div>
            <p className="text-blue-700" style={{ fontSize: '12px', fontWeight: 600 }}>
              {lang === 'ar' ? 'عرض جديد قادم…' : 'A new bid is arriving…'}
            </p>
            <div className="flex gap-1 ms-auto">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Bid cards */}
        <div className="flex flex-col gap-4 mt-3">
          {sorted.map((bid) => {
            const badgeCfg = bid.badge ? BADGE_CONFIG[bid.badge] : null;
            const isAccepted = acceptedId === bid.id;

            return (
              <div
                key={bid.id}
                className={`relative transition-all duration-500 ${
                  newBidFlashId === bid.id
                    ? 'ring-2 ring-blue-400 rounded-3xl shadow-lg shadow-blue-100'
                    : ''
                }`}
                onMouseEnter={() => setHoveredId(bid.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {badgeCfg && (
                  <div className="absolute -top-3 start-4 z-10 flex items-center gap-1">
                    <div
                      className={`${badgeCfg.bg} ${badgeCfg.text} px-3 py-1 rounded-full shadow-sm`}
                      style={{ fontSize: '10px', fontWeight: 800 }}
                    >
                      {badgeCfg.label}
                    </div>
                  </div>
                )}

                {bid.id === LIVE_BID.id && (
                  <div className="absolute -top-3 end-4 z-10">
                    <div
                      className="bg-blue-500 text-white px-2.5 py-1 rounded-full flex items-center gap-1"
                      style={{ fontSize: '10px', fontWeight: 800 }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      {lang === 'ar' ? 'جديد' : 'NEW'}
                    </div>
                  </div>
                )}

                {isAccepted && (
                  <div className="absolute inset-0 z-20 rounded-3xl bg-green-500/90 flex items-center justify-center gap-3">
                    <CheckCircle2 size={32} className="text-white" />
                    <p className="text-white" style={{ fontSize: '16px', fontWeight: 800 }}>
                      {lang === 'ar' ? 'تم تأكيد الحجز!' : 'Booking confirmed!'}
                    </p>
                  </div>
                )}

                <div
                  className={`transition-all duration-300 ${badgeCfg ? 'mt-3' : ''} ${isAccepted ? 'scale-95 opacity-60' : ''}`}
                >
                  <ProBidCard
                    name={bid.name}
                    initials={bid.initials}
                    avatarBg={bid.avatarBg}
                    avatarColor={bid.avatarColor}
                    rating={bid.rating}
                    reviewCount={bid.reviewCount}
                    jobCount={bid.jobCount}
                    price={bid.price}
                    unit="/hr"
                    tags={bid.tags}
                    verified={bid.verified}
                    topPro={bid.topPro}
                    responseTime={bid.responseTime}
                    showPrice={showHourlyRate}
                    onBook={() => handleBook(bid)}
                    onMessage={() => {}}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Comparison table */}
        <div className="mt-6 bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
          <p className="text-slate-700 mb-3" style={{ fontSize: '13px', fontWeight: 700 }}>
            {lang === 'ar' ? 'مقارنة سريعة' : 'Quick Comparison'}
          </p>
          <div className="overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <table className="w-full" style={{ fontSize: '11px' }}>
              <thead>
                <tr className="text-slate-400">
                  <th className="text-start py-2 pe-3 font-semibold">{t('pro')}</th>
                  <th className="text-center py-2 px-2 font-semibold">
                    {lang === 'ar' ? 'التقييم' : 'Rating'}
                  </th>
                  {showHourlyRate && (
                    <th className="text-center py-2 px-2 font-semibold">
                      {lang === 'ar' ? 'السعر' : 'Price'}
                    </th>
                  )}
                  <th className="text-center py-2 px-2 font-semibold">
                    {lang === 'ar' ? 'الردّ' : 'Response'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 4).map((bid) => (
                  <tr key={bid.id} className="border-t border-slate-50">
                    <td className="py-2 pe-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-lg flex items-center justify-center ${bid.avatarBg}`}
                        >
                          <span
                            className={bid.avatarColor}
                            style={{ fontSize: '8px', fontWeight: 800 }}
                          >
                            {bid.initials}
                          </span>
                        </div>
                        <span
                          className="text-slate-700 font-semibold truncate"
                          style={{ maxWidth: '70px' }}
                        >
                          {bid.name.split(' ')[0]}
                        </span>
                      </div>
                    </td>
                    <td className="text-center py-2 px-2">
                      <span className="text-amber-600 font-bold">{bid.rating}</span>
                    </td>
                    {showHourlyRate && (
                      <td className="text-center py-2 px-2">
                        <span className="text-slate-900 font-bold">${bid.price}</span>
                      </td>
                    )}
                    <td className="text-center py-2 px-2 text-slate-500">
                      {bid.responseTime.replace('within ', '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="h-4" />
      </div>
    </div>
  );
}
