import type { ProviderOnboardingIssue } from '@homeservicemarketplace/contracts';
import {
  PROVIDER_ONBOARDING_STEPS,
  type ProviderOnboardingStep,
} from '@homeservicemarketplace/contracts';

// Sprint 8 — the wizard, as the SERVER understands it.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// The client renders steps; it does not decide what they mean. This module is
// the single place that answers:
//
//   - which requirements belong to which step
//   - which steps are complete
//   - how far through the provider is
//   - what they should do next
//
// All four are computed from the SAME issue list the completeness policy
// produces for submission. That is the whole point: if the wizard derived
// progress independently, a provider could see nine green ticks and a Submit
// button that 422s, which is precisely the failure Phase 4 introduced the
// policy to prevent.
//
// Pure. No Prisma, no Nest, no clock — it maps an issue list onto a step list.

/** Which completeness requirements each step is responsible for collecting.
 *
 *  Every field the policy can complain about appears exactly once. A field in
 *  no step would be permanently invisible: the provider would be blocked from
 *  submitting by an issue with no screen to fix it on. A field in two steps
 *  would show the same error twice and mark both steps incomplete for one
 *  mistake, so the mapping is checked by a test rather than trusted. */
const STEP_FIELDS: Record<ProviderOnboardingStep, readonly string[]> = {
  // Individual or business. First because it changes what later steps ask for.
  PROVIDER_TYPE: ['providerType', 'legalBusinessName'],
  // Who they are and how to reach them.
  IDENTITY: ['displayName', 'phoneNumber', 'emailVerified'],
  // Where they work.
  LOCATION: ['serviceAreaCity', 'serviceAreaCountry', 'serviceAreaRadiusKm'],
  // What they do. `serviceCategories` is the legacy grant count; `specialties`
  // is the Sprint 8 leaf requirement. Both live here because both are answered
  // by the same screen.
  SPECIALTIES: ['serviceCategories', 'specialties'],
  // How long they have done it, and what they bring.
  EXPERIENCE: ['yearsOfExperience'],
  // When they work.
  AVAILABILITY: ['availability'],
  // How they describe themselves.
  PROFILE: ['headline', 'bio'],
  // What they agreed to, and when.
  CONSENT: ['consent'],
  // Nothing of its own. REVIEW is where the provider reads back what every
  // other step collected, so it owns no requirement and is complete exactly
  // when everything before it is.
  REVIEW: [],
};

export interface StepView {
  step: ProviderOnboardingStep;
  /** No unmet requirement belongs to this step. */
  complete: boolean;
  /** The unmet requirements this step is responsible for, so the UI can show
   *  them against the step in the sidebar without re-partitioning the list. */
  issues: ProviderOnboardingIssue[];
}

export type OnboardingNextAction =
  | { kind: 'COMPLETE_STEP'; step: ProviderOnboardingStep }
  | { kind: 'SUBMIT' }
  | { kind: 'AWAIT_REVIEW' }
  | { kind: 'UPLOAD_DOCUMENTS' }
  | { kind: 'NONE' };

export interface OnboardingProgress {
  steps: StepView[];
  /** Steps with no unmet requirement, in wizard order. Server-computed and
   *  never client-asserted — a client that can mark its own steps complete can
   *  mark itself finished. */
  completedSteps: ProviderOnboardingStep[];
  /** 0-100, whole numbers. Rendered as a bar, so it is computed once here
   *  rather than by each client with its own rounding. */
  percentComplete: number;
  nextAction: OnboardingNextAction;
}

/**
 * Partition the completeness policy's issues across the wizard.
 *
 * `state` is the provider's onboarding lifecycle state (Sprint 7 axis). It
 * only affects `nextAction`: once an application is submitted, "what should I
 * do next" stops being "fill in step 4" and becomes "wait" or "send us your
 * documents", regardless of what the issue list says.
 */
export function computeProgress(
  issues: readonly ProviderOnboardingIssue[],
  state?: string | null,
): OnboardingProgress {
  const byStep = new Map<ProviderOnboardingStep, ProviderOnboardingIssue[]>(
    PROVIDER_ONBOARDING_STEPS.map((step) => [step, []]),
  );

  for (const issue of issues) {
    const step = stepForField(issue.field);
    // An issue whose field belongs to no step is a policy rule someone added
    // without a screen to fix it on. Attaching it to REVIEW keeps it VISIBLE —
    // the provider sees the blocker on the last screen rather than being
    // silently unable to submit — and the mapping test fails loudly in CI.
    byStep.get(step ?? 'REVIEW')?.push(issue);
  }

  const steps: StepView[] = PROVIDER_ONBOARDING_STEPS.map((step) => {
    const stepIssues = byStep.get(step) ?? [];
    return { step, complete: stepIssues.length === 0, issues: stepIssues };
  });

  // REVIEW is complete only when every step before it is. Reading back an
  // incomplete application is not a completed review.
  const reviewIndex = steps.findIndex((s) => s.step === 'REVIEW');
  if (reviewIndex >= 0 && steps.slice(0, reviewIndex).some((s) => !s.complete)) {
    steps[reviewIndex] = { ...steps[reviewIndex], complete: false };
  }

  const completedSteps = steps.filter((s) => s.complete).map((s) => s.step);
  const percentComplete = Math.round(
    (completedSteps.length / PROVIDER_ONBOARDING_STEPS.length) * 100,
  );

  return {
    steps,
    completedSteps,
    percentComplete,
    nextAction: nextAction(steps, state),
  };
}

/** The step that owns a completeness field, or null if none does. */
export function stepForField(field: string): ProviderOnboardingStep | null {
  for (const step of PROVIDER_ONBOARDING_STEPS) {
    if (STEP_FIELDS[step].includes(field)) return step;
  }
  return null;
}

/** The fields a step owns. Exported for the mapping test, which asserts every
 *  policy field is claimed exactly once. */
export function fieldsForStep(step: ProviderOnboardingStep): readonly string[] {
  return STEP_FIELDS[step];
}

/** Where to resume. The FIRST incomplete step, not the furthest reached: a
 *  provider who skipped step 2 and filled step 5 should be sent back to the
 *  gap, because that is what is blocking them. */
export function resumeStep(steps: readonly StepView[]): ProviderOnboardingStep {
  return steps.find((s) => !s.complete)?.step ?? 'REVIEW';
}

function nextAction(steps: readonly StepView[], state?: string | null): OnboardingNextAction {
  // Lifecycle state wins over completeness. An application already in review
  // is not waiting on the provider to fill in a field, and telling them
  // otherwise invites them to withdraw a queued application to fix nothing.
  switch (state) {
    case 'SUBMITTED':
      return { kind: 'AWAIT_REVIEW' };
    case 'DOCUMENTS_REQUIRED':
      // The state Sprint 8 submission transitions to. It grants nothing and it
      // is not approval — the provider still has work to do, and saying so is
      // the entire reason it is a distinct state rather than a flavour of
      // SUBMITTED.
      return { kind: 'UPLOAD_DOCUMENTS' };
    case 'ACCEPTED':
      return { kind: 'NONE' };
    // NOT_STARTED, DRAFT and RETURNED all fall through to the completeness
    // answer. RETURNED especially: an application sent back for changes is
    // editable and in good standing, so the right next action is the first
    // thing still missing — telling a returned applicant "nothing to do" is
    // how they end up waiting on a queue they are not in.
    default:
      break;
  }

  const incomplete = steps.find((s) => !s.complete);
  return incomplete ? { kind: 'COMPLETE_STEP', step: incomplete.step } : { kind: 'SUBMIT' };
}
