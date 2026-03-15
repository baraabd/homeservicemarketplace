interface BottomNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  lang: "EN" | "AR";
}

const tabs = [
  {
    id: "home",
    label: "Home",
    labelAr: "الرئيسية",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "#2563eb" : "none"} stroke={active ? "#2563eb" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: "jobs",
    label: "My Jobs",
    labelAr: "وظائفي",
    badge: 2,
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#2563eb" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="20" height="14" x="2" y="7" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    id: "chat",
    label: "Chat",
    labelAr: "المحادثات",
    badge: 5,
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#2563eb" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "profile",
    label: "Profile",
    labelAr: "حسابي",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#2563eb" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
];

export function BottomNav({ activeTab, onTabChange, lang }: BottomNavProps) {
  const isAr = lang === "AR";

  return (
    <div className="sticky bottom-0 z-50 bg-white border-t border-slate-100 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
      {/* Safe area spacer - subtle top glow */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-200 to-transparent opacity-60" />

      <div className="flex items-center justify-around px-2 pt-2 pb-3">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="relative flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl transition-all duration-200 active:scale-90 min-w-[60px]"
            >
              {/* Active pill background */}
              {active && (
                <div className="absolute inset-0 bg-blue-50 rounded-2xl" />
              )}

              {/* Badge */}
              {tab.badge && !active && (
                <span
                  className="absolute top-0.5 end-2.5 min-w-[16px] h-4 rounded-full bg-orange-500 text-white flex items-center justify-center"
                  style={{ fontSize: "9px", fontWeight: 700 }}
                >
                  {tab.badge}
                </span>
              )}

              <div className="relative">{tab.icon(active)}</div>
              <span
                className="relative transition-colors duration-200"
                style={{
                  fontSize: "10px",
                  fontWeight: active ? 700 : 500,
                  color: active ? "#2563eb" : "#94a3b8",
                }}
              >
                {isAr ? tab.labelAr : tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
