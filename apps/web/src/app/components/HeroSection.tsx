import { useState } from "react";

interface HeroSectionProps {
  lang: "EN" | "AR";
}

export function HeroSection({ lang }: HeroSectionProps) {
  const [searchVal, setSearchVal] = useState("");
  const [focused, setFocused] = useState(false);

  const isAr = lang === "AR";

  return (
    <div className="relative overflow-hidden rounded-3xl mx-4 mt-4 mb-1">
      {/* Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800" />

      {/* Decorative circles */}
      <div className="absolute -top-10 -end-10 w-40 h-40 rounded-full bg-white/5" />
      <div className="absolute -bottom-8 -start-8 w-32 h-32 rounded-full bg-blue-500/30" />
      <div className="absolute top-8 end-16 w-16 h-16 rounded-full bg-white/5" />
      <div className="absolute top-2 start-1/2 w-24 h-24 rounded-full bg-indigo-500/20" />

      <div className="relative px-5 pt-6 pb-5">
        {/* Greeting */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-blue-200" style={{ fontSize: "13px", fontWeight: 500 }}>
            {isAr ? "صباح الخير،" : "Good Morning,"}
          </span>
          <span className="text-2xl">👋</span>
        </div>
        <h1 className="text-white mb-0.5" style={{ fontSize: "22px", fontWeight: 700, lineHeight: 1.25 }}>
          {isAr ? "أحمد" : "Ahmed"}
        </h1>
        <p className="text-blue-200 mb-5" style={{ fontSize: "13px", fontWeight: 400 }}>
          {isAr ? "ما الذي تحتاج مساعدةً فيه اليوم؟" : "What do you need help with today?"}
        </p>

        {/* Search Bar */}
        <div
          className={`flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 transition-all duration-200 ${
            focused ? "shadow-lg shadow-blue-900/30 ring-2 ring-white/40" : "shadow-md shadow-blue-900/20"
          }`}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke={focused ? "#2563eb" : "#94a3b8"}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-shrink-0 transition-colors duration-200"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={isAr ? "ابحث عن خدمة..." : "Search for a service..."}
            className="flex-1 bg-transparent outline-none text-slate-700 placeholder-slate-400"
            style={{ fontSize: "14px", direction: isAr ? "rtl" : "ltr" }}
          />
          {searchVal && (
            <button
              onClick={() => setSearchVal("")}
              className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          {/* Filter Button */}
          <button className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center active:scale-95">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" x2="20" y1="6" y2="6" />
              <line x1="8" x2="16" y1="12" y2="12" />
              <line x1="11" x2="13" y1="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Trending Tags */}
        <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-0.5 scrollbar-none">
          {(isAr ? ["سباكة", "كهرباء", "تنظيف", "نجارة"] : ["Plumbing", "Electrical", "Cleaning", "Carpentry"]).map((tag) => (
            <button
              key={tag}
              className="flex-shrink-0 px-3 py-1 rounded-full bg-white/15 text-white border border-white/20 active:bg-white/25 transition-all"
              style={{ fontSize: "12px", fontWeight: 500 }}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
