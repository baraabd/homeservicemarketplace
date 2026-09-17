import {
  ADMIN_PROVIDER_REVIEW_TASK_IDS,
  type AdminProviderReview,
  type ProviderReviewSnapshot,
} from '@homeservicemarketplace/contracts';
import { BadgeCheck, BriefcaseBusiness, CalendarDays, ClipboardCheck, Images, MapPin } from 'lucide-react';
import { TASK_LABELS, type ReviewLanguage } from '../copy';
import { reviewTaskSummary } from '../review-task-summary';
import { ReviewBadge } from './ReviewPrimitives';
import '../review-task-overview.css';

const ICONS = { BASICS_IDENTITY: BadgeCheck, SERVICES_EXPERIENCE: BriefcaseBusiness, WORK_AREA: MapPin, WORKING_HOURS: CalendarDays, PORTFOLIO: Images, REVIEW_SUBMISSION: ClipboardCheck };

export function ReviewTaskOverview({ review, snapshot, lang }: {
  review: AdminProviderReview;
  snapshot: ProviderReviewSnapshot | null;
  lang: ReviewLanguage;
}) {
  const isAr = lang === 'ar';
  return (
    <section className="ar-card ar-stack art-overview" aria-labelledby="review-task-overview-title" data-testid="review-task-overview">
      <div><h2 id="review-task-overview-title" className="ar-heading">{isAr ? 'مراجعة بيانات التسجيل' : 'Registration review'}</h2><p className="ar-muted">{isAr ? 'افحص الأقسام الستة والوثائق قبل القرار. التنبيهات أدناه تعكس موانع القرار الحالية من الخادم.' : 'Inspect all six sections and the evidence before deciding. Alerts below reflect current decision blockers from the server.'}</p></div>
      <nav className="art-grid" aria-label={isAr ? 'أقسام ملف التسجيل' : 'Registration sections'}>
        {ADMIN_PROVIDER_REVIEW_TASK_IDS.map((task, index) => {
          const Icon = ICONS[task];
          const blockers = review.blockers.filter((item) => item.taskId === task);
          return (
            <a className="art-task" aria-label={TASK_LABELS[lang][task]} aria-describedby={`review-task-summary-${task}`} key={task} href={`#review-section-${task}`} data-testid={`review-task-link-${task}`}>
              <span className="art-task-top"><Icon size={19} aria-hidden="true" /><span>{(index + 1).toLocaleString(lang).padStart(2, lang === 'ar' ? '٠' : '0')}</span></span>
              <strong>{TASK_LABELS[lang][task]}</strong>
              <span className="ar-muted art-summary" id={`review-task-summary-${task}`}><bdi dir="auto">{reviewTaskSummary(task, snapshot, lang)}</bdi></span>
              <ReviewBadge tone={blockers.length ? 'warning' : 'neutral'}>{blockers.length ? `${blockers.length.toLocaleString(lang)} ${isAr ? 'تنبيهات للمراجعة' : blockers.length === 1 ? 'review alert' : 'review alerts'}` : isAr ? 'عرض البيانات' : 'Inspect details'}</ReviewBadge>
            </a>
          );
        })}
      </nav>
      <a className="ar-button art-decision-link" href="#review-decision-panel">{isAr ? 'عرض موانع القرار والإجراءات المتاحة' : 'View decision blockers and available actions'}</a>
    </section>
  );
}
