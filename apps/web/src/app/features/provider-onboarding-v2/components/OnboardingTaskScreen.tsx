import { useNavigate, useParams } from 'react-router';

import { Button } from '../../../components/ds/Button';
import { useLang } from '../../../i18n/LanguageContext';
import { useProviderOnboardingHub } from '../../../hooks/provider/useProviderOnboardingHub';
import { deriveHubView, isTaskActionable } from '../hub-view-state';
import {
  SCREEN_COPY,
  statusExplanation,
  statusLabel,
  taskCopy,
  type Lang,
} from '../copy/onboarding-hub-copy';
import { OnboardingShell } from './OnboardingShell';
import { BasicsTask } from './BasicsTaskScreen';
import { ServicesTask } from './ServicesTaskScreen';

// Sprint 9B.16 — the per-task route.
//
// This is what makes the hub RESUMABLE. The task the provider opened is in the
// URL, so a reload returns to it, and a session that expired mid-task comes
// back to it after login (RequireAuth carries the full path through as
// `returnTo`). Tab state in a component could do neither.
//
// It is deliberately thin. The task FORMS are not part of this release, and
// the honest thing for the screen to do is say so rather than render an input
// that saves nowhere. What it does own is the ACCESS DECISION, and that comes
// from the server like everything else: a task the hub reports as blocked or
// waiting cannot be entered by typing its id into the address bar.

const TASK_COPY_BY_LANG = {
  en: {
    pending: 'This step is not available in this preview yet.',
    back: 'Back to tasks',
    missing: 'We could not find that task',
    missingBody: 'It may have been renamed or it is not part of your application.',
  },
  ar: {
    pending: 'هذه الخطوة غير متاحة بعد في هذه النسخة.',
    back: 'العودة إلى المهام',
    missing: 'تعذّر العثور على هذه المهمة',
    missingBody: 'ربما تم تغيير اسمها أو أنها ليست جزءاً من طلبك.',
  },
} as const;

export function OnboardingTaskScreen() {
  const { lang: rawLang } = useLang();
  const lang = (rawLang === 'ar' ? 'ar' : 'en') as Lang;
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();

  const query = useProviderOnboardingHub();
  const errorStatus = query.error?.response?.status ?? null;
  const view = deriveHubView({ isFetched: query.isFetched, data: query.data, errorStatus });

  const local = TASK_COPY_BY_LANG[lang];
  const backToHub = () => navigate('/provider/onboarding');

  // Until the hub has resolved there is nothing to decide. Rendering the task
  // optimistically would mean showing a surface for a task the server may say
  // is blocked.
  if (view.state === 'LOADING') {
    return (
      <OnboardingShell title={SCREEN_COPY[lang].LOADING.title} onClose={backToHub}>
        <div className="flex justify-center py-10" role="status" aria-live="polite">
          <span className="sr-only">{SCREEN_COPY[lang].LOADING.title}</span>
          <div className="w-10 h-10 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
        </div>
      </OnboardingShell>
    );
  }

  const task = query.data?.tasks.find((t) => t.id === taskId);

  if (!task) {
    return (
      <OnboardingShell title={local.missing} onClose={backToHub}>
        <div
          className="flex flex-col items-center gap-3 py-10 text-center"
          data-testid="task-not-found"
          role="status"
          aria-live="polite"
        >
          <p className="max-w-[34ch] break-words text-slate-500" style={{ fontSize: '13px' }}>
            {local.missingBody}
          </p>
          <div className="w-full max-w-[260px]">
            <Button variant="primary" tone="provider" fullWidth onClick={backToHub}>
              {local.back}
            </Button>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  const copy = taskCopy(task, lang);
  const actionable = isTaskActionable(task.status);
  const explanation = statusExplanation(task.status, lang);

  return (
    <OnboardingShell
      title={copy.title}
      onClose={backToHub}
      footer={
        <Button variant="secondary" tone="provider" fullWidth onClick={backToHub}>
          {local.back}
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid={`task-screen-${task.id}`}>
        <p className="break-words text-slate-500 dark:text-slate-400" style={{ fontSize: '13px' }}>
          {copy.description}
        </p>

        <span
          className="self-start rounded-full bg-slate-100 px-2 py-0.5 text-slate-600"
          style={{ fontSize: '11px', fontWeight: 600 }}
          data-testid="task-screen-status"
        >
          {statusLabel(task.status, lang)}
        </span>

        {/* A task reached by URL that the server says is not open gets the
            SAME sentence the row gives, rather than a form. */}
        {!actionable && explanation ? (
          <p
            className="break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '13px' }}
            data-testid="task-screen-blocked"
          >
            {explanation}
          </p>
        ) : null}

        {/* Sprint 9B.17 — Task 1 is built. The others still say so honestly
            rather than rendering an input that saves nowhere. Gated on
            `actionable` like everything else: a task the SERVER calls blocked
            does not get a form just because the client has one. */}
        {actionable && task.id === 'BASICS_IDENTITY' ? (
          <BasicsTask lang={lang} />
        ) : actionable && task.id === 'SERVICES_EXPERIENCE' ? (
          <ServicesTask lang={lang} />
        ) : actionable ? (
          <p
            className="break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '13px' }}
            data-testid="task-screen-pending"
          >
            {local.pending}
          </p>
        ) : null}
      </div>
    </OnboardingShell>
  );
}
