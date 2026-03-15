import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
export type SnackbarVariant = "offline" | "success" | "error" | "info";

export interface SnackbarProps {
  visible:    boolean;
  variant?:   SnackbarVariant;
  message:    string;
  action?:    { label: string; onClick: () => void };
  onDismiss?: () => void;
  duration?:  number; // ms — 0 = persist
}

const CONFIG: Record<SnackbarVariant, { bg: string; iconBg: string; icon: React.ReactNode }> = {
  offline: {
    bg:     "bg-slate-900",
    iconBg: "bg-amber-500/20",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <circle cx="12" cy="20" r="1" fill="#F59E0B" stroke="none" />
      </svg>
    ),
  },
  success: {
    bg:     "bg-green-600",
    iconBg: "bg-white/20",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  error: {
    bg:     "bg-red-600",
    iconBg: "bg-white/20",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  info: {
    bg:     "bg-blue-600",
    iconBg: "bg-white/20",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <circle cx="12" cy="8" r="0.5" fill="white" stroke="none" />
      </svg>
    ),
  },
};

export function Snackbar({
  visible,
  variant  = "offline",
  message,
  action,
  onDismiss,
  duration = 4000,
}: SnackbarProps) {
  const [rendered, setRendered] = useState(false);
  const [show,     setShow]     = useState(false);

  // Mount → animate in
  useEffect(() => {
    if (visible) {
      setRendered(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)));
      if (duration > 0) {
        const t = setTimeout(() => {
          setShow(false);
          setTimeout(() => { setRendered(false); onDismiss?.(); }, 320);
        }, duration);
        return () => clearTimeout(t);
      }
    } else {
      setShow(false);
      const t = setTimeout(() => setRendered(false), 320);
      return () => clearTimeout(t);
    }
  }, [visible, duration]);

  if (!rendered) return null;

  const cfg = CONFIG[variant];

  const handleDismiss = () => {
    setShow(false);
    setTimeout(() => { setRendered(false); onDismiss?.(); }, 320);
  };

  return (
    <div
      className="fixed bottom-24 inset-x-4 z-[200] flex justify-center pointer-events-none"
    >
      <div
        className={[
          "pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl w-full max-w-sm",
          cfg.bg,
          "transition-all duration-300",
          show ? "translate-y-0 opacity-100 scale-100" : "translate-y-4 opacity-0 scale-95",
        ].join(" ")}
      >
        {/* Icon */}
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.iconBg}`}>
          {cfg.icon}
        </div>

        {/* Message */}
        <p className="flex-1 text-white" style={{ fontSize: "13px", fontWeight: 500, lineHeight: "1.4" }}>
          {message}
        </p>

        {/* Action */}
        {action && (
          <button
            onClick={action.onClick}
            className="text-amber-400 flex-shrink-0 hover:text-amber-300 active:scale-95 transition-all"
            style={{ fontSize: "12px", fontWeight: 700 }}
          >
            {action.label}
          </button>
        )}

        {/* Dismiss */}
        {onDismiss && (
          <button
            onClick={handleDismiss}
            className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 hover:bg-white/20 active:scale-90 transition-all"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
