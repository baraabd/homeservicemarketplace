import { useState } from "react";
import { X, Bell, Wrench, MapPin, CheckCircle2, MessageCircle, CreditCard, BellOff, ChevronRight } from "lucide-react";
import { useSwipe } from "../../hooks/useSwipe";

// ─── Types ────────────────────────────────────────────────────────────────────
export type NotifType = "bid" | "tracking" | "confirmed" | "message" | "payment" | "promo";

export interface AppNotification {
  id:     string;
  type:   NotifType;
  title:  string;
  body:   string;
  time:   string;
  read:   boolean;
  /** Optional: links notification to a specific lead or booking ID */
  jobId?: string;
}

interface NotifConfig { bg: string; icon: React.ReactNode }

const NOTIF_CONFIG: Record<NotifType, NotifConfig> = {
  bid:       { bg: "bg-amber-500",  icon: <Wrench        size={14} className="text-white" /> },
  tracking:  { bg: "bg-blue-500",   icon: <MapPin        size={14} className="text-white" /> },
  confirmed: { bg: "bg-green-500",  icon: <CheckCircle2  size={14} className="text-white" /> },
  message:   { bg: "bg-purple-500", icon: <MessageCircle size={14} className="text-white" /> },
  payment:   { bg: "bg-emerald-500",icon: <CreditCard    size={14} className="text-white" /> },
  promo:     { bg: "bg-orange-500", icon: <Bell          size={14} className="text-white" /> },
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface NotificationDrawerProps {
  isOpen:          boolean;
  notifications:   AppNotification[];
  onClose:         () => void;
  onMarkAllRead:   () => void;
  onMarkRead:      (id: string) => void;
  onTapNotif?:     (n: AppNotification) => void;
  onOpenSettings?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
export function NotificationDrawer({
  isOpen,
  notifications,
  onClose,
  onMarkAllRead,
  onMarkRead,
  onTapNotif,
  onOpenSettings,
}: NotificationDrawerProps) {
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Swipe up on the panel to dismiss
  const { onTouchStart, onTouchMove, onTouchEnd, dragY } = useSwipe({
    onSwipeUp: onClose,
    threshold: 60,
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const dismiss = (id: string) => {
    setRemovingId(id);
    setTimeout(() => {
      onMarkRead(id);
      setRemovingId(null);
    }, 300);
  };

  return (
    /* Full overlay */
    <div
      className={`absolute inset-0 z-50 transition-all duration-300 ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      {/* ── Backdrop ── */}
      <div
        className={`absolute inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* ── Drawer panel slides from top ── */}
      <div
        className={`absolute top-0 start-0 end-0 bg-white rounded-b-3xl shadow-2xl flex flex-col transition-transform duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] overflow-hidden ${
          isOpen ? "translate-y-0" : "-translate-y-full"
        }`}
        style={{
          maxHeight: "78vh",
          transform: isOpen
            ? `translateY(${Math.min(dragY * 0.25, 0)}px)`
            : "translateY(-100%)",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Notch / handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Bell size={20} className="text-slate-800" />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1.5 -end-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center"
                  style={{ fontSize: "8px", fontWeight: 800 }}
                >
                  {unreadCount}
                </span>
              )}
            </div>
            <span className="text-slate-900" style={{ fontSize: "16px", fontWeight: 800 }}>
              Notifications
            </span>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-100 active:bg-amber-100 transition-all"
                style={{ fontSize: "11px", fontWeight: 700, color: "#D97706" }}
              >
                <CheckCircle2 size={11} />
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center active:scale-90 transition-all"
            >
              <X size={15} className="text-slate-600" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                <BellOff size={28} className="text-slate-300" />
              </div>
              <p className="text-slate-400" style={{ fontSize: "14px" }}>No notifications yet</p>
            </div>
          ) : (
            <>
              {/* Unread section */}
              {notifications.some((n) => !n.read) && (
                <div
                  className="px-4 pt-3 pb-1"
                  style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}
                >
                  New · {unreadCount}
                </div>
              )}
              {notifications.map((n) => {
                const cfg = NOTIF_CONFIG[n.type];
                const removing = removingId === n.id;
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3.5 border-b border-slate-50 active:bg-slate-50 cursor-pointer transition-all duration-300 ${
                      !n.read ? "bg-amber-50/40" : ""
                    } ${removing ? "opacity-0 scale-95" : "opacity-100 scale-100"}`}
                    onClick={() => {
                      dismiss(n.id);
                      onTapNotif?.(n);
                    }}
                  >
                    {/* Icon */}
                    <div className="relative flex-shrink-0 mt-0.5">
                      <div className={`w-9 h-9 rounded-2xl ${cfg.bg} flex items-center justify-center shadow-sm`}>
                        {cfg.icon}
                      </div>
                      {!n.read && (
                        <div className="absolute -top-0.5 -end-0.5 w-3 h-3 rounded-full bg-amber-500 border-2 border-white" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-slate-900"
                        style={{ fontSize: "13px", fontWeight: n.read ? 500 : 700, lineHeight: "1.3" }}
                      >
                        {n.title}
                      </p>
                      <p
                        className="text-slate-500 mt-0.5"
                        style={{ fontSize: "12px", lineHeight: "1.4" }}
                      >
                        {n.body}
                      </p>
                      <p className="text-slate-400 mt-1" style={{ fontSize: "10px" }}>
                        {n.time}
                      </p>
                    </div>

                    {/* Chevron */}
                    <ChevronRight size={14} className="text-slate-300 flex-shrink-0 mt-1" />
                  </div>
                );
              })}

              {/* Read section label */}
              {notifications.some((n) => n.read) && notifications.some((n) => !n.read) && (
                <div
                  className="px-4 pt-3 pb-1"
                  style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}
                >
                  Earlier
                </div>
              )}
            </>
          )}
          <div className="h-4" />
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50">
          <p className="text-slate-400" style={{ fontSize: "11px" }}>
            Swipe up or tap outside to close
          </p>
          <button
            onClick={() => { onClose(); onOpenSettings?.(); }}
            className="text-amber-600 active:opacity-70"
            style={{ fontSize: "11px", fontWeight: 600 }}
          >
            Settings
          </button>
        </div>
      </div>
    </div>
  );
}