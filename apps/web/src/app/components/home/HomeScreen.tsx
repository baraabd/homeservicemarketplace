import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell, WifiOff, Sparkles, Mic, ChevronRight,
  Home, Briefcase, MessageCircle, User, Plus,
  Wrench, Zap, Wind, Hammer, Search, PaintBucket,
} from "lucide-react";
import { ServiceCategoryCard }   from "../ds/ServiceCategoryCard";
import { LeadCard, LeadCardProps } from "./LeadCard";
import { BidsScreen }             from "./BidsScreen";
import { JobDetailView, JobData, leadToJobData } from "./JobDetailView";
import { AllLeadsView }           from "./AllLeadsView";
import { NotificationDrawer, AppNotification } from "../notifications/NotificationDrawer";
import { ChatScreen }             from "../chat/ChatScreen";
import { Snackbar }               from "../ds/Snackbar";
import { ProfileTab }             from "../profile/ProfileTab";
import { TabSkeleton }            from "../ui/SkeletonLoader";
import { useLang, LangToggle }    from "../../i18n/LanguageContext";
import { useEcosystem }           from "../../context/EcosystemContext";

// ─── Tab routing ──────────────────────────────────────────────────────────────
const TAB_PATHS: Record<string, string> = {
  home:     "/home",
  bookings: "/home/bookings",
  messages: "/home/messages",
  profile:  "/home/profile",
};

function tabFromPath(pathname: string): string {
  if (pathname === "/home/bookings") return "bookings";
  if (pathname === "/home/messages") return "messages";
  if (pathname === "/home/profile")  return "profile";
  return "home";
}

// ─── Booking data ─────────────────────────────────────────────────────────────
interface BookingItem {
  id: string; serviceEn: string; serviceAr: string;
  dateEn: string; dateAr: string;
  statusKey: "active" | "pending" | "completed";
  proEn: string; proAr: string; proInitials?: string;
  price: number; address?: string; addressAr?: string;
}

const BOOKING_DATA: BookingItem[] = [
  { id:"b1",serviceEn:"Plumbing Repair", serviceAr:"إصلاح سباكة",  dateEn:"Today, 3:00 PM",  dateAr:"اليوم، 3:00 م",   statusKey:"active",    proEn:"Omar K.",  proAr:"عمر خ.",   proInitials:"OK",price:35, address:"Al Olaya District, Riyadh", addressAr:"حي العليا، الرياض" },
  { id:"b2",serviceEn:"AC Maintenance",  serviceAr:"صيانة تكييف",  dateEn:"Tomorrow, 10 AM", dateAr:"غداً، 10:00 ص",   statusKey:"pending",   proEn:"—",        proAr:"—",        price:0,  address:"Al Malqa, Riyadh",          addressAr:"حي الملقا، الرياض" },
  { id:"b3",serviceEn:"Deep Cleaning",   serviceAr:"تنظيف عميق",   dateEn:"Mar 8, 2:00 PM",  dateAr:"8 مارس، 2:00 م",  statusKey:"completed", proEn:"Sara M.",  proAr:"سارة م.",  proInitials:"SM",price:28, address:"Al Malqa, Riyadh",          addressAr:"حي الملقا، الرياض" },
  { id:"b4",serviceEn:"Cabinet Install", serviceAr:"تركيب خزائن",  dateEn:"Mar 5, 9:00 AM",  dateAr:"5 مارس، 9:00 ص",  statusKey:"completed", proEn:"Ali H.",   proAr:"علي ح.",   proInitials:"AH",price:45, address:"King Fahd District, Riyadh", addressAr:"حي الملك فهد، الرياض" },
];

function bookingToJobData(b: BookingItem, lang: string): JobData {
  const svcKey =
    b.serviceEn.includes("Plumbing")   ? "Plumbing"   :
    b.serviceEn.includes("AC")         ? "AC Repair"  :
    b.serviceEn.includes("Cleaning")   ? "Cleaning"   :
    b.serviceEn.includes("Cabinet")    ? "Carpentry"  :
    b.serviceEn.includes("Electrical") ? "Electrical" :
    b.serviceEn.includes("Paint")      ? "Painting"   : "General";
  return {
    id: b.id, service: svcKey, serviceAr: b.serviceAr, status: b.statusKey,
    proName: b.proEn !== "—" ? b.proEn : undefined, proInitials: b.proInitials,
    proRating: 4.8, proReviews: 156, proJobs: 220,
    proTags: ["Licensed","Insured","Top Rated"],
    postedAt: lang === "ar" ? b.dateAr : b.dateEn,
    price: b.price > 0 ? b.price : undefined,
    date: b.dateEn, dateAr: b.dateAr, address: b.address, addressAr: b.addressAr,
  };
}

// ─── Leads ────────────────────────────────────────────────────────────────────
const INITIAL_LEADS: LeadCardProps[] = [
  { id:"1", service:"Plumbing",   status:"active",    proName:"Omar K.",  proInitials:"OK", postedAt:"2h ago", price:35, bids:3 },
  { id:"2", service:"Electrical", status:"pending",   postedAt:"5h ago",  bids:7 },
  { id:"3", service:"Cleaning",   status:"completed", proName:"Sara M.",  proInitials:"SM", postedAt:"1d ago", price:28 },
];

const INITIAL_NOTIFS: AppNotification[] = [
  { id:"n1", type:"bid",       jobId:"2",  title:"New bid on Electrical job",   body:"Omar Al-Khalid bid $35/hr · ★ 4.9 · Top Pro",  time:"2m ago",  read:false },
  { id:"n2", type:"bid",       jobId:"2",  title:"6 bids on Electrical",        body:"You have 6 new bids waiting for review",        time:"5m ago",  read:false },
  { id:"n3", type:"tracking",  jobId:"1",  title:"Pro is on the way 📍",         body:"Omar K. is 15 minutes away",                   time:"1h ago",  read:false },
  { id:"n4", type:"confirmed", jobId:"b1", title:"Booking confirmed ✓",          body:"Your Plumbing repair is confirmed for 3 PM",   time:"2h ago",  read:true  },
  { id:"n5", type:"message",   jobId:"b3", title:"Message from Sara M.",         body:"Job completed! Please rate your experience",   time:"3h ago",  read:true  },
];

// ─── Props ────────────────────────────────────────────────────────────────────
interface HomeScreenProps {
  isOffline:       boolean;
  onServiceSelect: (service: string) => void;
  onToggleOffline: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
export function HomeScreen({ isOffline, onServiceSelect, onToggleOffline }: HomeScreenProps) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { t, lang } = useLang();
  const { showHourlyRate } = useEcosystem();
  const activeTab   = tabFromPath(location.pathname);
  const prevTab     = useRef(activeTab);
  const micTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Core state ─────────────────────────────────────────────────────────────
  const [search,        setSearch]        = useState("");
  const [micActive,     setMicActive]     = useState(false);
  const [leads,         setLeads]         = useState<LeadCardProps[]>(INITIAL_LEADS);
  const [notifications, setNotifications] = useState<AppNotification[]>(INITIAL_NOTIFS);
  const [bookSnack,     setBookSnack]     = useState(false);
  const [bookSnackMsg,  setBookSnackMsg]  = useState("");
  const [tabLoading,    setTabLoading]    = useState(false);

  // ── Overlay state ──────────────────────────────────────────────────────────
  const [notifOpen,    setNotifOpen]    = useState(false);
  const [bidsLead,     setBidsLead]     = useState<LeadCardProps | null>(null);
  const [jobDetail,    setJobDetail]    = useState<JobData | null>(null);
  const [showAllLeads, setShowAllLeads] = useState(false);
  const [chatContact,  setChatContact]  = useState<null | {
    name: string; initials: string; bg: string; textColor: string; status: string;
  }>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const markAllRead = () => setNotifications((p) => p.map((n) => ({ ...n, read: true })));
  const markRead    = (id: string) => setNotifications((p) => p.map((n) => n.id === id ? { ...n, read: true } : n));

  // ── Tab skeleton loader ────────────────────────────────────────────────────
  useEffect(() => {
    if (prevTab.current !== activeTab) {
      setTabLoading(true);
      const timer = setTimeout(() => setTabLoading(false), 380);
      prevTab.current = activeTab;
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  // ── Mic auto-off ────────────────────────────────────────────────────────────
  const toggleMic = () => {
    if (micActive) {
      setMicActive(false);
      if (micTimerRef.current) clearTimeout(micTimerRef.current);
    } else {
      setMicActive(true);
      micTimerRef.current = setTimeout(() => setMicActive(false), 5000);
    }
  };

  // ── Notification tap ────────────────────────────────────────────────────────
  const handleNotifTap = (n: AppNotification) => {
    setNotifOpen(false);
    setTimeout(() => {
      if (n.type === "bid") {
        const lead = leads.find((l) => l.id === n.jobId) ?? leads.find((l) => l.status === "pending");
        if (lead) setBidsLead(lead);
      } else if (n.type === "tracking" || n.type === "confirmed") {
        const lead = leads.find((l) => l.id === n.jobId);
        if (lead) setJobDetail(leadToJobData(lead));
        else { const bk = BOOKING_DATA.find((b) => b.id === n.jobId); if (bk) setJobDetail(bookingToJobData(bk, lang)); }
      } else if (n.type === "message") {
        const bk = BOOKING_DATA.find((b) => b.id === n.jobId);
        if (bk?.proInitials) setChatContact({ name: lang === "ar" ? bk.proAr : bk.proEn, initials: bk.proInitials, bg: "bg-green-100", textColor: "text-green-700", status: "Online" });
      }
    }, 200);
  };

  // ── Lead tap ────────────────────────────────────────────────────────────────
  const handleLeadTap = (lead: LeadCardProps) => {
    lead.status === "pending" ? setBidsLead(lead) : setJobDetail(leadToJobData(lead));
  };

  // ── Booking tap ─────────────────────────────────────────────────────────────
  const handleBookingTap = (b: BookingItem) => setJobDetail(bookingToJobData(b, lang));

  // ── Book bid ────────────────────────────────────────────────────────────────
  const handleBookBid = (bidderName: string) => {
    setLeads((prev) =>
      prev.map((l) =>
        l.id === bidsLead?.id
          ? { ...l, status:"active", proName: bidderName.split(" ")[0] + " " + (bidderName.split(" ")[1]?.[0] ?? "") + ".", proInitials: bidderName[0] + (bidderName.split(" ")[1]?.[0] ?? ""), bids:undefined }
          : l
      )
    );
    const fn = bidderName.split(" ")[0];
    setBookSnackMsg(lang === "ar" ? `تم الحجز مع ${fn}! 🎉` : `Booked ${fn}! 🎉 Job is now active.`);
    setBookSnack(true);
    setBidsLead(null);
  };

  // ── Services ────────────────────────────────────────────────────────────────
  const SERVICES = [
    { key:"plumbing",   iconBg:"bg-blue-100",   iconColor:"text-blue-600",   icon:<Wrench      size={22}/> },
    { key:"acRepair",   iconBg:"bg-cyan-100",   iconColor:"text-cyan-600",   icon:<Wind        size={22}/> },
    { key:"carpentry",  iconBg:"bg-orange-100", iconColor:"text-orange-700", icon:<Hammer      size={22}/> },
    { key:"cleaning",   iconBg:"bg-green-100",  iconColor:"text-green-600",  icon:<Sparkles    size={22}/> },
    { key:"electrical", iconBg:"bg-amber-100",  iconColor:"text-amber-600",  icon:<Zap         size={22}/> },
    { key:"painting",   iconBg:"bg-purple-100", iconColor:"text-purple-600", icon:<PaintBucket size={22}/> },
  ];

  // ── Nav tabs ────────────────────────────────────────────────────────────────
  const NAV_TABS = [
    { id:"home",     labelKey:"home",     Icon:Home,          badge:0 },
    { id:"bookings", labelKey:"bookings", Icon:Briefcase,     badge:0 },
    { id:"messages", labelKey:"chat",     Icon:MessageCircle, badge:3 },
    { id:"profile",  labelKey:"profile",  Icon:User,          badge:0 },
  ];

  const MESSAGES_LIST = [
    { id:"1", nameEn:"Omar K.",        nameAr:"عمر خ.",        initials:"OK", bg:"bg-amber-100", textColor:"text-amber-700", msgEn:"I'm on my way, ETA 15 min!",            msgAr:"أنا في الطريق، الوصول خلال 15 دقيقة!", time:"2m", unread:2, status:"Online"  },
    { id:"2", nameEn:"Sara M.",        nameAr:"سارة م.",        initials:"SM", bg:"bg-green-100", textColor:"text-green-700", msgEn:"Job completed! Please leave a review.",  msgAr:"اكتمل العمل! يرجى ترك تقييم.",        time:"1h", unread:0, status:"1h ago" },
    { id:"3", nameEn:"FixNow Support", nameAr:"دعم فيكس ناو",  initials:"FN", bg:"bg-amber-500", textColor:"text-white",    msgEn:"Your invoice is ready.",                msgAr:"فاتورتك جاهزة للعرض.",               time:"2h", unread:1, status:"System" },
  ];

  // ─── Tab content renderer ───────────────────────────────────────────────────
  const renderTab = () => {
    if (tabLoading) {
      return (
        <div className="absolute inset-0 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <TabSkeleton tab={activeTab} />
        </div>
      );
    }

    switch (activeTab) {
      // ── HOME ──────────────────────────────────────────────────────────────
      case "home": return (
        <motion.div
          key="home"
          className="absolute inset-0 overflow-y-auto"
          initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-6 }}
          transition={{ duration:0.2 }}
          style={{ scrollbarWidth:"none" }}
        >
          {/* AI Hero + Search */}
          <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 via-amber-500 to-orange-600 mx-4 mt-4 rounded-3xl p-5">
            <div className="absolute -top-8 -end-8 w-36 h-36 rounded-full bg-white/10" />
            <div className="absolute -bottom-6 start-4 w-28 h-28 rounded-full bg-orange-600/30" />
            <div className="relative">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 border border-white/30 mb-3">
                <Sparkles size={11} className="text-white" />
                <span className="text-white" style={{ fontSize:"11px", fontWeight:600 }}>{t("aiPowered")}</span>
              </div>
              <h2 className="text-white mb-1" style={{ fontSize:"20px", fontWeight:800, lineHeight:1.25 }}>{t("whatDoYouNeed")}</h2>
              <p className="text-white/70 mb-4" style={{ fontSize:"12px" }}>{t("searchDesc")}</p>
              <div className={`bg-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg transition-all ${micActive ? "ring-2 ring-red-400" : ""}`}>
                <Sparkles size={16} className="text-amber-500 flex-shrink-0" />
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="flex-1 bg-transparent text-slate-700 placeholder-slate-400 outline-none"
                  style={{ fontSize:"13px" }}
                  onKeyDown={(e) => { if (e.key === "Enter" && search.trim()) onServiceSelect(search.trim()); }}
                />
                {search && (
                  <button onClick={() => setSearch("")} className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center">
                    <span className="text-slate-400" style={{ fontSize:"10px" }}>✕</span>
                  </button>
                )}
                <button
                  onClick={toggleMic}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 ${micActive ? "bg-red-500 shadow-md shadow-red-300" : "bg-amber-50"}`}
                >
                  <Mic size={15} className={micActive ? "text-white" : "text-amber-600"} />
                </button>
              </div>
              {micActive && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  {[0,1,2,3,4].map((i) => (
                    <div key={i} className="w-1 bg-white/80 rounded-full animate-bounce" style={{ height:`${10+Math.abs(Math.sin(i*1.2))*12}px`, animationDelay:`${i*0.1}s` }} />
                  ))}
                  <span className="text-white/80 ms-2" style={{ fontSize:"12px" }}>
                    {lang === "ar" ? "جارٍ الاستماع…" : "Listening…"}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mx-4 mt-3">
            {[
              { val:"4.9★", labelKey:"avgRating",  color:"text-amber-600", bg:"bg-amber-50",  border:"border-amber-100"  },
              { val:"500+", labelKey:"prosOnline", color:"text-blue-600",  bg:"bg-blue-50",   border:"border-blue-100"   },
              { val:"~1h",  labelKey:"response",   color:"text-green-600", bg:"bg-green-50",  border:"border-green-100"  },
            ].map((s) => (
              <div key={s.labelKey} className={`flex flex-col items-center py-3 rounded-2xl border ${s.bg} ${s.border}`}>
                <span className={s.color} style={{ fontSize:"14px", fontWeight:800 }}>{s.val}</span>
                <span className="text-slate-400 mt-0.5" style={{ fontSize:"10px" }}>{t(s.labelKey)}</span>
              </div>
            ))}
          </div>

          {/* Services */}
          <div className="px-4 mt-5">
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-slate-900 dark:text-white" style={{ fontSize:"16px", fontWeight:700 }}>{t("services")}</h3>
              <button className="flex items-center gap-1 text-amber-600 active:opacity-70" style={{ fontSize:"13px", fontWeight:600 }}>
                {t("viewAll")} <ChevronRight size={14} className="rtl:rotate-180" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {SERVICES.map((s) => (
                <ServiceCategoryCard key={s.key} icon={s.icon} label={t(s.key)} iconBg={s.iconBg} iconColor={s.iconColor} onClick={() => onServiceSelect(t(s.key))} />
              ))}
            </div>
          </div>

          {/* Active Leads */}
          <div className="mt-5">
            <div className="flex items-center justify-between px-4 mb-3.5">
              <div className="flex items-center gap-2">
                <h3 className="text-slate-900 dark:text-white" style={{ fontSize:"16px", fontWeight:700 }}>{t("activeLeads")}</h3>
                <span className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center" style={{ fontSize:"10px", fontWeight:800 }}>
                  {leads.filter((l) => l.status !== "completed").length}
                </span>
              </div>
              <button onClick={() => setShowAllLeads(true)} className="flex items-center gap-1 text-amber-600 active:opacity-70" style={{ fontSize:"13px", fontWeight:600 }}>
                {t("viewAll")} <ChevronRight size={14} className="rtl:rotate-180" />
              </button>
            </div>
            <div className="mx-4 mb-3 flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
              <p className="text-blue-600" style={{ fontSize:"11px", fontWeight:500 }}>{t("pendingTip")}</p>
            </div>
            <div className="flex gap-3 overflow-x-auto px-4 pb-2" style={{ scrollbarWidth:"none" }}>
              {leads.map((lead) => (
                <LeadCard key={lead.id} {...lead} showPrice={showHourlyRate} onClick={() => handleLeadTap(lead)} />
              ))}
              <button
                onClick={() => onServiceSelect("General")}
                className="flex-shrink-0 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/50 active:bg-amber-50 transition-all active:scale-95"
                style={{ width:"120px", minHeight:"180px" }}
              >
                <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center">
                  <Plus size={20} className="text-amber-600" />
                </div>
                <span className="text-amber-700 text-center" style={{ fontSize:"12px", fontWeight:600, lineHeight:1.3, whiteSpace:"pre-line" }}>
                  {t("postNewJob")}
                </span>
              </button>
            </div>
          </div>

          {/* How it works */}
          <div className="mx-4 mt-5 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4">
            <p className="text-slate-900 dark:text-white mb-4" style={{ fontSize:"15px", fontWeight:700 }}>{t("howItWorks")}</p>
            <div className="flex items-start gap-3">
              {[
                { num:"1", titleKey:"step1Title", subKey:"step1Sub", color:"bg-amber-500" },
                { num:"2", titleKey:"step2Title", subKey:"step2Sub", color:"bg-blue-500"  },
                { num:"3", titleKey:"step3Title", subKey:"step3Sub", color:"bg-green-500" },
              ].map((s) => (
                <div key={s.num} className="flex flex-col items-center flex-1 text-center gap-2">
                  <div className={`w-9 h-9 rounded-2xl ${s.color} flex items-center justify-center shadow-sm`}>
                    <span className="text-white" style={{ fontSize:"14px", fontWeight:800 }}>{s.num}</span>
                  </div>
                  <div>
                    <p className="text-slate-900 dark:text-white" style={{ fontSize:"12px", fontWeight:700 }}>{t(s.titleKey)}</p>
                    <p className="text-slate-400" style={{ fontSize:"10px" }}>{t(s.subKey)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="h-6" />
        </motion.div>
      );

      // ── BOOKINGS ──────────────────────────────────────────────────────────
      case "bookings": return (
        <motion.div
          key="bookings"
          className="absolute inset-0 overflow-y-auto px-4 pt-4"
          initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-6 }}
          transition={{ duration:0.2 }}
          style={{ scrollbarWidth:"none" }}
        >
          <h2 className="text-slate-900 dark:text-white mb-4" style={{ fontSize:"18px", fontWeight:800 }}>{t("myBookings")}</h2>

          {/* Empty state guard - we have data, but demo the component anyway when 0 */}
          {BOOKING_DATA.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Briefcase size={32} className="text-slate-300" />
              </div>
              <p className="text-slate-700 dark:text-slate-200" style={{ fontSize:"16px", fontWeight:700 }}>
                {lang === "ar" ? "لا توجد حجوزات بعد" : "No bookings yet"}
              </p>
              <p className="text-slate-400 text-center" style={{ fontSize:"13px" }}>
                {lang === "ar" ? "ابدأ بنشر طلبك الأول" : "Post your first job to get started"}
              </p>
            </div>
          ) : (
            BOOKING_DATA.map((b) => (
              <motion.button
                key={b.id}
                whileTap={{ scale:0.98 }}
                onClick={() => handleBookingTap(b)}
                className="w-full bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-3 text-start cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-slate-900 dark:text-white" style={{ fontSize:"14px", fontWeight:700 }}>
                      {lang === "ar" ? b.serviceAr : b.serviceEn}
                    </p>
                    <p className="text-slate-400 mt-0.5" style={{ fontSize:"12px" }}>
                      {lang === "ar" ? b.dateAr : b.dateEn}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full border flex-shrink-0 ${
                      b.statusKey==="active"    ? "bg-blue-50 border-blue-200 text-blue-700"   :
                      b.statusKey==="pending"   ? "bg-amber-50 border-amber-200 text-amber-700" :
                                                  "bg-green-50 border-green-200 text-green-700"
                    }`}
                    style={{ fontSize:"10px", fontWeight:700 }}
                  >
                    {t(b.statusKey==="active" ? "inProgress" : b.statusKey==="pending" ? "awaiting" : "done")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {b.proInitials && b.proEn !== "—" && (
                      <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
                        <span className="text-amber-700" style={{ fontSize:"8px", fontWeight:800 }}>{b.proInitials}</span>
                      </div>
                    )}
                    <span className="text-slate-500 dark:text-slate-400" style={{ fontSize:"12px" }}>
                      {t("pro")}: {lang === "ar" ? b.proAr : b.proEn}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {showHourlyRate && b.price > 0 && <span className="text-slate-900 dark:text-white" style={{ fontSize:"15px", fontWeight:800 }}>${b.price}/hr</span>}
                    <ChevronRight size={14} className="text-slate-300 rtl:rotate-180" />
                  </div>
                </div>
              </motion.button>
            ))
          )}
        </motion.div>
      );

      // ── MESSAGES ─────────────────────────────────────────────────────────
      case "messages": return (
        <motion.div
          key="messages"
          className="absolute inset-0 overflow-y-auto px-4 pt-4"
          initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-6 }}
          transition={{ duration:0.2 }}
          style={{ scrollbarWidth:"none" }}
        >
          <h2 className="text-slate-900 dark:text-white mb-4" style={{ fontSize:"18px", fontWeight:800 }}>{t("chat")}</h2>
          <div className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-200 dark:border-slate-700 mb-4">
            <Search size={15} className="text-slate-400" />
            <input
              placeholder={t("searchConversations")}
              className="flex-1 bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400"
              style={{ fontSize:"13px" }}
            />
          </div>
          {MESSAGES_LIST.map((m) => (
            <motion.button
              key={m.id}
              whileTap={{ scale:0.98 }}
              onClick={() => setChatContact({ name: lang === "ar" ? m.nameAr : m.nameEn, initials:m.initials, bg:m.bg, textColor:m.textColor, status:m.status })}
              className="w-full flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-2 cursor-pointer transition-all text-start"
            >
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${m.bg}`}>
                <span className={m.textColor} style={{ fontSize:"12px", fontWeight:800 }}>{m.initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-slate-900 dark:text-white" style={{ fontSize:"14px", fontWeight:700 }}>
                  {lang === "ar" ? m.nameAr : m.nameEn}
                </p>
                <p className="text-slate-400 truncate" style={{ fontSize:"12px" }}>
                  {lang === "ar" ? m.msgAr : m.msgEn}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <span className="text-slate-400" style={{ fontSize:"10px" }}>{m.time}</span>
                {m.unread > 0 && (
                  <span className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center" style={{ fontSize:"10px", fontWeight:700 }}>{m.unread}</span>
                )}
              </div>
            </motion.button>
          ))}
        </motion.div>
      );

      // ── PROFILE ──────────────────────────────────────────────────────────
      case "profile": return (
        <motion.div
          key="profile"
          className="absolute inset-0"
          initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
          transition={{ duration:0.18 }}
        >
          <ProfileTab
            isOffline={isOffline}
            onToggleOffline={onToggleOffline}
            notifications={notifications}
            onMarkAllRead={markAllRead}
            onMarkRead={markRead}
            unreadCount={unreadCount}
          />
        </motion.div>
      );

      default: return null;
    }
  };

  return (
    <div className="flex flex-col bg-slate-50 dark:bg-slate-900" style={{ height:"100svh" }}>

      {/* ══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <div className="flex-shrink-0 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border-b border-slate-100 dark:border-slate-700 shadow-sm z-30 relative">
        <div className="flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-sm shadow-amber-200">
                <span className="text-white" style={{ fontSize:"13px", fontWeight:800 }}>AK</span>
              </div>
              <div className="absolute -bottom-0.5 -end-0.5 w-3.5 h-3.5 rounded-full bg-green-400 border-2 border-white dark:border-slate-800" />
            </div>
            <div>
              <p className="text-slate-400" style={{ fontSize:"11px", fontWeight:500 }}>{t("greeting")}</p>
              <p className="text-slate-900 dark:text-white" style={{ fontSize:"14px", fontWeight:700 }}>
                {lang === "ar" ? "أحمد الخالد" : "Ahmed Al-Khalid"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <LangToggle />
            {isOffline && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200">
                <WifiOff size={10} className="text-amber-600" />
                <span className="text-amber-700" style={{ fontSize:"10px", fontWeight:700 }}>{t("offline")}</span>
              </div>
            )}
            <button
              onClick={() => setNotifOpen(true)}
              className="relative w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all"
            >
              <Bell size={17} className={notifOpen ? "text-amber-500" : "text-slate-600 dark:text-slate-300"} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center border-2 border-white dark:border-slate-800" style={{ fontSize:"8px", fontWeight:800 }}>
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ══ CONTENT AREA — overlays live here so BottomNav stays visible ═══ */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {tabLoading ? (
            <motion.div
              key={`skeleton-${activeTab}`}
              className="absolute inset-0 overflow-y-auto bg-slate-50 dark:bg-slate-900"
              initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
              transition={{ duration:0.12 }}
              style={{ scrollbarWidth:"none" }}
            >
              <TabSkeleton tab={activeTab} />
            </motion.div>
          ) : (
            renderTab()
          )}
        </AnimatePresence>

        {/* ══ OVERLAYS inside content area — BottomNav stays visible ══════ */}

        {/* All Leads */}
        <AllLeadsView
          leads={leads}
          isVisible={showAllLeads}
          onBack={() => setShowAllLeads(false)}
          onOpenBids={(lead) => { setShowAllLeads(false); setBidsLead(lead); }}
          onOpenDetail={(lead) => { setShowAllLeads(false); setJobDetail(leadToJobData(lead)); }}
          onPostNew={() => { setShowAllLeads(false); onServiceSelect("General"); }}
        />

        {/* Bids Screen */}
        <div
          className="absolute inset-0 z-20 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ transform: bidsLead ? "translateX(0)" : "translateX(100%)" }}
        >
          {bidsLead && (
            <BidsScreen lead={bidsLead} onBack={() => setBidsLead(null)} onBookBid={handleBookBid} />
          )}
        </div>

        {/* Job Detail */}
        {jobDetail && (
          <JobDetailView
            job={jobDetail}
            isVisible={!!jobDetail}
            onBack={() => setJobDetail(null)}
            onOpenChat={(contact) => { setJobDetail(null); setChatContact(contact); }}
          />
        )}

        {/* Chat Screen */}
        {chatContact && (
          <ChatScreen contact={chatContact} onBack={() => setChatContact(null)} isVisible={!!chatContact} />
        )}

        {/* Notification Drawer */}
        <NotificationDrawer
          isOpen={notifOpen}
          notifications={notifications}
          onClose={() => setNotifOpen(false)}
          onMarkAllRead={markAllRead}
          onMarkRead={markRead}
          onTapNotif={handleNotifTap}
          onOpenSettings={() => navigate("/home/profile")}
        />
      </div>

      {/* ══ BOTTOM NAV (always visible — outside content area) ═════════════ */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-20">
        <div className="flex items-center justify-around px-2 pt-2 pb-3">
          {NAV_TABS.map(({ id, labelKey, Icon, badge }) => {
            const active = activeTab === id;
            return (
              <motion.button
                key={id}
                onClick={() => navigate(TAB_PATHS[id])}
                whileTap={{ scale:0.88 }}
                className="relative flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl transition-all duration-150 min-w-[60px]"
              >
                {active && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 bg-amber-50 dark:bg-amber-900/20 rounded-2xl"
                    transition={{ type:"spring", stiffness:400, damping:35 }}
                  />
                )}
                {badge > 0 && !active && (
                  <span className="absolute top-0 end-2 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center z-10" style={{ fontSize:"8px", fontWeight:700 }}>
                    {badge}
                  </span>
                )}
                <Icon size={22} className={`relative transition-colors z-10 ${active ? "text-amber-500" : "text-slate-400"}`} />
                <span className="relative z-10 transition-colors" style={{ fontSize:"10px", fontWeight: active ? 700 : 500, color: active ? "#F59E0B" : "#94a3b8" }}>
                  {t(labelKey)}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Success snackbar */}
      <Snackbar visible={bookSnack} variant="success" message={bookSnackMsg} onDismiss={() => setBookSnack(false)} duration={4000} />
    </div>
  );
}