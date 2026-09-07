import { useNavigate } from 'react-router';
import type { ProviderOnboardingHubTask } from '@homeservicemarketplace/contracts';

import { ProviderButton, ProviderNotice, ProviderSkeleton } from '../../provider-ui';
import { useLang } from '../../../i18n/LanguageContext';
import { useProviderOnboardingHub } from '../../../hooks/provider/useProviderOnboardingHub';
import { deriveHubView, groupTasks, nextActionTaskId } from '../hub-view-state';
import {
  SCREEN_COPY,
  groupLabel,
  nextActionLabel,
  progressLabel,
  type Lang,
} from '../copy/onboarding-hub-copy';
import { HubTaskRow } from './HubTaskRow';
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
  const { lang: rawLang, dir } = useLang();
  const lang = (rawLang === 'ar' ? 'ar' : 'en') as Lang;
  const navigate = useNavigate();

  const query = useProviderOnboardingHub();
  const errorStatus = query.error?.response?.status ?? null;
  const view = deriveHubView({
    isFetched: query.isFetched,
    data: query.data,
    errorStatus,
  });

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

  // ── States with nothing to work on ────────────────────────────────────────
  if (!view.showsTasks) {
    const onCta = () => {
      if (view.state === 'ERROR') return void query.refetch();
      if (view.state === 'UNAUTHORIZED')
        return navigate('/login', { state: { returnTo: '/provider/onboarding' } });
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
              <h2 className="break-words text-[18px] font-bold text-pv-text">{screen.title}</h2>
              <p className="max-w-[46ch] break-words text-[14px] text-pv-muted">{screen.body}</p>
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
  const groups = groupTasks(tasks);
  const target = ctaTarget({ nextAction: data!.nextAction, tasks });
  const ctaLabel = nextActionLabel(data!.nextAction?.kind ?? 'NONE', lang);

  // Full width on a phone, sized to its label past that.
  //
  // Once the 430px frame came off, `fullWidth` became a 768px-wide primary
  // button on desktop — a control whose size implied an importance nothing
  // else on the screen had, and a click target that spanned the window.
  const footer =
    ctaLabel && target ? (
      <div className="flex justify-end">
        <ProviderButton
          className="w-full md:w-auto md:min-w-[220px]"
          onClick={() => openTask(target)}
        >
          {ctaLabel}
        </ProviderButton>
      </div>
    ) : null;

  return (
    <OnboardingShell title={title} subtitle={subtitle} onClose={backToProfile} footer={footer}>
      {view.state === 'ACTION_REQUIRED' ? (
        <div className="mb-4" data-testid="hub-state-ACTION_REQUIRED">
          <ProviderNotice
            tone="blocked"
            title={SCREEN_COPY[lang].ACTION_REQUIRED.title}
            description={SCREEN_COPY[lang].ACTION_REQUIRED.body}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-5" data-testid="hub-task-list">
        {groups.map(({ group, tasks: groupTaskList }) => (
          <section key={group} aria-labelledby={`hub-group-${group}`}>
            {/* Sentence case at a readable size, not 11px tracked-out caps.
                The baseline's group labels were decoration that happened to
                contain words: too small to scan and too light to read, which
                is a poor trade for the one thing that tells a provider how the
                application is organised. */}
            <h2
              id={`hub-group-${group}`}
              className="mb-2 break-words text-[15px] font-semibold text-pv-muted"
            >
              {groupLabel(group, lang)}
            </h2>
            <div className="flex flex-col gap-2">
              {groupTaskList.map((task) => (
                <HubTaskRow key={task.id} task={task} lang={lang} dir={dir} onOpen={openTask} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </OnboardingShell>
  );
}
