import { useState } from "react";
import {
  ChevronLeft, ChevronRight, Clock, Filter, Plus,
  Wrench, Zap, Wind, Sparkles, Hammer, PaintBucket,
} from "lucide-react";
import { LeadCardProps, LeadStatus } from "./LeadCard";
import { useLang } from "../../i18n/LanguageContext";
import { useEcosystem } from "../../context/EcosystemContext";

// ─── Service helpers ──────────────────────────────────────────────────────────
const SVC_COLOR: Record<string, { bg: string; icon: string }> = {
  Plumbing:    { bg: "bg-blue-100",   icon: "text-blue-600"   },
  Electrical:  { bg: "bg-amber-100",  icon: "text-amber-600"  },
  "AC Repair": { bg: "bg-cyan-100",   icon: "text-cyan-600"   },
  Cleaning:    { bg: "bg-green-100",  icon: "text-green-600"  },
  Carpentry:   { bg: "bg-orange-100", icon: "text-orange-700" },
  Painting:    { bg: "bg-purple-100", icon: "text-purple-600" },
  General:     { bg: "bg-slate-100",  icon: "text-slate-600"  },
};

const SVC_ICON: Record<string, React.ReactNode> = {
  Plumbing:    <Wrench      size={18} />,
  Electrical:  <Zap         size={18} />,
  "AC Repair": <Wind        size={18} />,
  Cleaning:    <Sparkles    size={18} />,
  Carpentry:   <Hammer      size={18} />,
  Painting:    <PaintBucket size={18} />,
  General:     <Wrench      size={18} />,
};

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<LeadStatus, { en: string; ar: string; dot: string; badge: string; text: string }> = {
  pending:   { en: "Pending Bids", ar: "قيد الانتظار",   dot: "bg-amber-500", badge: "bg-amber-50 border-amber-200",   text: "text-amber-700" },
  active:    { en: "In Progress",  ar: "جارٍ التنفيذ",  dot: "bg-blue-500",  badge: "bg-blue-50 border-blue-200",     text: "text-blue-700"  },
  completed: { en: "Completed",    ar: "مكتمل",         dot: "bg-green-500", badge: "bg-green-50 border-green-200",   text: "text-green-700" },
  cancelled: { en: "Cancelled",    ar: "ملغى",          dot: "bg-red-400",   badge: "bg-red-50 border-red-200",       text: "text-red-600"   },
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface AllLeadsViewProps {
  leads:          LeadCardProps[];
  isVisible:      boolean;
  onBack:         () => void;
  onOpenBids:     (lead: LeadCardProps) => void;
  onOpenDetail:   (lead: LeadCardProps) => void;
  onPostNew:      () => void;
}

type FilterKey = "all" | "pending" | "active" | "completed";

// ─────────────────────────────────────────────────────────────────────────────
export function AllLeadsView({ leads, isVisible, onBack, onOpenBids, onOpenDetail, onPostNew }: AllLeadsViewProps) {
  const { lang, dir } = useLang();
  const { showHourlyRate } = useEcosystem();
  const [filter, setFilter] = useState<FilterKey>("all");

  const filters: { key: FilterKey; en: string; ar: string }[] = [
    { key: "all",       en: "All",       ar: "الكل"           },
    { key: "active",    en: "Active",    ar: "نشط"            },
    { key: "pending",   en: "Pending",   ar: "قيد الانتظار"   },
    { key: "completed", en: "Completed", ar: "مكتملة"         },
  ];

  const filtered = filter === "all" ? leads : leads.filter((l) => l.status === filter);

  const handleTap = (lead: LeadCardProps) => {
    if (lead.status === "pending") {
      onOpenBids(lead);
    } else {
      onOpenDetail(lead);
    }
  };

  return (
    <div
      className="absolute inset-0 bg-slate-50 flex flex-col z-20 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{ transform: isVisible ? "translateX(0)" : dir === "rtl" ? "translateX(-100%)" : "translateX(100%)" }}
    >
      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
          >
            {dir === "rtl"
              ? <ChevronRight size={20} className="text-slate-700" />
              : <ChevronLeft  size={20} className="text-slate-700" />
            }
          </button>

          <div className="flex-1">
            <p className="text-slate-900" style={{ fontSize: "16px", fontWeight: 800 }}>
              {lang === "ar" ? "كل الطلبات" : "All Requests"}
            </p>
            <p className="text-slate-400" style={{ fontSize: "11px" }}>
              {leads.length} {lang === "ar" ? "طلب" : "requests"}
            </p>
          </div>

          <button className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center active:scale-90 transition-all">
            <Filter size={16} className="text-slate-600" />
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {filters.map((f) => {
            const count = f.key === "all" ? leads.length : leads.filter((l) => l.status === f.key).length;
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border flex-shrink-0 transition-all active:scale-95 ${
                  active ? "bg-amber-500 border-amber-500 text-white" : "bg-white border-slate-200 text-slate-500"
                }`}
                style={{ fontSize: "12px", fontWeight: active ? 700 : 500 }}
              >
                {lang === "ar" ? f.ar : f.en}
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center ${active ? "bg-white/20" : "bg-slate-100"}`}
                  style={{ fontSize: "9px", fontWeight: 700, color: active ? "white" : "#64748b" }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: "none" }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Wrench size={28} className="text-slate-300" />
            </div>
            <p className="text-slate-400" style={{ fontSize: "14px" }}>
              {lang === "ar" ? "لا توجد طلبات في هذه الفئة" : "No requests in this category"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((lead) => {
              const svc = SVC_COLOR[lead.service] ?? SVC_COLOR.General;
              const ico = SVC_ICON[lead.service]  ?? SVC_ICON.General;
              const st  = STATUS_CONFIG[lead.status];
              return (
                <button
                  key={lead.id}
                  onClick={() => handleTap(lead)}
                  className="w-full bg-white rounded-3xl border border-slate-100 shadow-sm p-4 flex items-start gap-4 active:scale-[0.98] transition-all cursor-pointer text-start"
                >
                  {/* Icon */}
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${svc.bg}`}>
                    <span className={svc.icon}>{ico}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-slate-900" style={{ fontSize: "15px", fontWeight: 700 }}>
                        {lead.service}
                      </p>
                      {/* Status badge */}
                      <span className={`px-2.5 py-1 rounded-full border flex-shrink-0 ${st.badge} ${st.text}`} style={{ fontSize: "10px", fontWeight: 700 }}>
                        {lang === "ar" ? st.ar : st.en}
                      </span>
                    </div>

                    {/* Sub info row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {lead.proName && (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center">
                            <span className="text-amber-700" style={{ fontSize: "8px", fontWeight: 800 }}>
                              {lead.proInitials ?? lead.proName.slice(0,2)}
                            </span>
                          </div>
                          <span className="text-slate-600" style={{ fontSize: "12px" }}>{lead.proName}</span>
                        </div>
                      )}
                      {lead.status === "pending" && lead.bids !== undefined && (
                        <span className="text-amber-600" style={{ fontSize: "12px", fontWeight: 600 }}>
                          {lead.bids} {lang === "ar" ? "عرض" : "bids"}
                        </span>
                      )}
                      {showHourlyRate && lead.price && (
                        <span className="text-slate-900" style={{ fontSize: "14px", fontWeight: 800 }}>
                          ${lead.price}<span className="text-slate-400" style={{ fontSize: "10px", fontWeight: 400 }}>/hr</span>
                        </span>
                      )}
                    </div>

                    {/* Time */}
                    <div className="flex items-center gap-1 mt-2 text-slate-400">
                      <Clock size={10} />
                      <span style={{ fontSize: "10px" }}>{lead.postedAt}</span>
                    </div>
                  </div>

                  {/* Chevron */}
                  <div className="flex-shrink-0 mt-1">
                    {dir === "rtl"
                      ? <ChevronLeft  size={16} className="text-slate-300" />
                      : <ChevronRight size={16} className="text-slate-300" />
                    }
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Post New Job CTA */}
        <button
          onClick={onPostNew}
          className="w-full mt-4 flex items-center justify-center gap-3 bg-amber-50 border-2 border-dashed border-amber-300 rounded-3xl py-4 active:bg-amber-100 transition-all active:scale-[0.98]"
        >
          <div className="w-9 h-9 rounded-2xl bg-amber-100 flex items-center justify-center">
            <Plus size={18} className="text-amber-600" />
          </div>
          <span className="text-amber-700" style={{ fontSize: "14px", fontWeight: 700 }}>
            {lang === "ar" ? "نشر طلب جديد" : "Post a New Request"}
          </span>
        </button>

        <div className="h-4" />
      </div>
    </div>
  );
}
