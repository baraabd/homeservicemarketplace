interface PromoSectionProps {
  lang: 'EN' | 'AR';
}

const promos = [
  {
    title: 'First booking free!',
    titleAr: 'أول حجز مجاني!',
    subtitle: 'New user offer',
    subtitleAr: 'عرض المستخدم الجديد',
    gradient: 'from-orange-500 to-amber-400',
    icon: (
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 12 20 22 4 22 4 12" />
        <rect width="22" height="5" x="1" y="7" />
        <line x1="12" x2="12" y1="22" y2="7" />
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
      </svg>
    ),
    code: 'FREE1ST',
  },
  {
    title: '20% off AC repairs',
    titleAr: 'خصم 20% على التكييف',
    subtitle: 'This week only',
    subtitleAr: 'هذا الأسبوع فقط',
    gradient: 'from-cyan-500 to-blue-500',
    icon: (
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="20" height="8" rx="2" />
        <path d="M9 19h6" />
        <path d="M12 11v8" />
      </svg>
    ),
    code: 'AC20OFF',
  },
];

export function PromoSection({ lang }: PromoSectionProps) {
  const isAr = lang === 'AR';

  return (
    <div className="px-4 mt-5">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-3.5">
        <h2 className="text-slate-800" style={{ fontSize: '16px', fontWeight: 700 }}>
          {isAr ? 'العروض الخاصة' : 'Special Offers'}
        </h2>
        <span
          className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100"
          style={{ fontSize: '10px', fontWeight: 700 }}
        >
          {isAr ? 'محدود الوقت' : 'Limited Time'}
        </span>
      </div>

      {/* Promo Cards — horizontal scroll */}
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none -mx-0">
        {promos.map((promo, i) => (
          <div
            key={i}
            className={`flex-shrink-0 relative bg-gradient-to-br ${promo.gradient} rounded-2xl p-4 overflow-hidden`}
            style={{ width: '200px' }}
          >
            {/* Background circles */}
            <div className="absolute -bottom-4 -end-4 w-24 h-24 rounded-full bg-white/10" />
            <div className="absolute -top-2 end-8 w-12 h-12 rounded-full bg-white/10" />

            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-3">
                {promo.icon}
              </div>
              <p
                className="text-white mb-0.5"
                style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.3 }}
              >
                {isAr ? promo.titleAr : promo.title}
              </p>
              <p className="text-white/70 mb-3" style={{ fontSize: '11px' }}>
                {isAr ? promo.subtitleAr : promo.subtitle}
              </p>
              <div className="inline-flex items-center gap-1.5 bg-white/20 border border-white/30 rounded-lg px-2.5 py-1">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <polyline points="20 12 20 22 4 22 4 12" />
                  <rect width="22" height="5" x="1" y="7" />
                </svg>
                <span
                  className="text-white"
                  style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em' }}
                >
                  {promo.code}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
