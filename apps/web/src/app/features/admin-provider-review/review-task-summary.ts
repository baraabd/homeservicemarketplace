import type { AdminProviderReviewTaskId, ProviderReviewSnapshot } from '@homeservicemarketplace/contracts';
import { REVIEW_COPY, type ReviewLanguage } from './copy';

/** Describes the selected snapshot only. This is not a completeness or eligibility resolver. */
export function reviewTaskSummary(task: AdminProviderReviewTaskId, snapshot: ProviderReviewSnapshot | null, lang: ReviewLanguage): string {
  const t = REVIEW_COPY[lang];
  if (!snapshot) return t.notCaptured;
  const count = (value: number) => value.toLocaleString(lang);
  switch (task) {
    case 'BASICS_IDENTITY': return `${snapshot.profile.providerType === 'BUSINESS' ? t.registeredBusiness : snapshot.profile.providerType === 'INDIVIDUAL' ? t.individual : t.notProvided} · ${lang === 'ar' ? 'بيانات الاتصال' : 'contact details'}`;
    case 'SERVICES_EXPERIENCE': return lang === 'ar' ? `التخصصات المسجلة: ${count(snapshot.services.specialties.length)}` : `${count(snapshot.services.specialties.length)} listed ${snapshot.services.specialties.length === 1 ? 'specialty' : 'specialties'}`;
    case 'WORK_AREA': return [snapshot.workArea.city, snapshot.workArea.countryCode].filter(Boolean).join(' · ') || t.notProvided;
    case 'WORKING_HOURS': {
      const days = new Set(snapshot.availability.intervals.map((interval) => interval.dayOfWeek)).size;
      const label = lang === 'ar' ? `أيام العمل: ${count(days)}` : `${count(days)} working ${days === 1 ? 'day' : 'days'}`;
      return `${label} · ${snapshot.availability.timezone || t.notProvided}`;
    }
    case 'PORTFOLIO': return lang === 'ar' ? `الصور في نسخة الملف: ${count(snapshot.portfolio.length)}` : `${count(snapshot.portfolio.length)} ${snapshot.portfolio.length === 1 ? 'image' : 'images'} in this snapshot`;
    case 'REVIEW_SUBMISSION': return `${lang === 'ar' ? 'الشروط' : 'Terms'}: ${snapshot.consent.acceptedVersion || t.notProvided}`;
  }
}
