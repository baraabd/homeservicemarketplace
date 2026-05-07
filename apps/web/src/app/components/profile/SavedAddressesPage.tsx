import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Home,
  Briefcase,
  MapPin,
  Edit3,
  Trash2,
  CheckCircle2,
  X,
  Navigation,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AddressSummary, AddressType } from '@homeservicemarketplace/contracts';
import { useLang } from '../../i18n/LanguageContext';
import { Button } from '../ds/Button';
import { LocationMap } from '../ds/LocationMap';
import {
  useAddresses,
  useCreateAddress,
  useDeleteAddress,
  useSetDefaultAddress,
  useUpdateAddress,
} from '../../hooks/seeker/useAddresses';
import { getCurrentLocationAddress } from '../../../lib/reverse-geocode';

// Visual map keyed on the persisted AddressType (HOME / WORK / CUSTOM).
// Same icon + colour palette as the original mock-state version — just
// wired to the enum the API returns instead of a local 'home' | 'work' |
// 'custom' string. Unknown types collapse to the generic 'CUSTOM' look so
// admin-added types in a future sprint never break the grid.
const TYPE_ICON: Record<AddressType, React.ReactNode> = {
  HOME: <Home size={16} />,
  WORK: <Briefcase size={16} />,
  CUSTOM: <MapPin size={16} />,
};

const TYPE_COLOR: Record<AddressType, { bg: string; icon: string }> = {
  HOME: { bg: 'bg-blue-100 dark:bg-blue-900/40', icon: 'text-blue-600 dark:text-blue-400' },
  WORK: {
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  CUSTOM: {
    bg: 'bg-green-100 dark:bg-green-900/40',
    icon: 'text-green-600 dark:text-green-400',
  },
};

function typeStyle(type: AddressType) {
  return TYPE_COLOR[type] ?? TYPE_COLOR.CUSTOM;
}

function typeIcon(type: AddressType) {
  return TYPE_ICON[type] ?? TYPE_ICON.CUSTOM;
}

// Render the address as a single human-friendly line. The contract has
// discrete line1/city/country fields; the UI was originally a single
// "full address" string, so we recompose for display.
function formatAddress(a: AddressSummary): string {
  return [a.line1, a.city, a.country].filter((part) => part && part.trim().length > 0).join(', ');
}

// The original UI exposed a single "Full address" input; the API requires
// discrete line1/city/country. We split the user's input on commas so the
// trailing chunk goes to country and the next-to-last to city — matches
// how the rendered "Building 4, Al Olaya District, Riyadh" examples were
// already structured, and falls back gracefully when the user types only
// one segment.
function splitFullAddress(full: string): { line1: string; city: string; country: string } {
  const parts = full
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length >= 3) {
    const country = parts.pop()!;
    const city = parts.pop()!;
    const line1 = parts.join(', ');
    return { line1, city, country };
  }
  if (parts.length === 2) {
    return { line1: parts[0], city: parts[1], country: parts[1] };
  }
  const single = parts[0] ?? full.trim();
  return { line1: single, city: single, country: single.length >= 2 ? single : `${single}.` };
}

interface SavedAddressesPageProps {
  onBack: () => void;
}

export function SavedAddressesPage({ onBack }: SavedAddressesPageProps) {
  const { lang, dir } = useLang();

  const addressesQuery = useAddresses();
  const createMut = useCreateAddress();
  const updateMut = useUpdateAddress();
  const deleteMut = useDeleteAddress();
  const setDefaultMut = useSetDefaultAddress();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [delConfirm, setDelConfirm] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newFull, setNewFull] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Phase 2 Bug 3 — "Use my current location" now does real
  // reverse geocoding. The button shows a spinner while
  // navigator.geolocation + the Google Geocoding API resolve.
  const [locating, setLocating] = useState(false);
  // Phase 4 Feature 4 — captured coordinates so the map preview can
  // pin them and the user can drag to refine. Null until the user
  // clicks "Use my current location" successfully.
  const [pinCoords, setPinCoords] = useState<{ lat: number; lng: number } | null>(null);

  const addresses = addressesQuery.data ?? [];
  const isInitialLoading = addressesQuery.isLoading && !addressesQuery.data;
  const isListError = addressesQuery.isError && !addressesQuery.data;

  const L = useMemo(
    () => ({
      title: lang === 'ar' ? 'عناويني المحفوظة' : 'Saved Addresses',
      addNew: lang === 'ar' ? 'إضافة عنوان' : 'Add Address',
      empty: lang === 'ar' ? 'لا توجد عناوين محفوظة' : 'No saved addresses yet',
      emptySub: lang === 'ar' ? 'أضف عنواناً ليظهر هنا' : 'Add an address to see it here',
      defaultBadge: lang === 'ar' ? 'افتراضي' : 'Default',
      setDefault: lang === 'ar' ? 'جعله افتراضياً' : 'Set as default',
      deleteQ: lang === 'ar' ? 'حذف هذا العنوان؟' : 'Delete this address?',
      confirm: lang === 'ar' ? 'نعم، احذف' : 'Yes, delete',
      cancel: lang === 'ar' ? 'إلغاء' : 'Cancel',
      labelPlh: lang === 'ar' ? 'اسم العنوان (مثل: منزل)' : 'Label (e.g. Home)',
      addressPlh: lang === 'ar' ? 'الوصف الكامل للعنوان' : 'Full address',
      save: lang === 'ar' ? 'حفظ العنوان' : 'Save Address',
      edit: lang === 'ar' ? 'تعديل' : 'Edit',
      newAddress: lang === 'ar' ? 'عنوان جديد' : 'New Address',
      getLocation: lang === 'ar' ? 'استخدم موقعي الحالي' : 'Use my current location',
      locating: lang === 'ar' ? 'جاري تحديد موقعك…' : 'Detecting your location…',
      locationDenied:
        lang === 'ar'
          ? 'تم رفض إذن الموقع. اكتب العنوان يدوياً.'
          : 'Location permission denied. Please type the address manually.',
      locationFallback:
        lang === 'ar'
          ? 'تعذّر العثور على عنوان مطابق. تم إدخال الإحداثيات — يرجى التحقق منها.'
          : "Couldn't resolve a street address. Coordinates were filled in — please verify.",
      locationUnavailable:
        lang === 'ar'
          ? 'الموقع غير متاح حالياً. اكتب العنوان يدوياً.'
          : 'Location is unavailable right now. Please type the address manually.',
      loading: lang === 'ar' ? 'جاري التحميل...' : 'Loading addresses...',
      loadFailed:
        lang === 'ar'
          ? 'تعذر تحميل العناوين. حاول مرة أخرى.'
          : "We couldn't load your addresses. Please try again.",
      saveFailed:
        lang === 'ar'
          ? 'تعذر حفظ العنوان. حاول مرة أخرى.'
          : "We couldn't save this address. Please try again.",
      deleteFailed:
        lang === 'ar'
          ? 'تعذر حذف العنوان. حاول مرة أخرى.'
          : "We couldn't delete this address. Please try again.",
      defaultBlocked:
        lang === 'ar'
          ? 'عيّن عنواناً آخر افتراضياً قبل حذف هذا العنوان.'
          : 'Set another address as default before deleting this one.',
      defaultFailed:
        lang === 'ar'
          ? 'تعذر تعيين العنوان الافتراضي. حاول مرة أخرى.'
          : "We couldn't set this address as default. Please try again.",
      retry: lang === 'ar' ? 'إعادة المحاولة' : 'Retry',
    }),
    [lang],
  );

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setNewLabel('');
    setNewFull('');
    setPinCoords(null);
    setFormError(null);
  };

  const handleSave = () => {
    if (!newLabel.trim() || !newFull.trim()) return;
    setFormError(null);
    const split = splitFullAddress(newFull);
    if (editId) {
      updateMut.mutate(
        {
          addressId: editId,
          input: { label: newLabel.trim(), ...split },
        },
        {
          onSuccess: () => closeForm(),
          onError: () => setFormError(L.saveFailed),
        },
      );
    } else {
      createMut.mutate(
        { label: newLabel.trim(), type: 'CUSTOM', ...split },
        {
          onSuccess: () => closeForm(),
          onError: () => setFormError(L.saveFailed),
        },
      );
    }
  };

  const handleEdit = (a: AddressSummary) => {
    setEditId(a.id);
    setNewLabel(a.label);
    setNewFull(formatAddress(a));
    setFormError(null);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    setActionError(null);
    deleteMut.mutate(id, {
      onSuccess: () => setDelConfirm(null),
      onError: (err) => {
        setDelConfirm(null);
        // 409 from the server = "can't delete the default while other
        // addresses exist". Surface that as a distinct, actionable
        // message; everything else collapses to a safe generic.
        const status =
          (err as { response?: { status?: number } } | undefined)?.response?.status ?? null;
        setActionError(status === 409 ? L.defaultBlocked : L.deleteFailed);
      },
    });
  };

  const handleSetDefault = (id: string) => {
    setActionError(null);
    setDefaultMut.mutate(id, {
      onError: () => setActionError(L.defaultFailed),
    });
  };

  const saving = createMut.isPending || updateMut.isPending;

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
          <p
            className="flex-1 text-slate-900 dark:text-white"
            style={{ fontSize: '16px', fontWeight: 800 }}
          >
            {L.title}
          </p>
          <button
            onClick={() => {
              setEditId(null);
              setNewLabel('');
              setNewFull('');
              setFormError(null);
              setShowForm(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 text-white active:scale-95 transition-all shadow-sm shadow-amber-200"
          >
            <Plus size={14} />
            <span style={{ fontSize: '12px', fontWeight: 700 }}>{L.addNew}</span>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: 'none' }}>
        {actionError && (
          <div
            className="mb-3 px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-300"
            style={{ fontSize: '13px', fontWeight: 600 }}
            role="alert"
          >
            {actionError}
          </div>
        )}

        {isInitialLoading ? (
          /* Loading state — preserves the page chrome, only swaps the list */
          <div
            className="flex flex-col items-center justify-center py-20 gap-3"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={28} className="text-slate-400 animate-spin" />
            <p className="text-slate-500" style={{ fontSize: '13px' }}>
              {L.loading}
            </p>
          </div>
        ) : isListError ? (
          /* Error state — safe generic copy, no raw backend message */
          <div className="flex flex-col items-center justify-center py-20 gap-4" role="alert">
            <div className="w-20 h-20 rounded-3xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
              <MapPin size={32} className="text-red-400" />
            </div>
            <p
              className="text-slate-700 dark:text-slate-200 text-center"
              style={{ fontSize: '14px', fontWeight: 600 }}
            >
              {L.loadFailed}
            </p>
            <button
              onClick={() => addressesQuery.refetch()}
              className="px-5 py-2.5 rounded-2xl bg-amber-500 text-white active:scale-95 transition-all shadow-sm shadow-amber-200"
              style={{ fontSize: '13px', fontWeight: 700 }}
            >
              {L.retry}
            </button>
          </div>
        ) : addresses.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <MapPin size={32} className="text-slate-300" />
            </div>
            <div className="text-center">
              <p
                className="text-slate-700 dark:text-slate-200"
                style={{ fontSize: '16px', fontWeight: 700 }}
              >
                {L.empty}
              </p>
              <p className="text-slate-400 mt-1" style={{ fontSize: '13px' }}>
                {L.emptySub}
              </p>
            </div>
            <button
              onClick={() => {
                setEditId(null);
                setNewLabel('');
                setNewFull('');
                setFormError(null);
                setShowForm(true);
              }}
              className="flex items-center gap-2 px-5 py-3 bg-amber-500 text-white rounded-2xl active:scale-95 transition-all shadow-md shadow-amber-200"
            >
              <Plus size={16} />
              <span style={{ fontSize: '14px', fontWeight: 700 }}>{L.addNew}</span>
            </button>
          </div>
        ) : (
          <AnimatePresence>
            {addresses.map((a) => {
              const tc = typeStyle(a.type);
              return (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -8 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm mb-3 overflow-hidden"
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${tc.bg}`}
                      >
                        <span className={tc.icon}>{typeIcon(a.type)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p
                            className="text-slate-900 dark:text-white"
                            style={{ fontSize: '14px', fontWeight: 700 }}
                          >
                            {a.label}
                          </p>
                          {a.isDefault && (
                            <span
                              className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                              style={{ fontSize: '10px', fontWeight: 700 }}
                            >
                              {L.defaultBadge}
                            </span>
                          )}
                        </div>
                        <p
                          className="text-slate-500 dark:text-slate-400"
                          style={{ fontSize: '12px', lineHeight: '1.5' }}
                        >
                          {formatAddress(a)}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3 ps-13">
                      {!a.isDefault && (
                        <button
                          onClick={() => handleSetDefault(a.id)}
                          disabled={setDefaultMut.isPending}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 active:bg-slate-200 transition-all disabled:opacity-60"
                          style={{ fontSize: '11px', fontWeight: 600 }}
                        >
                          <CheckCircle2 size={12} />
                          {L.setDefault}
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(a)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 active:bg-blue-100 transition-all"
                        style={{ fontSize: '11px', fontWeight: 600 }}
                      >
                        <Edit3 size={12} />
                        {L.edit}
                      </button>
                      <button
                        onClick={() => setDelConfirm(a.id)}
                        className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center active:scale-90 transition-all"
                      >
                        <Trash2 size={13} className="text-red-500" />
                      </button>
                    </div>
                  </div>

                  {/* Delete confirmation inline */}
                  <AnimatePresence>
                    {delConfirm === a.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-900/20 px-4 py-3 flex items-center justify-between"
                      >
                        <p
                          className="text-red-600 dark:text-red-400"
                          style={{ fontSize: '12px', fontWeight: 600 }}
                        >
                          {L.deleteQ}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setDelConfirm(null)}
                            disabled={deleteMut.isPending}
                            className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 active:bg-slate-100 transition-all disabled:opacity-60"
                            style={{ fontSize: '12px', fontWeight: 600 }}
                          >
                            {L.cancel}
                          </button>
                          <button
                            onClick={() => handleDelete(a.id)}
                            disabled={deleteMut.isPending}
                            className="px-3 py-1.5 rounded-xl bg-red-500 text-white active:scale-95 transition-all disabled:opacity-60"
                            style={{ fontSize: '12px', fontWeight: 700 }}
                          >
                            {L.confirm}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
        <div className="h-4" />
      </div>

      {/* Add / Edit bottom sheet */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => closeForm()}
            />
            <motion.div
              className="absolute bottom-0 start-0 end-0 bg-white dark:bg-slate-800 rounded-t-3xl px-5 pt-4 pb-6 z-20"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600 mx-auto mb-4" />
              <div className="flex items-center justify-between mb-4">
                <p
                  className="text-slate-900 dark:text-white"
                  style={{ fontSize: '16px', fontWeight: 800 }}
                >
                  {editId ? L.edit : L.newAddress}
                </p>
                <button
                  onClick={() => closeForm()}
                  className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90"
                >
                  <X size={15} className="text-slate-500" />
                </button>
              </div>

              <div className="flex flex-col gap-3 mb-4">
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={L.labelPlh}
                  className="w-full bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-3 text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none focus:ring-2 focus:ring-amber-300 transition-all"
                  style={{ fontSize: '14px' }}
                />
                <input
                  value={newFull}
                  onChange={(e) => setNewFull(e.target.value)}
                  placeholder={L.addressPlh}
                  className="w-full bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-3 text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none focus:ring-2 focus:ring-amber-300 transition-all"
                  style={{ fontSize: '14px' }}
                />
                <button
                  type="button"
                  disabled={locating}
                  onClick={async () => {
                    setLocating(true);
                    try {
                      const outcome = await getCurrentLocationAddress();
                      if (outcome.status === 'ok') {
                        setNewFull(outcome.formattedAddress);
                        setPinCoords({ lat: outcome.lat, lng: outcome.lng });
                      } else if (outcome.status === 'partial') {
                        // Fill the field with the best-effort fallback
                        // (formatted lat/lng) and tell the user to
                        // verify it before saving.
                        setNewFull(outcome.formattedAddress);
                        setPinCoords({ lat: outcome.lat, lng: outcome.lng });
                        toast.warning(L.locationFallback);
                      } else {
                        // status === 'error'
                        if (outcome.reason === 'denied') {
                          toast.error(L.locationDenied);
                        } else {
                          toast.error(L.locationUnavailable);
                        }
                      }
                    } finally {
                      setLocating(false);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-2xl active:bg-blue-100 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {locating ? (
                    <Loader2 size={15} className="text-blue-600 dark:text-blue-400 animate-spin" />
                  ) : (
                    <Navigation size={15} className="text-blue-600 dark:text-blue-400" />
                  )}
                  <span
                    className="text-blue-700 dark:text-blue-400"
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    {locating ? L.locating : L.getLocation}
                  </span>
                </button>
                {formError && (
                  <p
                    className="text-red-600 dark:text-red-400"
                    style={{ fontSize: '12px', fontWeight: 600 }}
                    role="alert"
                  >
                    {formError}
                  </p>
                )}
                {/* Phase 4 Feature 4 — interactive map preview. Renders
                    only after the user has captured coordinates via
                    "Use my current location"; the marker is draggable
                    so the seeker can fine-tune the pin before saving.
                    LocationMap silently falls back to a placeholder
                    when VITE_GOOGLE_MAPS_API_KEY is unset. */}
                {pinCoords && (
                  <LocationMap
                    lat={pinCoords.lat}
                    lng={pinCoords.lng}
                    onCoordsChange={(next) => setPinCoords(next)}
                    ariaLabel={L.getLocation}
                    placeholderLabel={L.getLocation}
                  />
                )}
              </div>

              <Button
                variant="primary"
                state={
                  saving ? 'loading' : !newLabel.trim() || !newFull.trim() ? 'disabled' : 'default'
                }
                fullWidth
                onClick={handleSave}
              >
                {L.save}
              </Button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
