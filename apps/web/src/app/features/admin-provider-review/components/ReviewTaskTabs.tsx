import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type {
  AdminProviderReviewBlocker,
  AdminProviderReviewTaskId,
} from '@homeservicemarketplace/contracts';
import { BadgeCheck, BriefcaseBusiness, CalendarDays, ClipboardCheck, Images, MapPin } from 'lucide-react';
import { BLOCKER_LABELS, TASK_LABELS, type ReviewLanguage } from '../copy';
import { parseReviewTask } from '../review-task-navigation';
import { WEB_WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS } from '../runtime-constants';
import './review-task-tabs.css';

const ActiveTask = createContext<AdminProviderReviewTaskId | null>(null);
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
    title: 'Registration details',
    hint: 'Open one section at a time. Browsing does not approve the application or grant work access.',
    attention: 'Server-reported issues',
    section: 'Section',
    of: 'of',
    previous: 'Previous section',
    next: 'Next section',
  },
  ar: {
    title: 'بيانات طلب التسجيل',
    hint: 'راجع كل قسم على حدة. تصفح الأقسام لا يعني الموافقة على الطلب أو منح صلاحية العمل.',
    attention: 'ملاحظات أبلغ عنها الخادم',
    section: 'القسم',
    of: 'من',
    previous: 'القسم السابق',
    next: 'القسم التالي',
  },
};

/** A presentation-only shell. Existing dossier, evidence and decision owners stay intact. */
export function ReviewTaskTabs({
  lang, blockers, value, onValueChange, focusLinkedPanel = false, children,
}: {
  lang: ReviewLanguage;
  blockers: readonly AdminProviderReviewBlocker[];
  value: AdminProviderReviewTaskId;
  onValueChange: (value: AdminProviderReviewTaskId) => void;
  focusLinkedPanel?: boolean;
  children: ReactNode;
}) {
  const t = COPY[lang];
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const sequentialNavigation = useRef(false);
  const index = WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS.indexOf(value);
  const issues = blockers.filter((blocker) => blocker.taskId === value);
  useEffect(() => {
    if (!focusLinkedPanel) return;
    // Run after the route's initial heading focus and after the hidden panel becomes visible.
    const frame = requestAnimationFrame(() => {
      const panel = root.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
      panel?.focus({ preventScroll: true });
      panel?.scrollIntoView?.({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusLinkedPanel, value]);

  useEffect(() => {
    if (!sequentialNavigation.current) return;
    sequentialNavigation.current = false;
    root.current?.querySelector<HTMLElement>(`[data-testid="review-tab-${value}"]`)
      ?.focus({ preventScroll: true });
    root.current?.scrollIntoView?.({ block: 'start' });
  }, [value]);

  function moveTo(next: number) {
    const task = WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS[next];
    if (!task) return;
    sequentialNavigation.current = true;
    onValueChange(task);
  }
  return (
    <ActiveTask.Provider value={value}>
      <Tabs.Root
        ref={root}
        value={value}
        onValueChange={(next) => { const task = parseReviewTask(next); if (task) onValueChange(task); }}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        activationMode="automatic"
        className="ar-stack ar-review-tabs"
        data-testid="review-task-tabs"
        data-admin-review-layout="tabbed-v1"
      >
        <div className="ar-card ar-review-tabs-header">
          <div className="ar-subheader">
            <h2 className="ar-heading" id={`${id}-title`}>{t.title}</h2>
            <span className="ar-muted ar-review-tab-position">
              {t.section} {(index + 1).toLocaleString(lang)} {t.of} {WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS.length.toLocaleString(lang)}
            </span>
          </div>
          <Tabs.List className="ar-review-tab-list" aria-labelledby={`${id}-title`}>
            {WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS.map((task) => {
              const Icon = ICONS[task];
              const count = blockers.filter((blocker) => blocker.taskId === task).length;
              return (
                <Tabs.Trigger
                  key={task}
                  value={task}
                  className="ar-review-tab"
                  data-testid={`review-tab-${task}`}
                  aria-label={TASK_LABELS[lang][task]}
                  aria-describedby={count ? `${id}-${task}-issues` : undefined}
                >
                  <Icon size={18} aria-hidden />
                  <span>{TASK_LABELS[lang][task]}</span>
                  {count > 0 && (
                    <span className="ar-review-tab-count" id={`${id}-${task}-issues`}>
                      <span className="ar-review-visually-hidden">{t.attention}: </span>
                      {count.toLocaleString(lang)}
                    </span>
                  )}
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
          <p className="ar-muted ar-review-tabs-hint">{t.hint}</p>
          {issues.length > 0 && (
            <ul className="ar-review-tab-issues" aria-label={t.attention}>
              {issues.map((issue, i) => <li key={`${issue.code}-${i}`}>{BLOCKER_LABELS[lang][issue.code] ?? t.attention}</li>)}
            </ul>
          )}
        </div>
        {children}
        <div className="ar-review-tab-actions">
          <button type="button" className="ar-button" disabled={index === 0} onClick={() => moveTo(index - 1)}>{t.previous}</button>
          <button type="button" className="ar-button" disabled={index === WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS.length - 1} onClick={() => moveTo(index + 1)}>{t.next}</button>
        </div>
      </Tabs.Root>
    </ActiveTask.Provider>
  );
}

/** Keep inactive sections mounted to retain unsent edits; hidden removes focus/AT exposure. */
export function ReviewTaskPanel({ sectionId, children }: { sectionId: string; children: ReactNode }) {
  const selected = useContext(ActiveTask);
  const prefix = 'review-section-';
  const task = sectionId.startsWith(prefix) ? parseReviewTask(sectionId.slice(prefix.length)) : null;
  if (!selected || !task) return <>{children}</>;
  return (
    <Tabs.Content
      value={task}
      forceMount
      hidden={selected !== task}
      tabIndex={selected === task ? 0 : -1}
      className="ar-review-tab-panel"
      data-testid={`review-panel-${task}`}
    >
      {children}
    </Tabs.Content>
  );
}
