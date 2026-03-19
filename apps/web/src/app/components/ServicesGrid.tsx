import { useState } from 'react';

interface ServiceCardProps {
  icon: React.ReactNode;
  label: string;
  labelAr: string;
  color: string;
  bgColor: string;
  borderColor: string;
  lang: 'EN' | 'AR';
  badge?: string;
}

function ServiceCard({
  icon,
  label,
  labelAr,
  color,
  bgColor,
  borderColor,
  lang,
  badge,
}: ServiceCardProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={`relative flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-white border p-4 transition-all duration-150 active:scale-95 ${borderColor} shadow-sm hover:shadow-md`}
      style={{
        aspectRatio: '1 / 1',
        transform: pressed ? 'scale(0.95)' : 'scale(1)',
      }}
    >
      {badge && (
        <span
          className="absolute top-2 end-2 bg-orange-500 text-white rounded-full px-1.5"
          style={{ fontSize: '9px', fontWeight: 700, lineHeight: '16px' }}
        >
          {badge}
        </span>
      )}
      <div
        className={`w-12 h-12 rounded-2xl flex items-center justify-center ${bgColor} shadow-sm`}
      >
        <div style={{ color }} className="w-6 h-6">
          {icon}
        </div>
      </div>
      <span
        className="text-slate-700 text-center leading-tight"
        style={{ fontSize: '12px', fontWeight: 600 }}
      >
        {lang === 'AR' ? labelAr : label}
      </span>
    </button>
  );
}

const services = [
  {
    label: 'Plumbing',
    labelAr: 'سباكة',
    color: '#2563eb',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-100',
    badge: undefined,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        <path d="M12 2a5 5 0 0 1 5 5v3H7V7a5 5 0 0 1 5-5z" />
        <path d="M7 10v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V10" />
        <line x1="12" y1="14" x2="12" y2="18" />
      </svg>
    ),
  },
  {
    label: 'Electrical',
    labelAr: 'كهرباء',
    color: '#d97706',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-100',
    badge: 'Hot',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    label: 'AC Repair',
    labelAr: 'تكييف',
    color: '#0891b2',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-100',
    badge: undefined,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        <rect x="2" y="3" width="20" height="8" rx="2" />
        <path d="M9 19h6" />
        <path d="M12 11v8" />
        <path d="M6 7h.01M10 7h.01" />
      </svg>
    ),
  },
  {
    label: 'Cleaning',
    labelAr: 'تنظيف',
    color: '#16a34a',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-100',
    badge: undefined,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        <path d="M20 10c0-4.4-3.6-8-8-8s-8 3.6-8 8c0 2.4 1 4.5 2.6 6L12 22l5.4-6c1.6-1.5 2.6-3.6 2.6-6z" />
        <path d="M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      </svg>
    ),
  },
  {
    label: 'Carpentry',
    labelAr: 'نجارة',
    color: '#92400e',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-100',
    badge: undefined,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        <path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9" />
        <path d="M17.64 15 22 10.64" />
        <path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91" />
      </svg>
    ),
  },
  {
    label: 'Painting',
    labelAr: 'دهانات',
    color: '#7c3aed',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-100',
    badge: undefined,
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        <path d="M2 22c1.25-.987 2.27-1.975 3.9-2.2a5.56 5.56 0 0 1 3.8 1.5 4 4 0 0 0 6.187-2.353 3.5 3.5 0 0 0 3.69-5.116A3.5 3.5 0 0 0 20.95 8 3.5 3.5 0 1 0 16 3.05a3.5 3.5 0 0 0-5.831 1.373 3.5 3.5 0 0 0-5.116 3.69 4 4 0 0 0-2.348 6.155C3.499 15.42 1.842 17.405 2 22" />
      </svg>
    ),
  },
];

interface ServicesGridProps {
  lang: 'EN' | 'AR';
}

export function ServicesGrid({ lang }: ServicesGridProps) {
  return (
    <div className="px-4 mt-5">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-3.5">
        <h2 className="text-slate-800" style={{ fontSize: '16px', fontWeight: 700 }}>
          {lang === 'AR' ? 'الخدمات' : 'Our Services'}
        </h2>
        <button
          className="text-blue-600 flex items-center gap-1 active:opacity-70"
          style={{ fontSize: '13px', fontWeight: 600 }}
        >
          {lang === 'AR' ? 'عرض الكل' : 'View All'}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: lang === 'AR' ? 'scaleX(-1)' : 'none' }}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-3">
        {services.map((service) => (
          <ServiceCard key={service.label} {...service} lang={lang} />
        ))}
      </div>
    </div>
  );
}
