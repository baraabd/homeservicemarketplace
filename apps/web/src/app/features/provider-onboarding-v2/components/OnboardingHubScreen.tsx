import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { CircleCheck } from 'lucide-react';
import type {
  ProviderOnboardingHubGroup,
  ProviderOnboardingHubTask,
} from '@homeservicemarketplace/contracts';

import { useStaleRoleRecovery } from '../session/useStaleRoleRecovery';

import { ProviderButton, ProviderNotice, ProviderSkeleton } from '../../provider-ui';
import { useLang } from '../../../i18n/LanguageContext';
import { useProviderOnboardingHub } from '../../../hooks/provider/useProviderOnboardingHub';
import { deriveHubView, nextActionTaskId } from '../hub-view-state';
import {
  HUB_COMPLETE_NOTICE,
  HUB_LEAD,
  SCREEN_COPY,
  groupLabel,
  nextActionLabel,
  progressLabel,
  sectionOf,
  type Lang,
} from '../copy/onboarding-hub-copy';
import { HubTaskRow } from './HubTaskRow';
import { OnboardingAlert } from './OnboardingAlert';
import { OnboardingShell } from './OnboardingShell';

// Sprint 9B.16 — the resumable hub.
//
// It renders the server's answer and computes nothing about readiness. In
// particular it does NOT count completed tasks: `progress.complete` and
// `progress.total` arrive from the server, so a task the server chose to leave
// out of the count (an optional one) stays out of it here, and the client can
// never claim a different number from the API it is about to call.
//
// The hub is not itself a task. It has no row, it is not in `tasks`, and it
// never appears in the count.

/** Where the primary CTA goes.
 *
 *  COMPLETE_TASK names its own target. SUBMIT does not — submission lives on
 *  the REVIEW task, so that is what the button opens; if the server sends no
 *  review task there is nothing to open and no button is rendered rather than
 *  a guess. AWAIT_REVIEW and NONE have no destination by definition. */
function ctaTarget(view: {
  nextAction: { kind: string; taskId?: string } | undefined;
  tasks: ProviderOnboardingHubTask[];
}): string | null {
  const kind = view.nextAction?.kind;
  if (kind === 'COMPLETE_TASK') {
    return nextActionTaskId(
      view.nextAction as { kind: 'COMPLETE_TASK'; taskId: string },
      view.tasks,
    );
  }
  if (kind === 'SUBMIT') {
    return view.tasks.find((t) => t.group === 'REVIEW')?.id ?? null;
  }
  return null;
}

export function OnboardingHubScreen() {
  const { lang: rawLang } = useLang();
  const lang = (rawLang === 'ar' ? 'ar' : 'en') as Lang;
  const navigate = useNavigate();

  const query = useProviderOnboardingHub();
  const errorStatus = query.error?.response?.status ?? null;
  const view = deriveHubView({
    isFetched: query.isFetched,
    data: query.data,
    errorStatus,
  });

  // Sprint 9B.29 — the post-upgrade stale-role transition, recovered once.
  //
  // Scoped to `FORBIDDEN` rather than to any failure: this rotates the session,
  // and doing that for a 500 or a network blip would log providers out of
  // problems that have nothing to do with their token. On success the hub query
  // is refetched by name — the hook does not guess which query was refused.
  const refetchHub = useCallback(() => {
    void query.refetch();
  }, [query]);
  const recovery = useStaleRoleRecovery(view.state === 'FORBIDDEN', refetchHub);

  const data = query.data;
  const screen = SCREEN_COPY[lang][view.state];
  const backToProfile = () => navigate('/provider');
  const openTask = (taskId: string) => navigate(`/provider/onboarding/${taskId}`);

  // The header's second line. Only the hub itself carries progress — an error
  // or a submitted application has no meaningful count to show, and printing
  // "0 of 6" over an error would read as data loss.
  const subtitle =
    view.showsTasks && data
      ? progressLabel(data.progress.complete, data.progress.total, lang)
      : null;

  const title = view.showsTasks ? SCREEN_COPY[lang].HUB.title : screen.title;

  /** The 4px rule under the header. The SERVER's counters, as a percentage. */
  const progress =
    view.showsTasks && data && data.progress.total > 0
      ? Math.round((data.progress.complete / data.progress.total) * 100)
      : undefined;

  // ── States with nothing to work on ────────────────────────────────────────
  if (!view.showsTasks) {
    const onCta = () => {
      if (view.state === 'ERROR') return void query.refetch();
      if (view.state === 'UNAUTHORIZED')
        return navigate('/login', { state: { returnTo: '/provider/onboarding' } });
      // Sprint 9B.29 — a 403 is NOT a sign-in problem, so its CTA does not go
      // to /login. The automatic recovery has already run once by the time this
      // is pressable; this hands the provider the same rotation deliberately.
      if (view.state === 'FORBIDDEN') {
        recovery.retry();
        return;
      }
      return backToProfile();
    };

    return (
      <OnboardingShell title={title} onClose={backToProfile}>
        <div
          className="flex flex-col items-center justify-center gap-3 py-10 text-center"
          data-testid={`hub-state-${view.state}`}
          // Announced, so a state change that replaces the whole screen is not
          // silent for a screen-reader user.
          role="status"
          aria-live="polite"
        >
          {view.state === 'LOADING' ? (
            <div className="w-full" data-testid="hub-loading-spinner">
              {/* A skeleton the size of the task list, not a spinner in the
                  place content will appear: it says what is coming and stops
                  the layout jumping when it arrives. */}
              <span className="sr-only">{screen.title}</span>
              <ProviderSkeleton rows={4} />
            </div>
          ) : (
            <>
              <h2 className="break-words text-pv-title font-bold text-pv-text">{screen.title}</h2>
              <p className="max-w-[46ch] break-words text-pv-body text-pv-muted">{screen.body}</p>
              {screen.cta ? (
                <ProviderButton className="mt-2 min-w-[220px]" onClick={onCta}>
                  {screen.cta}
                </ProviderButton>
              ) : null}
            </>
          )}
        </div>
      </OnboardingShell>
    );
  }

  // ── The hub ───────────────────────────────────────────────────────────────
  const tasks = data!.tasks;
  const target = ctaTarget({ nextAction: data!.nextAction, tasks });

  /**
   * The SECTIONS the approved hub draws, in the server's task order.
   *
   * Four rather than the server's five: Review sits under the same heading as
   * the profile tasks (see `sectionOf`). Merged by walking the tasks in order
   * and starting a new section only when the SECTION changes, so a group the
   * server splits and re-opens would still be drawn where it sent it.
   */
  const sections: { section: ProviderOnboardingHubGroup; tasks: ProviderOnboardingHubTask[] }[] =
    [];
  for (const task of tasks) {
    const section = sectionOf(task.group);
    const current = sections[sections.length - 1];
    if (current && current.section === section) current.tasks.push(task);
    else sections.push({ section, tasks: [task] });
  }

  /**
   * Has the provider finished everything that is theirs to finish?
   *
   * The SERVER's counters, never a count of rows. The approved design draws
   * two different hubs: a partial one that opens with an instruction and
   * groups the work into sections, and a complete one that opens with a
   * success banner and lists the six rows flat. Sections orient someone who
   * still has work to do; once there is none they are a heading over a
   * finished checklist.
   */
  const allDone = data!.progress.total > 0 && data!.progress.complete >= data!.progress.total;

  // The approved label names its destination — "Start: Your services" — and
  // takes the section from the group of the task the SERVER nominated.
  const targetTask = target ? tasks.find((t) => t.id === target) : undefined;
  const ctaLabel = nextActionLabel(
    data!.nextAction?.kind ?? 'NONE',
    lang,
    targetTask ? groupLabel(sectionOf(targetTask.group), lang) : undefined,
  );

  // The approved hub's action is full width in its bar at every size: this is
  // the focused application column, not the workspace, and the column itself
  // is already capped at 480px.
  const footer =
    ctaLabel && target ? (
      <ProviderButton
        tone="primary"
        shape="onboarding"
        size="block"
        onClick={() => openTask(target)}
        data-testid="hub-primary-action"
      >
        {ctaLabel}
      </ProviderButton>
    ) : null;

  return (
    <OnboardingShell
      title={title}
      subtitle={subtitle}
      progress={progress}
      onClose={backToProfile}
      footer={footer}
    >
      {/* `.hsm-main-tight`: a 12px column, which is what the two hubs use. */}
      <div className="flex flex-col gap-3">
        {view.state === 'ACTION_REQUIRED' ? (
          <div data-testid="hub-state-ACTION_REQUIRED">
            <ProviderNotice
              tone="blocked"
              title={SCREEN_COPY[lang].ACTION_REQUIRED.title}
              description={SCREEN_COPY[lang].ACTION_REQUIRED.body}
            />
          </div>
        ) : null}

        {/* One of two openings, never both: an instruction while there is work
            to do, a success banner once there is not. */}
        {allDone ? (
          <OnboardingAlert
            tone="success"
            icon={CircleCheck}
            title={HUB_COMPLETE_NOTICE[lang].title}
            body={HUB_COMPLETE_NOTICE[lang].body}
            density="compact"
            data-testid="hub-complete-notice"
          />
        ) : (
          // `.hsm-lead`: pulled up 8px against the column's own 20px inset,
          // exactly as the reference has it.
          <p className="-mt-2 break-words text-pv-body leading-[1.75] text-pv-muted">
            {HUB_LEAD[lang]}
          </p>
        )}

        {/* `.hsm-task-group`: ONE 8px grid holding the section titles and the
            rows together, rather than a list of separately spaced sections.
            The titles are grid items, which is why the spacing above a title
            and above a row is the same. */}
        <div className="grid gap-2" data-testid="hub-task-list">
          {sections.map(({ section, tasks: sectionTasks }) => (
            <section key={section} aria-labelledby={`hub-group-${section}`} className="grid gap-2">
              {/* Hidden on the complete hub, where every row is done and the
                  heading would be a label over a finished checklist. Kept in
                  the accessibility tree either way, so the list never loses
                  its structure for a screen-reader user. */}
              <h2
                id={`hub-group-${section}`}
                className={
                  allDone
                    ? 'sr-only'
                    : // `.hsm-group-title`: `margin: 6px 2px 2px`, 13px, 700.
                      // The 2px BOTTOM margin is load-bearing: it sits on top
                      // of the grid's own 8px gap, so dropping it made every
                      // section 2px short and the error accumulated down the
                      // list — 14px by the last row.
                      // `leading-[21px]` for the same reason the field label
                      // needs it: this is an `h2`, and the base layer gives
                      // every heading a 1.5 RATIO, which at 13px is 19.5px.
                      // Two pixels per section, four sections, and the last
                      // row of the hub sat 6px high of the reference.
                      'mx-0.5 mb-0.5 mt-1.5 break-words text-pv-label font-bold leading-[21px] text-pv-muted'
                }
              >
                {groupLabel(section, lang)}
              </h2>
              {sectionTasks.map((task) => (
                <HubTaskRow key={task.id} task={task} lang={lang} onOpen={openTask} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </OnboardingShell>
  );
}
