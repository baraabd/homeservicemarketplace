import { useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Camera, User, Phone, Mail, MapPin, CheckCircle2 } from "lucide-react";
import { useLang } from "../../i18n/LanguageContext";
import { TextField } from "../ds/TextField";
import { Button }    from "../ds/Button";

interface EditProfilePageProps {
  onBack: () => void;
}

export function EditProfilePage({ onBack }: EditProfilePageProps) {
  const { lang, dir } = useLang();

  const [name,     setName]     = useState(lang === "ar" ? "أحمد الخالد"  : "Ahmed Al-Khalid");
  const [phone,    setPhone]    = useState("+966 50 123 4567");
  const [email,    setEmail]    = useState("ahmed@fixnow.app");
  const [city,     setCity]     = useState(lang === "ar" ? "الرياض"        : "Riyadh");
  const [bio,      setBio]      = useState("");
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [avatarHue,setAvatarHue]= useState(0);  // cycle through gradient colors

  const AVATARS = [
    "from-amber-500 to-orange-600",
    "from-blue-500 to-indigo-600",
    "from-green-500 to-emerald-600",
    "from-purple-500 to-pink-600",
  ];

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }, 1400);
  };

  const L = {
    title:     lang === "ar" ? "تعديل الملف"        : "Edit Profile",
    photo:     lang === "ar" ? "تغيير الصورة"        : "Change Photo",
    name:      lang === "ar" ? "الاسم الكامل"        : "Full Name",
    phone:     lang === "ar" ? "رقم الجوال"          : "Phone Number",
    email:     lang === "ar" ? "البريد الإلكتروني"   : "Email Address",
    city:      lang === "ar" ? "المدينة"             : "City",
    bio:       lang === "ar" ? "نبذة عنك"            : "Bio",
    bioHint:   lang === "ar" ? "اكتب نبذة قصيرة…"   : "Write a short bio…",
    saveBtn:   lang === "ar" ? "حفظ التغييرات"       : "Save Changes",
    saved:     lang === "ar" ? "تم الحفظ بنجاح ✓"   : "Saved successfully ✓",
    emailNote: lang === "ar" ? "لا يمكن تغيير البريد الإلكتروني" : "Email cannot be changed",
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900"
      initial={{ x: dir === "rtl" ? "-100%" : "100%" }}
      animate={{ x: 0 }}
      exit={{ x: dir === "rtl" ? "-100%" : "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
    >
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all"
          >
            {dir === "rtl"
              ? <ChevronRight size={20} className="text-slate-700 dark:text-slate-300" />
              : <ChevronLeft  size={20} className="text-slate-700 dark:text-slate-300" />
            }
          </button>
          <p className="text-slate-900 dark:text-white" style={{ fontSize: "16px", fontWeight: 800 }}>{L.title}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-5" style={{ scrollbarWidth: "none" }}>

        {/* Avatar editor */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative">
            <div className={`w-24 h-24 rounded-3xl bg-gradient-to-br ${AVATARS[avatarHue % AVATARS.length]} flex items-center justify-center shadow-lg`}>
              <span className="text-white" style={{ fontSize: "28px", fontWeight: 800 }}>AK</span>
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
            style={{ fontSize: "13px", fontWeight: 600 }}
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
              <p className="text-slate-400" style={{ fontSize: "11px" }}>{L.emailNote}</p>
            </div>
          </div>
          <TextField
            label={L.city}
            value={city}
            onChange={setCity}
            leadingIcon={<MapPin size={16} />}
          />

          {/* Bio textarea */}
          <div>
            <p className="text-slate-600 dark:text-slate-300 mb-2" style={{ fontSize: "13px", fontWeight: 600 }}>
              {L.bio}
            </p>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={L.bioHint}
              rows={3}
              maxLength={120}
              className="w-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600 rounded-2xl px-4 py-3 text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none focus:border-amber-400 transition-colors resize-none"
              style={{ fontSize: "14px" }}
            />
            <p className="text-end text-slate-400 mt-1" style={{ fontSize: "11px" }}>
              {bio.length}/120
            </p>
          </div>
        </div>

        <div className="h-4" />
      </div>

      {/* Sticky footer */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 px-4 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        {saved ? (
          <div className="flex items-center justify-center gap-2 py-3.5 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-2xl">
            <CheckCircle2 size={18} className="text-green-500" />
            <span className="text-green-700 dark:text-green-400" style={{ fontSize: "14px", fontWeight: 700 }}>
              {L.saved}
            </span>
          </div>
        ) : (
          <Button
            variant="primary"
            state={saving ? "loading" : "default"}
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