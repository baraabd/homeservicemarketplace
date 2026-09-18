import {
  BadgeCheck, BriefcaseBusiness, CalendarDays, ClipboardCheck, Images, MapPin,
} from 'lucide-react';
import {
  ADMIN_PROVIDER_REVIEW_TASK_IDS,
  type AdminProviderReviewBlocker,
  type AdminProviderReviewTaskId,
} from '@homeservicemarketplace/contracts';
import { BLOCKER_LABELS, TASK_LABELS, type ReviewLanguage } from '../copy';
import './review-task-index.css';

const ICONS = {
  BASICS_IDENTITY: BadgeCheck,
  SERVICES_EXPERIENCE: BriefcaseBusiness,
  WORK_AREA: MapPin,
  WORKING_HOURS: CalendarDays,
  PORTFOLIO: Images,
  REVIEW_SUBMISSION: ClipboardCheck,
};
const COPY = {
  en: {
    title: 'Application review checklist',
    hint: 'Inspect each section before deciding. These links do not mark data as reviewed or approved.',
    open: 'Open to review',
    attention: 'Server-reported blocker',
    tasks: {
      BASICS_IDENTITY: 'Contact details, identity and supporting documents',
      SERVICES_EXPERIENCE: 'Specialties, experience, equipment and licenses',
      WORK_AREA: 'Country, districts, service radius and workshop',
      WORKING_HOURS: 'Working days, intervals and time zone',
      PORTFOLIO: 'Biography, work samples and publication rights',
      REVIEW_SUBMISSION: 'Submitted version, consent, corrections and history',
    },
  },
  ar: {
    title: 'قائمة مراجعة طلب التسجيل',
    hint: 'افحص كل قسم قبل اتخاذ القرار. فتح القسم لا يعني اعتماد بياناته أو الموافقة عليها.',
    open: 'افتح للمراجعة',
    attention: 'مانع أبلغ عنه الخادم',
    tasks: {
      BASICS_IDENTITY: 'بيانات التواصل والهوية والوثائق الداعمة',
      SERVICES_EXPERIENCE: 'التخصصات والخبرة والمعدات والتراخيص',
      WORK_AREA: 'البلد والأحياء ونطاق الخدمة وموقع الورشة',
      WORKING_HOURS: 'أيام العمل والفترات والمنطقة الزمنية',
      PORTFOLIO: 'النبذة ونماذج الأعمال وحقوق نشر الصور',
      REVIEW_SUBMISSION: 'النسخة المرسلة والموافقة والتصحيحات والسجل',
    },
  },
} satisfies Record<ReviewLanguage, {
  title: string;
  hint: string;
  open: string;
  attention: string;
  tasks: Record<AdminProviderReviewTaskId, string>;
}>;

/** Navigation and server facts only; never a second readiness or approval policy. */
export function ReviewTaskIndex({ lang, blockers }: {
  lang: ReviewLanguage;
  blockers: readonly AdminProviderReviewBlocker[];
}) {
  const t = COPY[lang];
  return (
    <nav className="ar-card ar-review-index" aria-label={t.title} data-testid="review-task-index">
      <h2 className="ar-heading">{t.title}</h2>
      <p className="ar-muted">{t.hint}</p>
      <ol className="ar-review-index-list">
        {ADMIN_PROVIDER_REVIEW_TASK_IDS.map((task, index) => {
          const Icon = ICONS[task];
          const issues = blockers.filter((entry) => entry.taskId === task);
          return (
            <li key={task}>
              <a
                className={issues.length
                  ? 'ar-review-index-link ar-review-index-attention'
                  : 'ar-review-index-link'}
                href={`#review-section-${task}`}
              >
                <span className="ar-review-index-icon" aria-hidden="true"><Icon size={20} /></span>
                <span className="ar-review-index-copy">
                  <strong>{(index + 1).toLocaleString(lang)}. {TASK_LABELS[lang][task]}</strong>
                  <span className="ar-muted">{t.tasks[task]}</span>
                  <span className="ar-review-index-state">
                    {issues.length ? t.attention : t.open}
                  </span>
                  {issues.map((issue, i) => (
                    <span className="ar-review-index-issue" key={`${issue.code}-${i}`}>
                      {BLOCKER_LABELS[lang][issue.code] ?? t.attention}
                    </span>
                  ))}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
