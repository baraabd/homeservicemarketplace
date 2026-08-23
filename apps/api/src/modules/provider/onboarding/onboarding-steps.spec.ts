import {
  PROVIDER_ONBOARDING_FIELDS,
  PROVIDER_ONBOARDING_STEPS,
  type ProviderOnboardingIssue,
} from '@homeservicemarketplace/contracts';

import { computeProgress, fieldsForStep, resumeStep, stepForField } from './onboarding-steps';

// Sprint 8 — the wizard as the server understands it.
//
// The load-bearing property is that progress is derived from the SAME issue
// list submission is judged on. Everything else here follows from that: if the
// two could disagree, a provider would see nine green ticks above a Submit
// button that 422s.

const REQUIRED = (field: string): ProviderOnboardingIssue =>
  ({ field, code: 'REQUIRED' }) as ProviderOnboardingIssue;

describe('the step/field mapping', () => {
  it('claims every field the completeness policy can complain about', () => {
    // A field owned by NO step is permanently invisible: the provider is
    // blocked from submitting by an issue with no screen to fix it on. This is
    // the test that catches someone adding a policy rule and forgetting the UI.
    const claimed = PROVIDER_ONBOARDING_STEPS.flatMap((step) => [...fieldsForStep(step)]);
    const unclaimed = PROVIDER_ONBOARDING_FIELDS.filter((f) => !claimed.includes(f));

    expect(unclaimed).toEqual([]);
  });

  it('claims each field exactly once', () => {
    // A field in two steps shows the same error twice and marks both steps
    // incomplete for one mistake.
    const claimed = PROVIDER_ONBOARDING_STEPS.flatMap((step) => [...fieldsForStep(step)]);
    const duplicates = claimed.filter((f, i) => claimed.indexOf(f) !== i);

    expect(duplicates).toEqual([]);
  });

  it('claims nothing the policy cannot produce', () => {
    // The reverse drift: a step waiting on a field no rule ever emits is a
    // step that can never be completed.
    const claimed = PROVIDER_ONBOARDING_STEPS.flatMap((step) => [...fieldsForStep(step)]);
    const unknown = claimed.filter(
      (f) => !(PROVIDER_ONBOARDING_FIELDS as readonly string[]).includes(f),
    );

    expect(unknown).toEqual([]);
  });

  it('gives REVIEW no requirements of its own', () => {
    // REVIEW reads back what the other steps collected. Owning a requirement
    // would mean there is something only answerable on the summary screen.
    expect(fieldsForStep('REVIEW')).toEqual([]);
  });

  it('resolves a field to its owning step', () => {
    expect(stepForField('bio')).toBe('PROFILE');
    expect(stepForField('availability')).toBe('AVAILABILITY');
    expect(stepForField('nonsense')).toBeNull();
  });
});

describe('computeProgress', () => {
  it('reports every step complete and 100% for a finished application', () => {
    const progress = computeProgress([], 'DRAFT');

    expect(progress.completedSteps).toEqual([...PROVIDER_ONBOARDING_STEPS]);
    expect(progress.percentComplete).toBe(100);
    expect(progress.nextAction).toEqual({ kind: 'SUBMIT' });
  });

  it('reports 0% and points at the first step for an empty application', () => {
    const progress = computeProgress(
      PROVIDER_ONBOARDING_FIELDS.map((f) => REQUIRED(f)),
      'NOT_STARTED',
    );

    expect(progress.completedSteps).toEqual([]);
    expect(progress.percentComplete).toBe(0);
    expect(progress.nextAction).toEqual({ kind: 'COMPLETE_STEP', step: 'PROVIDER_TYPE' });
  });

  it('files each issue against the step responsible for collecting it', () => {
    const progress = computeProgress([REQUIRED('bio'), REQUIRED('availability')]);

    const profile = progress.steps.find((s) => s.step === 'PROFILE');
    const availability = progress.steps.find((s) => s.step === 'AVAILABILITY');
    const identity = progress.steps.find((s) => s.step === 'IDENTITY');

    expect(profile?.issues).toEqual([REQUIRED('bio')]);
    expect(availability?.issues).toEqual([REQUIRED('availability')]);
    expect(identity?.complete).toBe(true);
  });

  it('marks REVIEW incomplete while ANY earlier step is', () => {
    // Reading back an incomplete application is not a completed review, and a
    // green tick on the last step next to a dead Submit button is the single
    // most confusing thing this screen could show.
    const progress = computeProgress([REQUIRED('bio')]);

    expect(progress.steps.find((s) => s.step === 'REVIEW')?.complete).toBe(false);
    expect(progress.completedSteps).not.toContain('REVIEW');
  });

  it('marks REVIEW complete once everything before it is', () => {
    expect(computeProgress([]).steps.find((s) => s.step === 'REVIEW')?.complete).toBe(true);
  });

  it('rounds percentComplete to whole numbers', () => {
    // Nine steps divide badly. Rounding once here is what stops two clients
    // showing 55% and 56% for the same application.
    const progress = computeProgress([REQUIRED('bio')]);

    expect(Number.isInteger(progress.percentComplete)).toBe(true);
    // bio breaks PROFILE, and REVIEW follows it down: 7 of 9.
    expect(progress.percentComplete).toBe(78);
  });

  it('keeps an unmapped issue VISIBLE rather than dropping it', () => {
    // Defence in depth behind the mapping test above. If a rule is ever added
    // with no owning step, the provider must still be told why they cannot
    // submit — a silently swallowed issue is a dead Submit button with no
    // explanation anywhere on screen.
    const progress = computeProgress([REQUIRED('someFutureRule')]);

    expect(progress.steps.find((s) => s.step === 'REVIEW')?.issues).toEqual([
      REQUIRED('someFutureRule'),
    ]);
  });

  it('points at the FIRST gap, not the furthest step reached', () => {
    // A provider who skipped step 2 and filled step 5 is blocked by step 2, so
    // that is where "continue" has to take them.
    const progress = computeProgress([REQUIRED('displayName'), REQUIRED('bio')]);

    expect(progress.nextAction).toEqual({ kind: 'COMPLETE_STEP', step: 'IDENTITY' });
    expect(resumeStep(progress.steps)).toBe('IDENTITY');
  });

  it('resumes at REVIEW when nothing is outstanding', () => {
    expect(resumeStep(computeProgress([]).steps)).toBe('REVIEW');
  });
});

describe('computeProgress — lifecycle state outranks completeness', () => {
  it('tells a SUBMITTED applicant to wait, not to edit', () => {
    // An application in the queue is not waiting on the provider. Telling them
    // otherwise invites them to withdraw a queued application to fix nothing.
    const progress = computeProgress([REQUIRED('bio')], 'SUBMITTED');
    expect(progress.nextAction).toEqual({ kind: 'AWAIT_REVIEW' });
  });

  it('tells a DOCUMENTS_REQUIRED applicant to send documents', () => {
    // Where a valid submission lands. It grants nothing, and the next action
    // says so out loud — that is the entire reason it is a distinct state
    // rather than a flavour of SUBMITTED.
    const progress = computeProgress([], 'DOCUMENTS_REQUIRED');
    expect(progress.nextAction).toEqual({ kind: 'UPLOAD_DOCUMENTS' });
  });

  it('has nothing for an ACCEPTED applicant to do here', () => {
    expect(computeProgress([], 'ACCEPTED').nextAction).toEqual({ kind: 'NONE' });
  });

  it('sends a RETURNED applicant back to the first gap', () => {
    // RETURNED is not a conduct decision. The applicant is in good standing
    // and the application is editable, so "nothing to do" would leave them
    // waiting on a queue they are not in.
    const progress = computeProgress([REQUIRED('bio')], 'RETURNED');
    expect(progress.nextAction).toEqual({ kind: 'COMPLETE_STEP', step: 'PROFILE' });
  });

  it('still reports accurate per-step progress while SUBMITTED', () => {
    // Only nextAction is overridden. The step list stays truthful so the
    // read-only review screen shows what was actually submitted.
    const progress = computeProgress([REQUIRED('bio')], 'SUBMITTED');
    expect(progress.steps.find((s) => s.step === 'PROFILE')?.complete).toBe(false);
    expect(progress.steps.find((s) => s.step === 'IDENTITY')?.complete).toBe(true);
  });
});
