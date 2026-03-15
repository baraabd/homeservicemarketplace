import { useState } from "react";
import { useNavigate } from "react-router";
// @ts-ignore – motion/react is the correct package path
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, ChevronRight, Info, LogOut, AlertTriangle,
} from "lucide-react";
import { useLang, LangToggle } from "../../i18n/LanguageContext";

// ─── Reusable Toggle ──────────────────────────────────────────────────────────
function SettingsToggle({
  enabled, onChange, label, sub,
}: {
  enabled: boolean; onChange: () => void; label: string; sub?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 px-4">
      <div className="flex-1 min-w-0 me-4">
        <p className="text-slate-800 dark:text-slate-100" style={{ fontSize: "14px", fontWeight: 500 }}>{label}</p>
        {sub && <p className="text-slate-400 dark:text-slate-500 mt-0.5" style={{ fontSize: "11px" }}>{sub}</p>}
      </div>
      <button
        onClick={onChange}
        className={`w-11 h-6 rounded-full border-2 transition-all duration-300 flex items-center px-0.5 flex-shrink-0 ${
          enabled ? "bg-amber-500 border-amber-500" : "bg-slate-200 dark:bg-slate-600 border-slate-200 dark:border-slate-600"
        }`}
      >
        <motion.div
          className="w-4 h-4 rounded-full bg-white shadow-sm"
          animate={{ x: enabled ? 20 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="px-4 mb-2 text-slate-400 dark:text-slate-500" style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {title}
      </p>
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden divide-y divide-slate-50 dark:divide-slate-700">
        {children}
      </div>
    </div>
  );
}

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const { lang, dir, darkMode, toggleDarkMode, toggleLang } = useLang();
  const navigate = useNavigate();

  const [pushNotifs,  setPushNotifs]  = useState(true);
  const [emailNotifs, setEmailNotifs] = useState(false);
  const [smsNotifs,   setSmsNotifs]   = useState(true);
  const [bidAlerts,   setBidAlerts]   = useState(true);
  const [locationSvc, setLocationSvc] = useState(true);
  const [dataSharing, setDataSharing] = useState(false);
  const [signOutModal,setSignOutModal]= useState(false);

  const L = {
    title:         lang === "ar" ? "الإعدادات"                : "Settings",
    appearance:    lang === "ar" ? "المظهر"                   : "Appearance",
    darkMode:      lang === "ar" ? "الوضع الليلي"             : "Dark Mode",
    darkModeSub:   lang === "ar" ? "تغيير مظهر التطبيق"       : "Toggle app appearance",
    language:      lang === "ar" ? "اللغة"                    : "Language",
    langSub:       lang === "ar" ? "العربية / الإنجليزية"      : "Arabic / English",
    notifications: lang === "ar" ? "الإشعارات"                : "Notifications",
    push:          lang === "ar" ? "إشعارات الجهاز"           : "Push Notifications",
    pushSub:       lang === "ar" ? "تلقّي الإشعارات الفورية"   : "Receive real-time alerts",
    email:         lang === "ar" ? "إشعارات البريد"            : "Email Notifications",
    sms:           lang === "ar" ? "إشعارات الرسائل"          : "SMS Notifications",
    bids:          lang === "ar" ? "تنبيهات العروض الجديدة"    : "New Bid Alerts",
    privacy:       lang === "ar" ? "الخصوصية"                 : "Privacy",
    location:      lang === "ar" ? "خدمات الموقع"             : "Location Services",
    locationSub:   lang === "ar" ? "للتطابق الأفضل مع المحترفين" : "For better pro matching",
    dataShare:     lang === "ar" ? "مشاركة بيانات الاستخدام"   : "Share Usage Data",
    dataShareSub:  lang === "ar" ? "يساعدنا في تحسين التطبيق"  : "Helps us improve the app",
    about:         lang === "ar" ? "حول التطبيق"               : "About",
    version:       lang === "ar" ? "الإصدار"                   : "Version",
    terms:         lang === "ar" ? "الشروط والأحكام"           : "Terms & Conditions",
    privacy2:      lang === "ar" ? "سياسة الخصوصية"           : "Privacy Policy",
    rateApp:       lang === "ar" ? "قيّم التطبيق"              : "Rate the App",
    signOut:       lang === "ar" ? "تسجيل الخروج"              : "Sign Out",
    signOutQ:      lang === "ar" ? "هل أنت متأكد من تسجيل الخروج؟" : "Are you sure you want to sign out?",
    cancel:        lang === "ar" ? "إلغاء"                     : "Cancel",
    confirm:       lang === "ar" ? "تسجيل الخروج"              : "Sign Out",
  };

  return (
    <>
      <motion.div
        className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900"
        initial={{ x: dir === "rtl" ? "-100%" : "100%" }}
        animate={{ x: 0 }}
        exit={{ x: dir === "rtl" ? "-100%" : "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
      >
        {/* Header */}
        <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <button
              onClick={onBack}
              className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all"
            >
              {dir === "rtl"
                ? <ChevronRight size={20} className="text-slate-700 dark:text-slate-300" />
                : <ChevronLeft  size={20} className="text-slate-700 dark:text-slate-300" />
              }
            </button>
            <p className="text-slate-900 dark:text-white" style={{ fontSize: "16px", fontWeight: 800 }}>{L.title}</p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: "none" }}>

          {/* ── Appearance ── */}
          <Section title={L.appearance}>
            <SettingsToggle
              enabled={darkMode}
              onChange={toggleDarkMode}
              label={L.darkMode}
              sub={L.darkModeSub}
            />
            {/* Language row – inline toggle */}
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="me-4">
                <p className="text-slate-800 dark:text-slate-100" style={{ fontSize: "14px", fontWeight: 500 }}>{L.language}</p>
                <p className="text-slate-400 dark:text-slate-500 mt-0.5" style={{ fontSize: "11px" }}>{L.langSub}</p>
              </div>
              <LangToggle />
            </div>
          </Section>

          {/* ── Notifications ── */}
          <Section title={L.notifications}>
            <SettingsToggle enabled={pushNotifs}  onChange={() => setPushNotifs(v => !v)}  label={L.push}  sub={L.pushSub} />
            <SettingsToggle enabled={emailNotifs} onChange={() => setEmailNotifs(v => !v)} label={L.email} />
            <SettingsToggle enabled={smsNotifs}   onChange={() => setSmsNotifs(v => !v)}   label={L.sms}   />
            <SettingsToggle enabled={bidAlerts}   onChange={() => setBidAlerts(v => !v)}   label={L.bids}  />
          </Section>

          {/* ── Privacy ── */}
          <Section title={L.privacy}>
            <SettingsToggle enabled={locationSvc} onChange={() => setLocationSvc(v => !v)} label={L.location} sub={L.locationSub} />
            <SettingsToggle enabled={dataSharing} onChange={() => setDataSharing(v => !v)} label={L.dataShare} sub={L.dataShareSub} />
          </Section>

          {/* ── About ── */}
          <Section title={L.about}>
            {/* Version */}
            <div className="flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <Info size={15} className="text-slate-500" />
                </div>
                <span className="text-slate-800 dark:text-slate-100" style={{ fontSize: "14px" }}>{L.version}</span>
              </div>
              <span className="text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-lg" style={{ fontSize: "12px", fontWeight: 600 }}>
                v2.4.1
              </span>
            </div>

            {[L.terms, L.privacy2, L.rateApp].map((item, i) => (
              <button key={i} className="w-full flex items-center justify-between px-4 py-3.5 active:bg-slate-50 dark:active:bg-slate-700/50 transition-all text-start">
                <span className="text-slate-700 dark:text-slate-200" style={{ fontSize: "14px" }}>{item}</span>
                <ChevronRight size={16} className="text-slate-300 rtl:rotate-180" />
              </button>
            ))}
          </Section>

          {/* ── Sign Out ── */}
          <button
            onClick={() => setSignOutModal(true)}
            className="w-full flex items-center justify-center gap-2.5 py-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-3xl mb-6 active:bg-red-100 dark:active:bg-red-900/30 transition-all"
          >
            <LogOut size={18} className="text-red-500" />
            <span className="text-red-600 dark:text-red-400" style={{ fontSize: "15px", fontWeight: 700 }}>{L.signOut}</span>
          </button>
        </div>
      </motion.div>

      {/* Sign-out confirmation modal */}
      <AnimatePresence>
        {signOutModal && (
          <>
            <motion.div
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSignOutModal(false)}
            />
            <motion.div
              className="absolute bottom-0 start-0 end-0 bg-white dark:bg-slate-800 rounded-t-3xl p-6 z-40"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
            >
              <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600 mx-auto mb-5" />
              <div className="flex flex-col items-center text-center gap-3 mb-6">
                <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <AlertTriangle size={28} className="text-red-500" />
                </div>
                <p className="text-slate-900 dark:text-white" style={{ fontSize: "18px", fontWeight: 800 }}>{L.signOut}</p>
                <p className="text-slate-400 dark:text-slate-500" style={{ fontSize: "13px" }}>{L.signOutQ}</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setSignOutModal(false)}
                  className="flex-1 py-3.5 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 active:bg-slate-200 transition-all"
                  style={{ fontSize: "15px", fontWeight: 700 }}
                >
                  {L.cancel}
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem("fixnow_authed");
                    setSignOutModal(false);
                    navigate("/select");
                  }}
                  className="flex-1 py-3.5 rounded-2xl bg-red-500 text-white active:bg-red-600 transition-all shadow-md shadow-red-200 dark:shadow-none"
                  style={{ fontSize: "15px", fontWeight: 700 }}
                >
                  {L.confirm}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}