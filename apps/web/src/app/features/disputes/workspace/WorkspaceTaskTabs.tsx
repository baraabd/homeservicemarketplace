import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { FileText, Gavel, History, MessagesSquare, Scale, ShieldAlert } from 'lucide-react';
import { WORKSPACE_COPY } from './copy';
import {
  DISPUTE_WORKSPACE_TASK_IDS,
  parseDisputeTask,
  type DisputeWorkspaceTaskId,
} from './dispute-task-navigation';
import './workspace-task-tabs.css';

// Sprint 12D — the Admin dispute workspace as six real tabs.
//
// The page it replaces rendered every section in one column and offered four
// `href="#case-…"` links above them. Those links scrolled; they never reduced
// what was on screen. A reviewer deciding a case had the proposal, the private
// evidence, the timeline and the source facts competing for the same attention,
// and the anchor row looked like navigation while behaving like a table of
// contents.
//
// This is presentation only. Radix owns the roving focus, the arrow/Home/End
// keys and the tab/panel relationships; the server still owns which commands
// exist, and `availableActions` is read exactly where it was read before.

const ActiveTask = createContext<DisputeWorkspaceTaskId | null>(null);

const ICONS: Record<DisputeWorkspaceTaskId, typeof FileText> = {
  overview: FileText,
  information: MessagesSquare,
  evidence: ShieldAlert,
  solutions: Scale,
  appeals: Gavel,
  history: History,
};

function labels(lang: 'en' | 'ar'): Record<DisputeWorkspaceTaskId, string> {
  const t = WORKSPACE_COPY[lang];
  return {
    overview: t.facts,
    information: t.information,
    evidence: t.evidence,
    solutions: t.solutions,
    appeals: t.appeals,
    history: t.history,
  };
}

export function WorkspaceTaskTabs({
  value,
  onValueChange,
  lang,
  counts,
  focusLinkedPanel,
  children,
}: {
  value: DisputeWorkspaceTaskId;
  onValueChange: (task: DisputeWorkspaceTaskId) => void;
  lang: 'en' | 'ar';
  /** Server-derived counts. Absent or zero renders no badge at all. */
  counts?: Partial<Record<DisputeWorkspaceTaskId, number>>;
  /** True when the selection came from a legacy `#case-…` link. */
  focusLinkedPanel?: boolean;
  children: ReactNode;
}) {
  const t = WORKSPACE_COPY[lang];
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const sequentialNavigation = useRef(false);
  const index = DISPUTE_WORKSPACE_TASK_IDS.indexOf(value);
  const TASK_LABELS = labels(lang);

  useEffect(() => {
    if (!focusLinkedPanel) return;
    // Runs after the route's own heading focus and after the panel is visible.
    const frame = requestAnimationFrame(() => {
      const panel = root.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
      panel?.focus({ preventScroll: true });
      panel?.scrollIntoView?.({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusLinkedPanel, value]);

  useEffect(() => {
    // Previous/next move the reviewer through sections; the trigger must take
    // focus so the keyboard does not fall back to the top of the document.
    if (!sequentialNavigation.current) return;
    sequentialNavigation.current = false;
    root.current
      ?.querySelector<HTMLElement>(`[data-testid="case-tab-${value}"]`)
      ?.focus({ preventScroll: true });
    root.current?.scrollIntoView?.({ block: 'start' });
  }, [value]);

  function moveTo(next: number) {
    const task = DISPUTE_WORKSPACE_TASK_IDS[next];
    if (!task) return;
    sequentialNavigation.current = true;
    onValueChange(task);
  }

  return (
    <ActiveTask.Provider value={value}>
      <Tabs.Root
        ref={root}
        value={value}
        onValueChange={(next) => {
          const task = parseDisputeTask(next);
          if (task) onValueChange(task);
        }}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        activationMode="automatic"
        className="case-stack cw-tabs"
        data-testid="case-task-tabs"
        data-dispute-workspace-layout="tabbed-v1"
      >
        <div className="case-card cw-tabs-header">
          <div className="case-summary cw-tabs-summary">
            <h2 className="cw-tabs-title" id={`${id}-title`}>
              {t.sections}
            </h2>
            <span className="case-muted cw-tab-position">
              {t.tabsSection} {(index + 1).toLocaleString(lang)} {t.tabsOf}{' '}
              {DISPUTE_WORKSPACE_TASK_IDS.length.toLocaleString(lang)}
            </span>
          </div>
          <Tabs.List className="cw-tab-list" aria-labelledby={`${id}-title`}>
            {DISPUTE_WORKSPACE_TASK_IDS.map((task) => {
              const Icon = ICONS[task];
              const count = counts?.[task] ?? 0;
              return (
                <Tabs.Trigger
                  key={task}
                  value={task}
                  className="cw-tab"
                  data-testid={`case-tab-${task}`}
                  aria-label={TASK_LABELS[task]}
                  aria-describedby={count ? `${id}-${task}-count` : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{TASK_LABELS[task]}</span>
                  {count > 0 && (
                    <span className="cw-tab-count" id={`${id}-${task}-count`}>
                      {/* Text, not colour alone, carries the meaning. */}
                      <span className="cw-visually-hidden">{TASK_LABELS[task]}: </span>
                      {count.toLocaleString(lang)}
                    </span>
                  )}
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
          <p className="case-muted cw-tabs-hint">{t.tabsHint}</p>
        </div>
        {children}
        <div className="cw-tab-actions">
          <button
            type="button"
            className="case-button"
            disabled={index <= 0}
            onClick={() => moveTo(index - 1)}
          >
            {t.tabsPrevious}
          </button>
          <button
            type="button"
            className="case-button"
            disabled={index >= DISPUTE_WORKSPACE_TASK_IDS.length - 1}
            onClick={() => moveTo(index + 1)}
          >
            {t.tabsNext}
          </button>
        </div>
      </Tabs.Root>
    </ActiveTask.Provider>
  );
}

/**
 * Keep inactive sections MOUNTED so unsent text, open disclosures and in-flight
 * component state survive a tab change; `hidden` removes them from layout, from
 * the accessibility tree and from sequential focus.
 *
 * Outside a `WorkspaceTaskTabs` (the participant layout) this renders its
 * children unchanged, so the existing Seeker/Provider journey is untouched.
 */
export function WorkspaceTaskPanel({
  task,
  children,
}: {
  task: DisputeWorkspaceTaskId;
  children: ReactNode;
}) {
  const selected = useContext(ActiveTask);
  if (!selected) return <>{children}</>;
  return (
    <Tabs.Content
      value={task}
      forceMount
      hidden={selected !== task}
      tabIndex={selected === task ? 0 : -1}
      className="cw-tab-panel"
      data-testid={`case-panel-${task}`}
    >
      {children}
    </Tabs.Content>
  );
}
