interface TopBarProps {
  lang: "EN" | "AR";
  onToggleLang: () => void;
  avatarUrl: string;
}

export function TopBar({ lang, onToggleLang, avatarUrl }: TopBarProps) {
  return (
    <div className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-sm">
      <div className="flex items-center justify-between px-5 py-3.5">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-blue-600 tracking-tight" style={{ fontSize: "15px", fontWeight: 700 }}>
              FixNow
            </span>
            <span className="text-slate-400" style={{ fontSize: "10px", fontWeight: 500, letterSpacing: "0.04em" }}>
              Home Services
            </span>
          </div>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
          {/* Lang Toggle */}
          <button
            onClick={onToggleLang}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 transition-all active:scale-95"
            style={{ fontSize: "12px", fontWeight: 600 }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${lang === "EN" ? "bg-blue-600" : "bg-orange-500"}`}
            />
            {lang === "EN" ? "EN" : "AR"}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M7 16V4m0 0L3 8m4-4 4 4" />
              <path d="M17 8v12m0 0 4-4m-4 4-4-4" />
            </svg>
          </button>

          {/* Notification Bell */}
          <button className="relative w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center active:scale-95">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span className="absolute top-1.5 end-1.5 w-2 h-2 rounded-full bg-orange-500 border-2 border-white" />
          </button>

          {/* Avatar */}
          <button className="w-9 h-9 rounded-full overflow-hidden border-2 border-blue-200 shadow-sm active:scale-95">
            <img
              src={avatarUrl}
              alt="User avatar"
              className="w-full h-full object-cover"
            />
          </button>
        </div>
      </div>
    </div>
  );
}
