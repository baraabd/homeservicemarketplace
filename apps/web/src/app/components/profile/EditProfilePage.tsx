import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Camera,
  User,
  Phone,
  Mail,
  MapPin,
  CheckCircle2,
  Wrench,
} from 'lucide-react';
import { useLang } from '../../i18n/LanguageContext';
import { TextField } from '../ds/TextField';
import { Button } from '../ds/Button';
import { useProfile, useUpdateProfile } from '../../hooks/seeker/useProfile';
import {
  useProviderProfile,
  useUpdateProviderProfile,
} from '../../hooks/provider/useProviderProfile';
import { useServiceCategories } from '../../../lib/use-service-categories';
import { useAuth } from '../../../lib/auth-provider';

interface EditProfilePageProps {
  onBack: () => void;
}

// Splits a single Full Name string into firstName / lastName for the
// PATCH payload. The backend stores them separately on the User row;
// the UI shows a single field for ergonomics. The split is "first
// token = firstName, the rest = lastName" — same heuristic the
// /v1/auth/me display path uses, so the round-trip is stable.
function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

export function EditProfilePage({ onBack }: EditProfilePageProps) {
  const { lang, dir } = useLang();
  const profileQuery = useProfile();
  const updateMut = useUpdateProfile();

  // Phase 6 Step 2 — provider-only fields. The page is shared with
  // seekers (mounted from ProfileTab.tsx) and providers (mounted
  // from ProviderProfileScreen). The skills picker + the
  // serviceAreaCity write-through to /v1/me/provider/profile only
  // render / fire when the authenticated user has the provider role.
  const auth = useAuth();
  const isProvider = (auth.user?.roles ?? []).includes('provider');
  const providerProfileQuery = useProviderProfile();
  const updateProviderMut = useUpdateProviderProfile();
  const categoriesQuery = useServiceCategories();

  // Form state. We initialise empty so the form never renders the
  // legacy "Ahmed Al-Khalid / +966 / Riyadh / AK" hardcodes; the
  // useEffect below seeds from the server response once.
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [avatarHue, setAvatarHue] = useState(0); // cycle through gradient colors

  const profile = profileQuery.data?.profile ?? null;
  const providerProfile = providerProfileQuery.data?.profile ?? null;
  const email = profile?.email ?? '';
  const initials = profile?.initials ?? '';

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  // Seed the form once the API responds. We DON'T overwrite on every
  // re-render of profileQuery.data — the user is mid-edit and we'd
  // clobber their typing. Re-seeding only fires on profile id /
  // updatedAt changes (i.e. after a save success when the cache
  // invalidates).
  //
  // For provider users the provider profile is the SOURCE OF TRUTH
  // for the city — User.city tracks where the seeker LIVES while
  // ProviderProfile.serviceAreaCity tracks where the provider WORKS.
  // For most users they're the same, but the provider value wins
  // when both exist so the skills/city the user set inside the
  // provider edit flow show up correctly here.
  useEffect(() => {
    if (!profile) return;
    setName(profile.displayName);
    setPhone(profile.phoneNumber ?? '');
    setCity(providerProfile?.serviceAreaCity ?? profile.city ?? '');
    setBio(bio || (profile.bio ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.updatedAt, providerProfile?.updatedAt]);

  // Seed the skills selection from the provider profile when it lands.
  useEffect(() => {
    if (!providerProfile) return;
    setSelectedCategoryIds(providerProfile.serviceCategories.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerProfile?.updatedAt]);

  const toggleCategory = (id: string): void => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  // Real PATCH flow. The legacy 1.4s setTimeout animation has been
  // replaced with the actual mutations:
  //   - PATCH /v1/me/profile      — name + phone + bio + city (User row)
  //   - PATCH /v1/me/provider/profile — serviceAreaCity + categoryIds
  //                                    (provider users only)
  // For provider users both endpoints are hit IN PARALLEL via
  // Promise.all so the user only waits for the slower of the two.
  // Success only flips to "Saved" after BOTH resolve. Empty strings
  // become null on the seeker endpoint so the user can clear a field.
  const handleSave = async (): Promise<void> => {
    if (updateMut.isPending || updateProviderMut.isPending) return;
    setSubmitError(null);
    const { firstName, lastName } = splitName(name);
    const trimmedPhone = phone.trim();
    const trimmedCity = city.trim();
    const trimmedBio = bio.trim();

    try {
      const seekerSave = updateMut.mutateAsync({
        firstName,
        lastName,
        phoneNumber: trimmedPhone === '' ? null : trimmedPhone,
        city: trimmedCity === '' ? null : trimmedCity,
        bio: trimmedBio === '' ? null : trimmedBio,
      });

      // Provider-only write — only fire when the user actually has
      // a provider profile. A provider-roled user without a profile
      // (corner case after manual data edit) won't 404 us into a
      // "save failed" because the mutation simply isn't called.
      const providerSave =
        isProvider && providerProfile
          ? updateProviderMut.mutateAsync({
              // Empty string explicitly clears the city; backend DTO
              // accepts string | null.
              serviceAreaCity: trimmedCity === '' ? null : trimmedCity,
              categoryIds: selectedCategoryIds,
            })
          : Promise.resolve(null);

      await Promise.all([seekerSave, providerSave]);
      setSaved(true);
      // Brief visual confirmation, then return to the default state
      // so the user can continue editing if they want.
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      const status =
        (err as { response?: { status?: number } } | undefined)?.response?.status ?? null;
      if (status === 400) {
        setSubmitError(
          lang === 'ar'
            ? 'تعذر حفظ التغييرات. تحقق من البيانات وحاول مرة أخرى.'
            : "We couldn't save those changes. Check your input and try again.",
        );
      } else if (status === 401) {
        setSubmitError(
          lang === 'ar'
            ? 'انتهت الجلسة. حاول تسجيل الدخول مرة أخرى.'
            : 'Your session has expired. Please log in again.',
        );
      } else {
        setSubmitError(
          lang === 'ar'
            ? 'تعذر حفظ التغييرات. حاول مرة أخرى.'
            : "We couldn't save those changes. Please try again.",
        );
      }
    }
  };

  const AVATARS = [
    'from-amber-500 to-orange-600',
    'from-blue-500 to-indigo-600',
    'from-green-500 to-emerald-600',
    'from-purple-500 to-pink-600',
  ];

  const L = {
    title: lang === 'ar' ? 'تعديل الملف' : 'Edit Profile',
    photo: lang === 'ar' ? 'تغيير الصورة' : 'Change Photo',
    name: lang === 'ar' ? 'الاسم الكامل' : 'Full Name',
    phone: lang === 'ar' ? 'رقم الجوال' : 'Phone Number',
    email: lang === 'ar' ? 'البريد الإلكتروني' : 'Email Address',
    city: lang === 'ar' ? 'المدينة' : 'City',
    cityHint:
      lang === 'ar'
        ? 'مدينة عملك. تحدد الطلبات التي تظهر لك.'
        : 'Your work city — controls which requests you see.',
    bio: lang === 'ar' ? 'نبذة عنك' : 'Bio',
    bioHint: lang === 'ar' ? 'اكتب نبذة قصيرة…' : 'Write a short bio…',
    skills: lang === 'ar' ? 'مهاراتي' : 'My Skills',
    skillsHint:
      lang === 'ar'
        ? 'اختر التخصصات التي تقدمها. ستحدد الطلبات التي تتلقاها.'
        : 'Pick the categories you serve — drives which jobs reach you.',
    skillsLoading: lang === 'ar' ? 'جاري تحميل التخصصات…' : 'Loading categories…',
    saveBtn: lang === 'ar' ? 'حفظ التغييرات' : 'Save Changes',
    saved: lang === 'ar' ? 'تم الحفظ بنجاح ✓' : 'Saved successfully ✓',
    emailNote: lang === 'ar' ? 'لا يمكن تغيير البريد الإلكتروني' : 'Email cannot be changed',
  };

  const isLoadingProfile = profileQuery.isLoading && !profileQuery.data;

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
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '16px', fontWeight: 800 }}
          >
            {L.title}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-5" style={{ scrollbarWidth: 'none' }}>
        {/* Avatar editor */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative">
            <div
              className={`w-24 h-24 rounded-3xl bg-gradient-to-br ${AVATARS[avatarHue % AVATARS.length]} flex items-center justify-center shadow-lg`}
            >
              <span className="text-white" style={{ fontSize: '28px', fontWeight: 800 }}>
                {initials}
              </span>
            </div>
            <button
              onClick={() => setAvatarHue((h) => h + 1)}
              className="absolute -bottom-2 -end-2 w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shadow-md active:scale-90 transition-all border-2 border-white"
            >
              <Camera size={14} className="text-white" />
            </button>
          </div>
          <button
            onClick={() => setAvatarHue((h) => h + 1)}
            className="mt-3 text-amber-600 active:opacity-70"
            style={{ fontSize: '13px', fontWeight: 600 }}
          >
            {L.photo}
          </button>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-4">
          <TextField
            label={L.name}
            value={name}
            onChange={setName}
            leadingIcon={<User size={16} />}
          />
          <TextField
            label={L.phone}
            type="tel"
            value={phone}
            onChange={setPhone}
            leadingIcon={<Phone size={16} />}
          />
          <div className="relative">
            <TextField
              label={L.email}
              type="email"
              value={email}
              onChange={() => {}}
              leadingIcon={<Mail size={16} />}
            />
            <div className="mt-1 px-1">
              <p className="text-slate-400" style={{ fontSize: '11px' }}>
                {L.emailNote}
              </p>
            </div>
          </div>
          <TextField
            label={L.city}
            value={city}
            onChange={setCity}
            leadingIcon={<MapPin size={16} />}
            hint={isProvider ? L.cityHint : undefined}
          />

          {/* Phase 6 Step 2 — provider-only skills picker. Toggleable
              pills mirror the existing visual rhythm of the wizard's
              segment buttons + the financial-summary chips. Only the
              currently-selected skills are highlighted; tapping a pill
              toggles membership. The data flow:
                useServiceCategories() → catalog
                providerProfile.serviceCategories → seed selection
                selectedCategoryIds → handleSave → categoryIds payload
              When the user has no provider role, this whole block is
              hidden and the underlying state stays the empty default. */}
          {isProvider && (
            <div data-testid="edit-profile-skills">
              <p
                className="text-slate-600 dark:text-slate-300 mb-1"
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {L.skills}
              </p>
              <p className="text-slate-400 dark:text-slate-500 mb-2.5" style={{ fontSize: '11px' }}>
                {L.skillsHint}
              </p>
              {categoriesQuery.isLoading && categories.length === 0 ? (
                <p className="text-slate-400" style={{ fontSize: '12px' }}>
                  {L.skillsLoading}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2" role="group" aria-label={L.skills}>
                  {categories.map((cat) => {
                    const active = selectedCategoryIds.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => toggleCategory(cat.id)}
                        aria-pressed={active}
                        data-testid={`skill-pill-${cat.slug}`}
                        className={[
                          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border transition-all active:scale-95',
                          active
                            ? 'border-amber-500 bg-amber-500 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300',
                        ].join(' ')}
                        style={{ fontSize: '12px', fontWeight: 600 }}
                      >
                        <Wrench size={11} className={active ? 'text-white' : 'text-slate-400'} />
                        {lang === 'ar' ? cat.labelAr : cat.labelEn}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Bio textarea */}
          <div>
            <p
              className="text-slate-600 dark:text-slate-300 mb-2"
              style={{ fontSize: '13px', fontWeight: 600 }}
            >
              {L.bio}
            </p>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={L.bioHint}
              rows={3}
              maxLength={500}
              className="w-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600 rounded-2xl px-4 py-3 text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none focus:border-amber-400 transition-colors resize-none"
              style={{ fontSize: '14px' }}
            />
            <p className="text-end text-slate-400 mt-1" style={{ fontSize: '11px' }}>
              {bio.length}/500
            </p>
          </div>

          {/* Inline error — set by handleSave on PATCH failure. The raw
              backend payload is never rendered. */}
          {submitError && (
            <div
              className="px-4 py-3 rounded-2xl bg-red-50 border border-red-100 text-red-700"
              style={{ fontSize: '13px', fontWeight: 600 }}
              role="alert"
            >
              {submitError}
            </div>
          )}
        </div>

        <div className="h-4" />
      </div>

      {/* Sticky footer */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 px-4 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        {saved ? (
          <div className="flex items-center justify-center gap-2 py-3.5 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-2xl">
            <CheckCircle2 size={18} className="text-green-500" />
            <span
              className="text-green-700 dark:text-green-400"
              style={{ fontSize: '14px', fontWeight: 700 }}
            >
              {L.saved}
            </span>
          </div>
        ) : (
          <Button
            variant="primary"
            state={
              updateMut.isPending || updateProviderMut.isPending
                ? 'loading'
                : isLoadingProfile
                  ? 'disabled'
                  : 'default'
            }
            fullWidth
            onClick={handleSave}
          >
            {L.saveBtn}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
