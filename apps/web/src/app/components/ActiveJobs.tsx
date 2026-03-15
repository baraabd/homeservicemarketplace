interface ActiveJobsProps {
  lang: "EN" | "AR";
}

export function ActiveJobs({ lang }: ActiveJobsProps) {
  const isAr = lang === "AR";

  return (
    <div className="px-4 mt-5 mb-2">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <h2 className="text-slate-800" style={{ fontSize: "16px", fontWeight: 700 }}>
            {isAr ? "الطلبات النشطة" : "Active Requests"}
          </h2>
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-500" style={{ fontSize: "11px", fontWeight: 700 }}>
            0
          </span>
        </div>
        <button className="text-blue-600 flex items-center gap-1 active:opacity-70" style={{ fontSize: "13px", fontWeight: 600 }}>
          {isAr ? "السجل" : "History"}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: isAr ? "scaleX(-1)" : "none" }}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Empty State Card */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Top accent strip */}
        <div className="h-1 bg-gradient-to-r from-blue-600 to-indigo-500" />

        <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
          {/* Illustration */}
          <div className="relative mb-5">
            <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center">
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#93c5fd"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" x2="8" y1="13" y2="13" />
                <line x1="16" x2="8" y1="17" y2="17" />
                <line x1="10" x2="8" y1="9" y2="9" />
              </svg>
            </div>
            {/* Floating badge */}
            <div className="absolute -top-1 -end-1 w-7 h-7 rounded-full bg-orange-100 border-2 border-white flex items-center justify-center">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
            </div>
          </div>

          <p className="text-slate-800 mb-1.5" style={{ fontSize: "15px", fontWeight: 700 }}>
            {isAr ? "لا توجد طلبات نشطة" : "No active requests"}
          </p>
          <p className="text-slate-400 mb-6 max-w-[200px]" style={{ fontSize: "13px", lineHeight: "1.5" }}>
            {isAr
              ? "انشر وظيفة وسنوصلك بالمحترفين الموثوقين"
              : "Post a job and we'll connect you with trusted professionals"}
          </p>

          {/* CTA Button */}
          <button className="w-full py-3.5 rounded-2xl bg-blue-600 text-white flex items-center justify-center gap-2.5 shadow-md shadow-blue-200 active:scale-98 transition-all hover:bg-blue-700">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="16" />
              <line x1="8" x2="16" y1="12" y2="12" />
            </svg>
            <span style={{ fontSize: "15px", fontWeight: 700 }}>
              {isAr ? "انشر وظيفة" : "Post a Job"}
            </span>
          </button>

          {/* How it works */}
          <div className="flex items-center gap-4 mt-5 w-full justify-center">
            {[
              { step: "1", label: isAr ? "انشر" : "Post" },
              { step: "2", label: isAr ? "احصل على عروض" : "Get Offers" },
              { step: "3", label: isAr ? "احجز" : "Book" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center" style={{ fontSize: "11px", fontWeight: 700 }}>
                    {item.step}
                  </div>
                  <span className="text-slate-500" style={{ fontSize: "10px", fontWeight: 500 }}>
                    {item.label}
                  </span>
                </div>
                {i < 2 && (
                  <svg width="16" height="8" viewBox="0 0 16 8" fill="none" style={{ marginBottom: "10px", transform: isAr ? "scaleX(-1)" : "none" }}>
                    <path d="M0 4h14M10 1l4 3-4 3" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
