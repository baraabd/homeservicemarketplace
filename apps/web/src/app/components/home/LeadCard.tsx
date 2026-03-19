import { Wrench, Zap, Wind, Sparkles, Hammer, Clock, ChevronRight } from 'lucide-react';

export type LeadStatus = 'pending' | 'active' | 'completed' | 'cancelled';

export interface LeadCardProps {
  id: string;
  service: string;
  status: LeadStatus;
  proName?: string;
  proInitials?: string;
  postedAt: string;
  price?: number;
  bids?: number;
  onClick?: () => void;
  showPrice?: boolean; // admin-controlled
}

const serviceIcons: Record<string, React.ReactNode> = {
  Plumbing: <Wrench size={18} />,
  Electrical: <Zap size={18} />,
  'AC Repair': <Wind size={18} />,
  Cleaning: <Sparkles size={18} />,
  Carpentry: <Hammer size={18} />,
  General: <Wrench size={18} />,
};

const serviceColors: Record<string, { bg: string; icon: string }> = {
  Plumbing: { bg: 'bg-blue-100', icon: 'text-blue-600' },
  Electrical: { bg: 'bg-amber-100', icon: 'text-amber-600' },
  'AC Repair': { bg: 'bg-cyan-100', icon: 'text-cyan-600' },
  Cleaning: { bg: 'bg-green-100', icon: 'text-green-600' },
  Carpentry: { bg: 'bg-orange-100', icon: 'text-orange-700' },
  General: { bg: 'bg-slate-100', icon: 'text-slate-600' },
};

const statusConfig: Record<
  LeadStatus,
  { label: string; dot: string; badge: string; text: string }
> = {
  pending: {
    label: 'Pending Bids',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50  border-amber-200',
    text: 'text-amber-700',
  },
  active: {
    label: 'Pro Assigned',
    dot: 'bg-blue-500',
    badge: 'bg-blue-50   border-blue-200',
    text: 'text-blue-700',
  },
  completed: {
    label: 'Completed',
    dot: 'bg-green-500',
    badge: 'bg-green-50  border-green-200',
    text: 'text-green-700',
  },
  cancelled: {
    label: 'Cancelled',
    dot: 'bg-red-400',
    badge: 'bg-red-50    border-red-200',
    text: 'text-red-600',
  },
};

export function LeadCard({
  service,
  status,
  proName,
  proInitials,
  postedAt,
  price,
  bids,
  onClick,
  showPrice = true,
}: LeadCardProps) {
  const svc = serviceColors[service] ?? serviceColors.General;
  const ico = serviceIcons[service] ?? serviceIcons.General;
  const cfg = statusConfig[status];

  return (
    <div
      onClick={onClick}
      className="flex-shrink-0 bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden active:scale-95 transition-all cursor-pointer"
      style={{ width: '168px' }}
    >
      {/* Status color strip */}
      <div
        className={`h-1 w-full rounded-t-3xl ${
          status === 'pending'
            ? 'bg-gradient-to-r from-amber-400 to-orange-400'
            : status === 'active'
              ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
              : status === 'completed'
                ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                : 'bg-slate-200'
        }`}
      />

      <div className="p-4">
        {/* Icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${svc.bg}`}>
          <span className={svc.icon}>{ico}</span>
        </div>

        {/* Service name */}
        <p className="text-slate-900 mb-1.5" style={{ fontSize: '14px', fontWeight: 700 }}>
          {service}
        </p>

        {/* Status badge */}
        <div
          className={`inline-flex items-center gap-1.5 border rounded-full px-2 py-0.5 mb-3 ${cfg.badge}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          <span className={cfg.text} style={{ fontSize: '10px', fontWeight: 700 }}>
            {cfg.label}
          </span>
        </div>

        {/* Pro info */}
        {proName && proInitials && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-700" style={{ fontSize: '9px', fontWeight: 800 }}>
                {proInitials}
              </span>
            </div>
            <span className="text-slate-600" style={{ fontSize: '11px', fontWeight: 500 }}>
              {proName}
            </span>
          </div>
        )}

        {/* Bids if pending */}
        {status === 'pending' && bids !== undefined && (
          <p className="text-amber-600 mb-2" style={{ fontSize: '11px', fontWeight: 600 }}>
            {bids} bid{bids !== 1 ? 's' : ''} received
          </p>
        )}

        {/* Price — hidden when admin disables hourly rate */}
        {showPrice && price && (
          <p
            className="text-slate-900 mb-2"
            style={{ fontSize: '18px', fontWeight: 800, lineHeight: 1.1 }}
          >
            ${price}
            <span className="text-slate-400 ms-1" style={{ fontSize: '11px', fontWeight: 400 }}>
              /hr
            </span>
          </p>
        )}

        {/* Time + action */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1 text-slate-400">
            <Clock size={10} />
            <span style={{ fontSize: '10px' }}>{postedAt}</span>
          </div>
          <div className={`flex items-center gap-0.5 rounded-xl px-2 py-1 ${svc.bg}`}>
            <span className={svc.icon} style={{ fontSize: '11px', fontWeight: 700 }}>
              {status === 'completed' ? 'View' : status === 'active' ? 'Track' : 'Bids'}
            </span>
            <ChevronRight size={10} className={svc.icon} />
          </div>
        </div>
      </div>
    </div>
  );
}
