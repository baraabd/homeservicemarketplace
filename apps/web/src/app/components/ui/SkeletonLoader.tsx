// ─── Base pulse block ──────────────────────────────────────────────────────────
function Pulse({ className, style }: { className: string; style?: Record<string, string> }) {
  return (
    <div
      className={`rounded-xl animate-pulse bg-slate-200 dark:bg-slate-700 ${className}`}
      style={style}
    />
  );
}

// ─── Per-tab skeletons ─────────────────────────────────────────────────────────
function HomeSkeleton() {
  return (
    <div className="px-4 pt-4 flex flex-col gap-4">
      {/* Search hero */}
      <Pulse className="h-36 rounded-3xl" />
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <Pulse className="h-14" />
        <Pulse className="h-14" />
        <Pulse className="h-14" />
      </div>
      {/* Section header */}
      <div className="flex justify-between items-center">
        <Pulse className="h-4 w-24" />
        <Pulse className="h-4 w-12" />
      </div>
      {/* Services grid */}
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Pulse key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      {/* Leads section header */}
      <div className="flex justify-between items-center mt-1">
        <Pulse className="h-4 w-28" />
        <Pulse className="h-4 w-10" />
      </div>
      {/* Lead cards row */}
      <div className="flex gap-3 overflow-hidden">
        <Pulse className="h-44 rounded-3xl flex-shrink-0" style={{ width: '168px' }} />
        <Pulse className="h-44 rounded-3xl flex-shrink-0" style={{ width: '168px' }} />
      </div>
    </div>
  );
}

function BookingsSkeleton() {
  return (
    <div className="px-4 pt-4 flex flex-col gap-3">
      <Pulse className="h-6 w-32 mb-1" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 p-4 flex flex-col gap-2.5"
        >
          <div className="flex justify-between">
            <Pulse className="h-4 w-28" />
            <Pulse className="h-6 w-20 rounded-full" />
          </div>
          <Pulse className="h-3 w-24" />
          <div className="flex justify-between">
            <Pulse className="h-3 w-32" />
            <Pulse className="h-5 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div className="px-4 pt-4 flex flex-col gap-3">
      <Pulse className="h-6 w-28 mb-1" />
      <Pulse className="h-11 rounded-2xl mb-1" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <Pulse className="w-11 h-11 rounded-2xl flex-shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <Pulse className="h-4 w-28" />
            <Pulse className="h-3 w-40" />
          </div>
          <Pulse className="h-3 w-8 flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="px-4 pt-4 flex flex-col gap-3">
      {/* Header card */}
      <Pulse className="h-28 rounded-3xl" />
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <Pulse className="h-16 rounded-2xl" />
        <Pulse className="h-16 rounded-2xl" />
        <Pulse className="h-16 rounded-2xl" />
      </div>
      {/* Menu list */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-slate-50 dark:border-slate-700' : ''}`}
          >
            <Pulse className="w-8 h-8 rounded-xl flex-shrink-0" />
            <Pulse className="flex-1 h-4" />
            <Pulse className="w-4 h-4 rounded flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Public component ──────────────────────────────────────────────────────────
export function TabSkeleton({ tab }: { tab: string }) {
  switch (tab) {
    case 'home':
      return <HomeSkeleton />;
    case 'bookings':
      return <BookingsSkeleton />;
    case 'messages':
      return <MessagesSkeleton />;
    case 'profile':
      return <ProfileSkeleton />;
    default:
      return <HomeSkeleton />;
  }
}
