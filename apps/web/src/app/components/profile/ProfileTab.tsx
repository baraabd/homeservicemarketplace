import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  User,
  MapPin,
  Bell,
  MessageCircle,
  Settings,
  ChevronRight,
  ChevronLeft,
  Star,
  WifiOff,
  CheckCircle2,
  BellOff,
  Wrench,
  CreditCard,
} from 'lucide-react';
import { EditProfilePage } from './EditProfilePage';
import { SavedAddressesPage } from './SavedAddressesPage';
import { HelpSupportPage } from './HelpSupportPage';
import { SettingsPage } from './SettingsPage';
import { useLang } from '../../i18n/LanguageContext';
import { AppNotification } from '../notifications/NotificationDrawer';

// ─── Notification types ───────────────────────────────────────────────────────
type NotifTypeKey = 'bid' | 'tracking' | 'confirmed' | 'message' | 'payment' | 'promo';

const NOTIF_BG: Record<NotifTypeKey, string> = {
  bid: 'bg-amber-500',
  tracking: 'bg-blue-500',
  confirmed: 'bg-green-500',
  message: 'bg-purple-500',
  payment: 'bg-emerald-500',
  promo: 'bg-orange-500',
};

function NotifIcon({ type }: { type: string }) {
  switch (type) {
    case 'bid':
      return <Wrench size={14} className="text-white" />;
    case 'tracking':
      return <MapPin size={14} className="text-white" />;
    case 'confirmed':
      return <CheckCircle2 size={14} className="text-white" />;
    case 'message':
      return <MessageCircle size={14} className="text-white" />;
    case 'payment':
      return <CreditCard size={14} className="text-white" />;
    default:
      return <Bell size={14} className="text-white" />;
  }
}

// ─── Notifications full-page ──────────────────────────────────────────────────
function NotificationsPage({
  onBack,
  notifications,
  onMarkAllRead,
  onMarkRead,
}: {
  onBack: () => void;
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
}) {
  const { lang, dir } = useLang();
  const unread = notifications.filter((n) => !n.read).length;

  const L = {
    title: lang === 'ar' ? 'الإشعارات' : 'Notifications',
    markAll: lang === 'ar' ? 'تحديد الكل' : 'Mark all read',
    new: lang === 'ar' ? 'جديد' : 'New',
    earlier: lang === 'ar' ? 'سابقاً' : 'Earlier',
    empty: lang === 'ar' ? 'لا توجد إشعارات' : 'No notifications yet',
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900"
      initial={{ x: dir === 'rtl' ? '-100%' : '100%' }}
      animate={{ x: 0 }}
      exit={{ x: dir === 'rtl' ? '-100%' : '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
    >
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all"
          >
            {dir === 'rtl' ? (
              <ChevronRight size={20} className="text-slate-700 dark:text-slate-300" />
            ) : (
              <ChevronLeft size={20} className="text-slate-700 dark:text-slate-300" />
            )}
          </button>

          <div className="flex items-center gap-2 flex-1">
            <Bell size={18} className="text-slate-700 dark:text-slate-300" />
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '16px', fontWeight: 800 }}
            >
              {L.title}
            </p>
            {unread > 0 && (
              <span
                className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                style={{ fontSize: '10px', fontWeight: 800 }}
              >
                {unread}
              </span>
            )}
          </div>

          {unread > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-800 active:bg-amber-100 transition-all"
              style={{ fontSize: '11px', fontWeight: 700, color: '#D97706' }}
            >
              <CheckCircle2 size={11} />
              {L.markAll}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <BellOff size={28} className="text-slate-300" />
            </div>
            <p className="text-slate-400" style={{ fontSize: '14px' }}>
              {L.empty}
            </p>
          </div>
        ) : (
          <>
            {notifications.some((n) => !n.read) && (
              <p
                className="px-5 pt-3 pb-1 text-slate-400"
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {L.new} · {unread}
              </p>
            )}
            {notifications.map((n) => (
              <motion.button
                key={n.id}
                whileTap={{ backgroundColor: 'rgba(0,0,0,0.03)' }}
                onClick={() => onMarkRead(n.id)}
                className={`w-full flex items-start gap-3 px-4 py-3.5 border-b border-slate-50 dark:border-slate-700/50 cursor-pointer transition-all text-start ${
                  !n.read ? 'bg-amber-50/40 dark:bg-amber-900/10' : 'bg-white dark:bg-slate-800/50'
                }`}
              >
                <div className="relative flex-shrink-0 mt-0.5">
                  <div
                    className={`w-9 h-9 rounded-2xl ${NOTIF_BG[n.type as NotifTypeKey] ?? 'bg-slate-500'} flex items-center justify-center shadow-sm`}
                  >
                    <NotifIcon type={n.type} />
                  </div>
                  {!n.read && (
                    <div className="absolute -top-0.5 -end-0.5 w-3 h-3 rounded-full bg-amber-500 border-2 border-white dark:border-slate-900" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-slate-900 dark:text-white"
                    style={{ fontSize: '13px', fontWeight: n.read ? 500 : 700, lineHeight: '1.3' }}
                  >
                    {n.title}
                  </p>
                  <p
                    className="text-slate-500 dark:text-slate-400 mt-0.5"
                    style={{ fontSize: '12px', lineHeight: '1.4' }}
                  >
                    {n.body}
                  </p>
                  <p className="text-slate-400 mt-1" style={{ fontSize: '10px' }}>
                    {n.time}
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className="text-slate-300 rtl:rotate-180 mt-1 flex-shrink-0"
                />
              </motion.button>
            ))}
            {notifications.some((n) => n.read) && (
              <p
                className="px-5 pt-3 pb-1 text-slate-400"
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {L.earlier}
              </p>
            )}
          </>
        )}
        <div className="h-6" />
      </div>
    </motion.div>
  );
}

// ─── Menu item row ────────────────────────────────────────────────────────────
function MenuItem({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick?: () => void;
}) {
  const { dir } = useLang();
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.98, backgroundColor: 'rgba(0,0,0,0.025)' }}
      className="w-full flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all text-start border-t border-slate-50 dark:border-slate-700 first:border-0"
    >
      <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 flex-shrink-0">
        {icon}
      </div>
      <span
        className="flex-1 text-slate-700 dark:text-slate-200"
        style={{ fontSize: '14px', fontWeight: 500 }}
      >
        {label}
      </span>
      {badge !== undefined && badge > 0 && (
        <span
          className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center me-1"
          style={{ fontSize: '10px', fontWeight: 700 }}
        >
          {badge}
        </span>
      )}
      {dir === 'rtl' ? (
        <ChevronLeft size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" />
      ) : (
        <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" />
      )}
    </motion.button>
  );
}

// ─── Profile list ─────────────────────────────────────────────────────────────
function ProfileList({
  isOffline,
  onToggleOffline,
  unreadCount,
  onNavigate,
}: {
  isOffline: boolean;
  onToggleOffline: () => void;
  unreadCount: number;
  onNavigate: (v: ProfileView) => void;
}) {
  const { lang, t } = useLang();

  return (
    <div className="px-4 pt-4 pb-6">
      {/* Hero card */}
      <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-3xl p-5 mb-4 relative overflow-hidden">
        <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
        <div className="flex items-center gap-4 relative">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => onNavigate('editProfile')}
            className="w-16 h-16 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center flex-shrink-0"
          >
            <span className="text-white" style={{ fontSize: '20px', fontWeight: 800 }}>
              AK
            </span>
          </motion.button>
          <div>
            <p className="text-white" style={{ fontSize: '18px', fontWeight: 800 }}>
              {lang === 'ar' ? 'أحمد الخالد' : 'Ahmed Al-Khalid'}
            </p>
            <p className="text-white/70" style={{ fontSize: '13px' }}>
              ahmed@fixnow.app
            </p>
            <div className="flex items-center gap-1 mt-1">
              <Star size={12} className="text-white fill-white" />
              <span className="text-white" style={{ fontSize: '12px', fontWeight: 600 }}>
                4.9 · {lang === 'ar' ? '12 طلب' : '12 jobs posted'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { val: '12', labelKey: 'totalJobs' },
          { val: '3', labelKey: 'active' },
          { val: '$420', labelKey: 'spent' },
        ].map((s) => (
          <div
            key={s.labelKey}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm py-3 flex flex-col items-center"
          >
            <span
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '16px', fontWeight: 800 }}
            >
              {s.val}
            </span>
            <span className="text-slate-400" style={{ fontSize: '10px' }}>
              {t(s.labelKey)}
            </span>
          </div>
        ))}
      </div>

      {/* Menu */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden mb-4">
        <MenuItem
          icon={<User size={16} />}
          label={t('editProfile')}
          onClick={() => onNavigate('editProfile')}
        />
        <MenuItem
          icon={<MapPin size={16} />}
          label={t('savedAddresses')}
          onClick={() => onNavigate('savedAddresses')}
        />
        <MenuItem
          icon={<Bell size={16} />}
          label={t('notifications')}
          badge={unreadCount}
          onClick={() => onNavigate('notifications')}
        />
        <MenuItem
          icon={<MessageCircle size={16} />}
          label={t('helpSupport')}
          onClick={() => onNavigate('helpSupport')}
        />
        <MenuItem
          icon={<Settings size={16} />}
          label={t('settings')}
          onClick={() => onNavigate('settings')}
        />
      </div>

      {/* Offline toggle */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${isOffline ? 'bg-amber-100' : 'bg-green-100'}`}
            >
              {isOffline ? (
                <WifiOff size={16} className="text-amber-600" />
              ) : (
                <CheckCircle2 size={16} className="text-green-600" />
              )}
            </div>
            <div>
              <p
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '14px', fontWeight: 700 }}
              >
                {isOffline ? t('offlineMode') : t('online')}
              </p>
              <p className="text-slate-400" style={{ fontSize: '11px' }}>
                {isOffline ? t('syncDesc') : t('connectedDesc')}
              </p>
            </div>
          </div>
          <button
            onClick={onToggleOffline}
            className={`w-12 h-7 rounded-full border-2 transition-all duration-300 flex items-center px-0.5 ${
              isOffline ? 'bg-amber-500 border-amber-500' : 'bg-green-500 border-green-500'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${isOffline ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── View types ───────────────────────────────────────────────────────────────
export type ProfileView =
  | 'editProfile'
  | 'savedAddresses'
  | 'notifications'
  | 'helpSupport'
  | 'settings'
  | null;

// ─── Props ────────────────────────────────────────────────────────────────────
interface ProfileTabProps {
  isOffline: boolean;
  onToggleOffline: () => void;
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  unreadCount: number;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function ProfileTab({
  isOffline,
  onToggleOffline,
  notifications,
  onMarkAllRead,
  onMarkRead,
  unreadCount,
}: ProfileTabProps) {
  const [view, setView] = useState<ProfileView>(null);

  return (
    <div className="relative h-full overflow-hidden">
      {/* Profile list — fades out when a sub-page is open */}
      <motion.div
        className="absolute inset-0 overflow-y-auto"
        animate={{ opacity: view ? 0 : 1, pointerEvents: view ? 'none' : 'auto' }}
        transition={{ duration: 0.18 }}
        style={{ scrollbarWidth: 'none' }}
      >
        <ProfileList
          isOffline={isOffline}
          onToggleOffline={onToggleOffline}
          unreadCount={unreadCount}
          onNavigate={setView}
        />
      </motion.div>

      {/* Sub-pages slide over the list */}
      <AnimatePresence>
        {view === 'editProfile' && <EditProfilePage key="edit" onBack={() => setView(null)} />}
        {view === 'savedAddresses' && (
          <SavedAddressesPage key="addresses" onBack={() => setView(null)} />
        )}
        {view === 'notifications' && (
          <NotificationsPage
            key="notifs"
            onBack={() => setView(null)}
            notifications={notifications}
            onMarkAllRead={onMarkAllRead}
            onMarkRead={onMarkRead}
          />
        )}
        {view === 'helpSupport' && <HelpSupportPage key="help" onBack={() => setView(null)} />}
        {view === 'settings' && <SettingsPage key="settings" onBack={() => setView(null)} />}
      </AnimatePresence>
    </div>
  );
}
