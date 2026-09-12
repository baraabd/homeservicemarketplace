import { useLocation, useNavigate, useParams } from 'react-router';

import { Button } from '../../../components/ds/Button';
import { ProviderButton, ProviderStickyActionRow } from '../../provider-ui';
import { AutosaveStatus } from './AutosaveStatus';
import { useOnboardingStepAutosave } from '../autosave/ProviderOnboardingAutosaveProvider';
import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import { TASK_CHROME_COPY, TASK_SCREEN_ROUTES, taskScreenKeyFor } from '../copy/task-chrome-copy';
import { useLang } from '../../../i18n/LanguageContext';
import { useProviderOnboardingHub } from '../../../hooks/provider/useProviderOnboardingHub';
import { deriveHubView, isTaskActionable } from '../hub-view-state';
import { SCREEN_COPY, statusExplanation, taskCopy, type Lang } from '../copy/onboarding-hub-copy';
import { OnboardingShell } from './OnboardingShell';
import { ExitBlockedNotice } from './ExitBlockedNotice';
import { useOnboardingExit } from '../autosave/useOnboardingExit';
import { EXIT_COPY } from '../copy/exit-copy';
import { BasicsTask } from './BasicsTaskScreen';
import { ServicesTask } from './ServicesTaskScreen';
import { ServiceAreaTask } from './ServiceAreaTaskScreen';
import { AvailabilityTask } from './AvailabilityTaskScreen';
import { PublicProfileTask } from './PublicProfileTaskScreen';
import { ReviewTask } from './ReviewTaskScreen';

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
  const { taskId } = useParams<{ taskId: string }>();

  // Sprint 9B.28 — the ONLY way out of a task.
  //
  // This used to be `() => navigate('/provider/onboarding')`, wired to both
  // the header Close and the footer button. It is synchronous, so an edit
  // resting in the autosave debounce — every edit made in the second before
  // the tap — died with the component that owned the timer. `exit()` drains
  // the whole draft first and stays put if the drain fails.
  const exit = useOnboardingExit();

  const query = useProviderOnboardingHub();
  const errorStatus = query.error?.response?.status ?? null;
  const view = deriveHubView({ isFetched: query.isFetched, data: query.data, errorStatus });

  // Sprint 09B.29 Phase 5A — which APPROVED SCREEN is showing.
  //
  // Derived from the URL rather than from component state, so a reload returns
  // to the half the provider was on and the back button steps between the two
  // halves of a two-screen task. Computed from the route PARAM, not from the
  // resolved task, because it feeds a hook and hooks cannot wait for a fetch.
  const location = useLocation();
  const navigate = useNavigate();
  const screenKey = taskId ? taskScreenKeyFor(taskId, location.hash) : null;
  const screenRoute = screenKey ? TASK_SCREEN_ROUTES[screenKey] : null;
  const chrome = screenKey ? TASK_CHROME_COPY[lang][screenKey] : null;

  // The save line the approved sticky bar carries. `REVIEW` collects nothing
  // of its own, so it is the harmless default for a screen with no step.
  const chromeAutosave = useOnboardingStepAutosave(screenRoute?.step ?? 'REVIEW');

  // The server's own `lastSavedAt`, for the bar's resting state. The same
  // query key every task body already reads, so this shares their cache entry
  // rather than issuing a second request for the same draft.
  const draft = useOnboardingDraft();

  const local = TASK_COPY_BY_LANG[lang];
  const exitCopy = EXIT_COPY[lang];
  const backToHub = () => exit.exit('/provider/onboarding');

  /**
   * The one primary action, and what it promises.
   *
   * A move WITHIN a task is a plain navigation: the same screen stays mounted,
   * the coordinator keeps its timers, and nothing needs draining. A move OUT of
   * one goes through `exit()`, which flushes the draft first and stays put if
   * the flush fails — the same contract the Back control has always honoured,
   * and the reason an edit made a second before the tap is not lost.
   */
  const goNext = () => {
    const next = screenRoute?.next;
    if (!next) return;
    if (next.startsWith('#')) {
      navigate({ pathname: location.pathname, hash: next }, { replace: false });
      return;
    }
    exit.exit(next);
  };

  /** Progress is the SERVER's task counters, never a client guess. */
  const progress = query.data
    ? Math.round((query.data.progress.complete / Math.max(1, query.data.progress.total)) * 100)
    : undefined;

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

  // ── The approved sticky bar ───────────────────────────────────────────────
  //
  // `.hsm-sticky`: a 7px-gap column holding the action row and, beneath it,
  // the save line. The reference puts the save state HERE rather than in the
  // form, which is why each task body no longer carries its own copy — the
  // provider looks in one place for "is my work safe", and it is the place
  // their thumb already is.
  const secondaryLabel = chrome?.secondary ?? local.back;
  const footer = (
    <div className="grid gap-[7px]">
      <ProviderStickyActionRow
        secondary={
          <ProviderButton
            tone="secondary"
            shape="onboarding"
            size="block"
            onClick={backToHub}
            disabled={exit.isLeaving}
            data-testid="task-back-to-tasks"
          >
            {/* The label is the honest one while the flush runs: the button did
                not fail to respond, it is finishing the provider's last edit. */}
            {exit.isLeaving ? exitCopy.leaving : secondaryLabel}
          </ProviderButton>
        }
        primary={
          // Drawn only when the chrome genuinely owns it. On the consent screen
          // the primary is a SUBMISSION — a server command with its own
          // preconditions — and a button here that merely looked like one would
          // be the worst kind of parity: correct in a screenshot, inert in use.
          screenRoute?.next ? (
            <ProviderButton
              tone="primary"
              shape="onboarding"
              size="block"
              onClick={goNext}
              disabled={exit.isLeaving}
              data-testid={screenRoute.primaryTestId}
            >
              {chrome?.primary}
            </ProviderButton>
          ) : null
        }
      />
      <div className="flex items-center justify-center">
        <AutosaveStatus
          status={chromeAutosave.status}
          lang={lang}
          testIdPrefix="task"
          lastSavedAt={draft.data?.lastSavedAt ?? null}
        />
      </div>
    </div>
  );

  return (
    <OnboardingShell
      title={chrome?.title ?? copy.title}
      subtitle={chrome?.subtitle}
      progress={progress}
      // A task screen steps BACK through a flow; it does not abandon one.
      backAffordance="back"
      onClose={backToHub}
      closeBusy={exit.isLeaving}
      footer={
        screenRoute?.next ? (
          footer
        ) : (
          <Button
            variant="secondary"
            tone="provider"
            fullWidth
            onClick={backToHub}
            state={exit.isLeaving ? 'loading' : 'default'}
          >
            {exit.isLeaving ? exitCopy.leaving : local.back}
          </Button>
        )
      }
    >
      {/* `.hsm-main`: an 18px column. The description line and the status pill
          that used to sit here are gone — the approved screen carries neither,
          and both were repeating what the header and the hub row already say. */}
      <div className="flex flex-col gap-[18px]" data-testid={`task-screen-${task.id}`}>
        {/* First in the column: it explains why a navigation the provider
            just asked for did not happen, so it must not be below the fold of
            a long form. */}
        <ExitBlockedNotice
          state={exit.state}
          lang={lang}
          onRetry={exit.retry}
          onDismiss={exit.dismiss}
          onDiscard={exit.discard}
        />

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
        ) : actionable && task.id === 'WORK_AREA' ? (
          <ServiceAreaTask lang={lang} />
        ) : actionable && task.id === 'WORKING_HOURS' ? (
          <AvailabilityTask lang={lang} />
        ) : actionable && task.id === 'PORTFOLIO' ? (
          <PublicProfileTask lang={lang} />
        ) : actionable && task.id === 'REVIEW_SUBMISSION' ? (
          <ReviewTask lang={lang} />
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
