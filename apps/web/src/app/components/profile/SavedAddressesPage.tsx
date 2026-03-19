import { useState } from 'react';
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
} from 'lucide-react';
import { useLang } from '../../i18n/LanguageContext';
import { Button } from '../ds/Button';

interface Address {
  id: string;
  typeKey: 'home' | 'work' | 'custom';
  label: string;
  labelAr: string;
  full: string;
  fullAr: string;
  isDefault: boolean;
}

const SEED: Address[] = [
  {
    id: 'a1',
    typeKey: 'home',
    label: 'Home',
    labelAr: 'المنزل',
    full: 'Building 4, Al Olaya District, Riyadh 12241',
    fullAr: 'مبنى 4، حي العليا، الرياض 12241',
    isDefault: true,
  },
  {
    id: 'a2',
    typeKey: 'work',
    label: 'Work',
    labelAr: 'العمل',
    full: 'King Fahd Road, Al Malqa, Riyadh 13521',
    fullAr: 'طريق الملك فهد، حي الملقا، الرياض 13521',
    isDefault: false,
  },
];

const TYPE_ICON: Record<string, React.ReactNode> = {
  home: <Home size={16} />,
  work: <Briefcase size={16} />,
  custom: <MapPin size={16} />,
};

const TYPE_COLOR: Record<string, { bg: string; icon: string }> = {
  home: { bg: 'bg-blue-100 dark:bg-blue-900/40', icon: 'text-blue-600 dark:text-blue-400' },
  work: { bg: 'bg-amber-100 dark:bg-amber-900/40', icon: 'text-amber-600 dark:text-amber-400' },
  custom: { bg: 'bg-green-100 dark:bg-green-900/40', icon: 'text-green-600 dark:text-green-400' },
};

interface SavedAddressesPageProps {
  onBack: () => void;
}

export function SavedAddressesPage({ onBack }: SavedAddressesPageProps) {
  const { lang, dir } = useLang();
  const [addresses, setAddresses] = useState<Address[]>(SEED);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [delConfirm, setDelConfirm] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newFull, setNewFull] = useState('');
  const [saving, setSaving] = useState(false);

  const L = {
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
  };

  const handleSave = () => {
    if (!newLabel.trim() || !newFull.trim()) return;
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      if (editId) {
        setAddresses((prev) =>
          prev.map((a) =>
            a.id === editId
              ? { ...a, label: newLabel, labelAr: newLabel, full: newFull, fullAr: newFull }
              : a,
          ),
        );
      } else {
        setAddresses((prev) => [
          ...prev,
          {
            id: `a${Date.now()}`,
            typeKey: 'custom',
            label: newLabel,
            labelAr: newLabel,
            full: newFull,
            fullAr: newFull,
            isDefault: false,
          },
        ]);
      }
      setShowForm(false);
      setEditId(null);
      setNewLabel('');
      setNewFull('');
    }, 1000);
  };

  const handleEdit = (a: Address) => {
    setEditId(a.id);
    setNewLabel(lang === 'ar' ? a.labelAr : a.label);
    setNewFull(lang === 'ar' ? a.fullAr : a.full);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    setAddresses((prev) => prev.filter((a) => a.id !== id));
    setDelConfirm(null);
  };

  const handleSetDefault = (id: string) => {
    setAddresses((prev) => prev.map((a) => ({ ...a, isDefault: a.id === id })));
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
        {addresses.length === 0 ? (
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
              const tc = TYPE_COLOR[a.typeKey];
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
                        <span className={tc.icon}>{TYPE_ICON[a.typeKey]}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p
                            className="text-slate-900 dark:text-white"
                            style={{ fontSize: '14px', fontWeight: 700 }}
                          >
                            {lang === 'ar' ? a.labelAr : a.label}
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
                          {lang === 'ar' ? a.fullAr : a.full}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3 ps-13">
                      {!a.isDefault && (
                        <button
                          onClick={() => handleSetDefault(a.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 active:bg-slate-200 transition-all"
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
                            className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 active:bg-slate-100 transition-all"
                            style={{ fontSize: '12px', fontWeight: 600 }}
                          >
                            {L.cancel}
                          </button>
                          <button
                            onClick={() => handleDelete(a.id)}
                            className="px-3 py-1.5 rounded-xl bg-red-500 text-white active:scale-95 transition-all"
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
              onClick={() => setShowForm(false)}
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
                  onClick={() => setShowForm(false)}
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
                  onClick={() =>
                    setNewFull(
                      lang === 'ar' ? 'الموقع الحالي (تم التحديد)' : 'Current Location (detected)',
                    )
                  }
                  className="flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-2xl active:bg-blue-100 transition-all"
                >
                  <Navigation size={15} className="text-blue-600 dark:text-blue-400" />
                  <span
                    className="text-blue-700 dark:text-blue-400"
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    {L.getLocation}
                  </span>
                </button>
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
