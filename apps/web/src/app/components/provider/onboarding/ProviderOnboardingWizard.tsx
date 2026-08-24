import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  WifiOff,
} from 'lucide-react';
import type {
  ProviderOnboardingDraftView,
  ProviderOnboardingStep,
  ProviderTransportModeCode,
  ProviderTypeCode,
} from '@homeservicemarketplace/contracts';
import { PROVIDER_ONBOARDING_STEPS } from '@homeservicemarketplace/contracts';

import { useLang } from '../../../i18n/LanguageContext';
import { useEquipmentCatalog, useServiceCategories } from '../../../../lib/use-service-categories';
import {
  useOnboardingDraft,
  useOnboardingStepAutosave,
  useSubmitOnboarding,
  useWithdrawOnboarding,
} from '../../../hooks/provider/useProviderOnboarding';
import { ChipToggles, ChoiceGroup, TextAreaField, TextField } from './WizardFields';
import {
  DAY_LABELS,
  STEP_HINTS,
  STEP_TITLES,
  TRANSPORT_LABELS,
  UI,
  issueText,
  minuteToTime,
  timeToMinute,
} from './wizard-copy';

// Sprint 8 — the provider onboarding wizard.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// Nine steps in the existing FixNow provider visual language: the same
// gradient hero, the same rounded-3xl cards on slate-50, the same blue-600
// accents, dark: throughout, logical properties so RTL mirrors without a
// second stylesheet. No new design, deliberately — this is a new surface in an
// established app, not a redesign of it.
//
// THE ONE RULE THIS COMPONENT FOLLOWS THROUGHOUT
//
// The server decides. Progress, which steps are done, what is missing, where
// to resume, and what to do next all arrive in the response and are RENDERED,
// never recomputed. A client with its own copy of the completeness rules is
// how a Submit button ends up enabled and then 422-ing, which is the failure
// the whole server-side policy exists to prevent.
//
// Everything below is therefore presentation plus one piece of genuine client
// state: the local form buffer, which exists so typing is not a round-trip.

/** The transport codes, in the order the step offers them. */
const TRANSPORT_MODES: ProviderTransportModeCode[] = [
  'ON_FOOT',
  'MOTORCYCLE',
  'CAR',
  'VAN',
  'TRUCK',
  'PUBLIC_TRANSPORT',
];

export function ProviderOnboardingWizard() {
  const { lang } = useLang();
  const copy = UI[lang];
  const draftQuery = useOnboardingDraft();
  const view = draftQuery.data ?? null;

  // Which step the provider is LOOKING at. Distinct from the server's
  // `currentStep`, which is where they should RESUME: once the screen is open
  // they can move around, and snapping them back to the first gap on every
  // autosave would make the wizard unusable.
  //
  // Seeded from the server's resume point the first time the draft resolves,
  // then held. Set during render rather than in an effect: this is React's
  // documented "adjust state when the input changes" pattern, it re-renders
  // before committing anything to the DOM, and it is idempotent because `step`
  // is only null once.
  //
  // Reading `view.currentStep` live instead would move the screen out from
  // under someone mid-edit — the server recomputes the resume point on every
  // autosave, so finishing step 3 would silently jump them to step 4.
  const [step, setStep] = useState<ProviderOnboardingStep | null>(null);
  if (step === null && view) setStep(view.currentStep);

  const activeStep = step ?? view?.currentStep ?? 'PROVIDER_TYPE';
  const index = PROVIDER_ONBOARDING_STEPS.indexOf(activeStep);

  if (draftQuery.isLoading) {
    return (
      <WizardShell title={copy.wizardTitle}>{<LoadingBody text={copy.loading} />}</WizardShell>
    );
  }

  if (draftQuery.isError) {
    const status = draftQuery.error.response?.status;
    // 403 is a specific, explicable state: signed in, but not a provider.
    // "Please try again" would send someone retrying a thing that cannot work.
    //
    // A 401 never reaches here — the api client fires auth:session-expired and
    // the auth layer routes to login before this component can render an
    // opinion about it.
    return (
      <WizardShell title={copy.wizardTitle}>
        <ErrorBody
          text={status === 403 ? copy.notAProvider : copy.loadError}
          actionLabel={copy.retry}
          onAction={() => void draftQuery.refetch()}
        />
      </WizardShell>
    );
  }

  if (!view)
    return (
      <WizardShell title={copy.wizardTitle}>{<LoadingBody text={copy.loading} />}</WizardShell>
    );

  // A submitted application is read-only. Showing the editable form behind a
  // disabled Submit would invite a provider to change something and wonder why
  // it did not save.
  if (!view.editable) {
    return (
      <WizardShell title={copy.wizardTitle} percent={view.percentComplete}>
        <SubmittedBody view={view} />
      </WizardShell>
    );
  }

  return (
    <WizardShell title={copy.wizardTitle} percent={view.percentComplete}>
      <StepRail view={view} active={activeStep} onSelect={setStep} />
      <StepBody key={activeStep} view={view} step={activeStep} index={index} onGo={setStep} />
    </WizardShell>
  );
}

// ── shell ───────────────────────────────────────────────────────────────────

function WizardShell({
  title,
  percent,
  children,
}: {
  title: string;
  percent?: number;
  children: React.ReactNode;
}) {
  const { lang } = useLang();
  const copy = UI[lang];
  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
        <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" aria-hidden />
        <h1 className="text-white relative" style={{ fontSize: '20px', fontWeight: 800 }}>
          {title}
        </h1>
        {percent !== undefined ? (
          <div className="relative mt-3">
            <div
              className="h-2 rounded-full bg-white/20 overflow-hidden"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={copy.progress}
            >
              <div
                className="h-full rounded-full bg-white transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-white/80 mt-1.5" style={{ fontSize: '12px', fontWeight: 600 }}>
              {percent}% {copy.progress}
            </p>
          </div>
        ) : null}
      </div>
      <div className="px-4 -mt-3 z-10 relative pb-8">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 mb-4">
      {children}
    </div>
  );
}

function LoadingBody({ text }: { text: string }) {
  return (
    <Card>
      <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
        <Loader2 size={18} className="animate-spin" aria-hidden />
        <p style={{ fontSize: '13px', fontWeight: 600 }}>{text}</p>
      </div>
    </Card>
  );
}

function ErrorBody({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Card>
      <p
        role="alert"
        className="flex items-start gap-2 text-red-700 dark:text-red-400"
        style={{ fontSize: '13px', fontWeight: 600 }}
      >
        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
        {text}
      </p>
      <button
        type="button"
        onClick={onAction}
        className="mt-4 w-full py-3 rounded-2xl bg-blue-600 text-white active:scale-95 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        style={{ fontSize: '14px', fontWeight: 700 }}
      >
        {actionLabel}
      </button>
    </Card>
  );
}

/**
 * The state a valid submission lands in.
 *
 * Worded so it cannot be mistaken for approval, because it is not one — the
 * server moved the application to DOCUMENTS_REQUIRED and granted nothing. If
 * this screen said "approved" the client would be making a claim the server
 * explicitly refused to make.
 */
function SubmittedBody({ view }: { view: ProviderOnboardingDraftView }) {
  const { lang } = useLang();
  const copy = UI[lang];
  const withdraw = useWithdrawOnboarding();
  const documentsOutstanding = view.state === 'DOCUMENTS_REQUIRED';

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
          <Check size={20} className="text-emerald-600" aria-hidden />
        </span>
        <div>
          <h2
            className="text-slate-900 dark:text-slate-100"
            style={{ fontSize: '16px', fontWeight: 800 }}
          >
            {documentsOutstanding ? copy.submittedTitle : copy.awaitingTitle}
          </h2>
          <p
            className="mt-1.5 text-slate-600 dark:text-slate-300"
            style={{ fontSize: '13px', lineHeight: '1.6' }}
          >
            {documentsOutstanding ? copy.submittedBody : copy.awaitingBody}
          </p>
          {documentsOutstanding ? (
            <p
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
              style={{ fontSize: '11px', fontWeight: 700 }}
            >
              <AlertCircle size={12} aria-hidden />
              {copy.submittedNotApproved}
            </p>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={() => withdraw.mutate()}
        disabled={withdraw.isPending}
        className="mt-5 w-full py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition-all disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        style={{ fontSize: '14px', fontWeight: 700 }}
      >
        {withdraw.isPending ? copy.withdrawing : copy.withdraw}
      </button>
      {withdraw.isError ? (
        <p role="alert" className="mt-2 text-red-600" style={{ fontSize: '12px', fontWeight: 600 }}>
          {copy.saveError}
        </p>
      ) : null}
    </Card>
  );
}

// ── the step rail ───────────────────────────────────────────────────────────

/** Horizontally scrollable on mobile, wrapping on wider screens. Every step is
 *  reachable at any time: a strictly linear wizard makes fixing step 2 from
 *  step 7 a seven-click journey, and the server does not care what order the
 *  answers arrive in. */
function StepRail({
  view,
  active,
  onSelect,
}: {
  view: ProviderOnboardingDraftView;
  active: ProviderOnboardingStep;
  onSelect: (step: ProviderOnboardingStep) => void;
}) {
  const { lang } = useLang();
  const titles = STEP_TITLES[lang];

  return (
    <nav aria-label={UI[lang].wizardTitle} className="mb-4">
      <ol
        className="flex gap-2 overflow-x-auto pb-2 md:flex-wrap md:overflow-visible"
        style={{ scrollbarWidth: 'none' }}
      >
        {view.steps.map((s, i) => {
          const isActive = s.step === active;
          return (
            <li key={s.step} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(s.step)}
                aria-current={isActive ? 'step' : undefined}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                  isActive
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : s.complete
                      ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
                style={{ fontSize: '12px', fontWeight: 700 }}
              >
                {s.complete ? <Check size={13} aria-hidden /> : <span aria-hidden>{i + 1}</span>}
                {titles[s.step]}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── the save indicator ──────────────────────────────────────────────────────

function SaveIndicator({
  status,
}: {
  status: ReturnType<typeof useOnboardingStepAutosave>['status'];
}) {
  const { lang } = useLang();
  const copy = UI[lang];

  // aria-live="polite" so a screen reader hears "Saved" without the focus
  // being stolen mid-typing. "assertive" here would interrupt every few
  // seconds, which is worse than silence.
  return (
    <div aria-live="polite" className="min-h-[20px] mb-3">
      {status.kind === 'saving' ? (
        <p
          className="flex items-center gap-1.5 text-slate-500"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          <Loader2 size={12} className="animate-spin" aria-hidden />
          {copy.saving}
        </p>
      ) : null}
      {status.kind === 'saved' ? (
        <p
          className="flex items-center gap-1.5 text-emerald-600"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          <Check size={12} aria-hidden />
          {copy.saved}
        </p>
      ) : null}
      {status.kind === 'offline' ? (
        <p
          role="status"
          className="flex items-center gap-1.5 text-amber-600"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          <WifiOff size={12} aria-hidden />
          {copy.offline}
        </p>
      ) : null}
      {status.kind === 'error' ? (
        <p
          role="alert"
          className="flex items-center gap-2 text-red-600"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          <AlertCircle size={12} aria-hidden />
          {copy.saveError}
          <button
            type="button"
            onClick={status.retry}
            className="inline-flex items-center gap-1 underline outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded"
          >
            <RefreshCw size={11} aria-hidden />
            {copy.retry}
          </button>
        </p>
      ) : null}
      {status.kind === 'conflict' ? (
        <p
          role="alert"
          className="flex items-center gap-2 text-red-600"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          <AlertCircle size={12} aria-hidden />
          {copy.conflict}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="underline outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded"
          >
            {copy.reload}
          </button>
        </p>
      ) : null}
    </div>
  );
}

// ── the step bodies ─────────────────────────────────────────────────────────

function StepBody({
  view,
  step,
  index,
  onGo,
}: {
  view: ProviderOnboardingDraftView;
  step: ProviderOnboardingStep;
  index: number;
  onGo: (step: ProviderOnboardingStep) => void;
}) {
  const { lang } = useLang();
  const copy = UI[lang];
  const autosave = useOnboardingStepAutosave(step);
  const heading = useRef<HTMLHeadingElement | null>(null);

  // Move focus to the step heading on every step change. Without it a keyboard
  // or screen-reader user who presses Next lands back at the top of the
  // document and has to tab through the whole rail again to reach the form.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const stepIssues = view.steps.find((s) => s.step === step)?.issues ?? [];
  const errorFor = useCallback(
    (field: string) => {
      const issue = stepIssues.find((i) => i.field === field);
      return issue ? issueText(lang, issue.field, issue.code) : undefined;
    },
    [lang, stepIssues],
  );

  const goto = async (next: ProviderOnboardingStep) => {
    // Flush before moving. Without this, a value still resting in the debounce
    // is written AFTER the next step loads — against a version the new screen
    // has already read, which surfaces as a spurious conflict.
    await autosave.saveNow();
    onGo(next);
  };

  return (
    <Card>
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-slate-900 dark:text-slate-100 outline-none"
        style={{ fontSize: '17px', fontWeight: 800 }}
      >
        {STEP_TITLES[lang][step]}
      </h2>
      <p
        className="mt-1 mb-4 text-slate-500 dark:text-slate-400"
        style={{ fontSize: '12.5px', lineHeight: '1.6' }}
      >
        {STEP_HINTS[lang][step]}
      </p>

      <SaveIndicator status={autosave.status} />

      {step === 'PROVIDER_TYPE' ? (
        <ProviderTypeStep view={view} save={autosave.save} errorFor={errorFor} />
      ) : null}
      {step === 'IDENTITY' ? (
        <IdentityStep view={view} save={autosave.save} errorFor={errorFor} />
      ) : null}
      {step === 'LOCATION' ? (
        <LocationStep view={view} save={autosave.save} errorFor={errorFor} />
      ) : null}
      {step === 'SPECIALTIES' ? (
        <SpecialtiesStep view={view} save={autosave.save} errorFor={errorFor} />
      ) : null}
      {step === 'EXPERIENCE' ? (
        <ExperienceStep view={view} save={autosave.save} errorFor={errorFor} />
      ) : null}
      {step === 'AVAILABILITY' ? (
        <AvailabilityStep view={view} save={autosave.save} errorFor={errorFor} />
      ) : null}
      {step === 'PROFILE' ? (
        <ProfileStep view={view} save={autosave.save} errorFor={errorFor} />
      ) : null}
      {step === 'CONSENT' ? (
        <ConsentStep view={view} save={autosave.save} errorFor={errorFor} />
      ) : null}
      {step === 'REVIEW' ? <ReviewStep view={view} onGo={(s) => void goto(s)} /> : null}

      <div className="flex items-center gap-2 mt-6">
        {index > 0 ? (
          <button
            type="button"
            onClick={() => void goto(PROVIDER_ONBOARDING_STEPS[index - 1])}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            <ArrowLeft size={15} className="rtl:rotate-180" aria-hidden />
            {copy.back}
          </button>
        ) : null}
        {index < PROVIDER_ONBOARDING_STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => void goto(PROVIDER_ONBOARDING_STEPS[index + 1])}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-none active:scale-95 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            {copy.next}
            <ArrowRight size={15} className="rtl:rotate-180" aria-hidden />
          </button>
        ) : null}
      </div>
    </Card>
  );
}

type SaveFn = ReturnType<typeof useOnboardingStepAutosave>['save'];
type ErrorFn = (field: string) => string | undefined;

interface StepProps {
  view: ProviderOnboardingDraftView;
  save: SaveFn;
  errorFor: ErrorFn;
}

/** Local form state seeded from the server copy.
 *
 *  Seeded ONCE per mount, not synced on every response: re-seeding from the
 *  autosave response would overwrite whatever the provider typed while the
 *  request was in flight. Each step is keyed by step name in StepBody, so
 *  switching steps remounts and re-seeds from the freshest server data. */
function useLocalField<T>(initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  return [value, setValue];
}

function ProviderTypeStep({ view, save, errorFor }: StepProps) {
  const { lang } = useLang();
  const copy = UI[lang];
  const [type, setType] = useLocalField<ProviderTypeCode | null>(view.data.providerType);
  const [name, setName] = useLocalField(view.data.legalBusinessName ?? '');

  return (
    <>
      <ChoiceGroup
        id="provider-type"
        label={STEP_TITLES[lang].PROVIDER_TYPE}
        value={type}
        error={errorFor('providerType')}
        options={[
          { value: 'INDIVIDUAL', label: copy.individual, hint: copy.individualHint },
          { value: 'BUSINESS', label: copy.business, hint: copy.businessHint },
        ]}
        onChange={(next) => {
          setType(next);
          save({ providerType: next });
        }}
      />
      {/* Only businesses are asked. Showing the field to an individual and
          leaving it optional is how a form grows questions nobody needs. */}
      {type === 'BUSINESS' ? (
        <TextField
          id="legal-business-name"
          label={copy.legalBusinessName}
          required
          value={name}
          error={errorFor('legalBusinessName')}
          onChange={(next) => {
            setName(next);
            save({ legalBusinessName: next });
          }}
          maxLength={120}
        />
      ) : null}
    </>
  );
}

function IdentityStep({ view, save, errorFor }: StepProps) {
  const { lang } = useLang();
  const copy = UI[lang];
  const [displayName, setDisplayName] = useLocalField(view.data.displayName ?? '');
  const [image, setImage] = useLocalField(view.data.profileImageUrl ?? '');
  const [phone, setPhone] = useLocalField(view.data.phoneNumber ?? '');

  return (
    <>
      <TextField
        id="display-name"
        label={copy.displayName}
        required
        value={displayName}
        error={errorFor('displayName')}
        maxLength={80}
        onChange={(next) => {
          setDisplayName(next);
          save({ displayName: next });
        }}
      />
      <TextField
        id="profile-image"
        label={copy.profileImage}
        type="url"
        inputMode="url"
        value={image}
        maxLength={500}
        onChange={(next) => {
          setImage(next);
          save({ profileImageUrl: next });
        }}
      />
      <TextField
        id="phone-number"
        label={copy.phoneNumber}
        type="tel"
        inputMode="tel"
        required
        value={phone}
        error={errorFor('phoneNumber')}
        maxLength={40}
        onChange={(next) => {
          setPhone(next);
          save({ phoneNumber: next });
        }}
      />
      {/* Verification is a fact about the SAVED number, so it is read from the
          server copy rather than from the field the provider is typing in.
          Changing the number clears it server-side; the badge follows. */}
      <p
        className={`-mt-2 mb-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
          view.data.phoneVerified
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
        }`}
        style={{ fontSize: '11px', fontWeight: 700 }}
      >
        {view.data.phoneVerified ? (
          <Check size={12} aria-hidden />
        ) : (
          <AlertCircle size={12} aria-hidden />
        )}
        {view.data.phoneVerified ? copy.phoneVerified : copy.phoneUnverified}
      </p>
    </>
  );
}

function LocationStep({ view, save, errorFor }: StepProps) {
  const { lang } = useLang();
  const copy = UI[lang];
  const [city, setCity] = useLocalField(view.data.serviceAreaCity ?? '');
  const [country, setCountry] = useLocalField(view.data.serviceAreaCountry ?? '');
  const [radius, setRadius] = useLocalField(
    view.data.serviceAreaRadiusKm === null ? '' : String(view.data.serviceAreaRadiusKm),
  );
  const [address, setAddress] = useLocalField(view.data.workshopAddressLine ?? '');
  const [geo, setGeo] = useState<'idle' | 'locating' | 'denied' | 'set'>(
    view.data.workshopLat !== null ? 'set' : 'idle',
  );

  // GPS is offered, never required. Permission denial, an unsupported browser,
  // and a device with no fix are all ordinary, and each leaves the manual
  // fields as the complete path — the completeness policy never asks for
  // coordinates.
  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo('denied');
      return;
    }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeo('set');
        save({
          workshopLat: position.coords.latitude,
          workshopLng: position.coords.longitude,
        });
      },
      () => setGeo('denied'),
      { timeout: 10_000 },
    );
  };

  return (
    <>
      <TextField
        id="service-city"
        label={copy.city}
        required
        value={city}
        error={errorFor('serviceAreaCity')}
        maxLength={80}
        onChange={(next) => {
          setCity(next);
          save({ serviceAreaCity: next });
        }}
      />
      <TextField
        id="service-country"
        label={copy.country}
        required
        value={country}
        error={errorFor('serviceAreaCountry')}
        maxLength={80}
        onChange={(next) => {
          setCountry(next);
          save({ serviceAreaCountry: next });
        }}
      />
      <TextField
        id="service-radius"
        label={copy.radius}
        type="number"
        inputMode="numeric"
        required
        value={radius}
        error={errorFor('serviceAreaRadiusKm')}
        onChange={(next) => {
          setRadius(next);
          const parsed = Number(next);
          // Only send a number the server can store. An empty field mid-edit
          // is not "clear my service area", it is a provider halfway through
          // typing "25".
          if (next !== '' && Number.isFinite(parsed)) {
            save({ serviceAreaRadiusKm: Math.trunc(parsed) });
          }
        }}
      />
      <TextField
        id="workshop-address"
        label={copy.workshopAddress}
        value={address}
        maxLength={200}
        onChange={(next) => {
          setAddress(next);
          save({ workshopAddressLine: next });
        }}
      />

      <button
        type="button"
        onClick={locate}
        disabled={geo === 'locating'}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition-all disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        {geo === 'locating' ? (
          <Loader2 size={15} className="animate-spin" aria-hidden />
        ) : (
          <MapPin size={15} aria-hidden />
        )}
        {geo === 'locating'
          ? copy.locating
          : geo === 'set'
            ? copy.coordinatesSet
            : copy.useMyLocation}
      </button>
      {geo === 'denied' ? (
        <p
          role="status"
          className="mt-2 text-amber-600"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          {copy.locationDenied}
        </p>
      ) : null}
    </>
  );
}

function SpecialtiesStep({ view, save, errorFor }: StepProps) {
  const { lang } = useLang();
  const copy = UI[lang];
  const categories = useServiceCategories();
  const [groups, setGroups] = useLocalField<string[]>(view.data.primaryGroupIds);
  const [leaves, setLeaves] = useLocalField<string[]>([
    ...view.data.specialtyLeafIds,
    ...view.data.pendingSpecialtyIds,
  ]);

  const rows = categories.data ?? [];
  const label = (c: { labelEn: string; labelAr: string }) =>
    lang === 'ar' ? c.labelAr : c.labelEn;

  // Groups are the non-selectable headings. `isLeaf` is READ from the
  // catalogue, never inferred from whether a row has children — a parent whose
  // last child was retired must not silently become selectable here.
  const groupOptions = rows.filter((c) => !c.isLeaf);
  // Leaves under a ticked group, plus every root that is itself selectable —
  // which is every pre-hierarchy category, so the flat catalogue keeps working
  // before anyone has grouped anything.
  const leafOptions = rows.filter(
    (c) => c.isLeaf && (c.parentId === null || groups.includes(c.parentId)),
  );

  return (
    <>
      {groupOptions.length > 0 ? (
        <ChipToggles
          legend={copy.groups}
          hint={copy.groupsHint}
          options={groupOptions.map((c) => ({ value: c.id, label: label(c) }))}
          selected={groups}
          onToggle={(id) => {
            const next = groups.includes(id) ? groups.filter((g) => g !== id) : [...groups, id];
            setGroups(next);
            // Sends the groups ONLY. Ticking a group is an expression of
            // intent with no authorization consequence; the leaves beneath it
            // are still each an application an admin decides.
            save({ primaryGroupIds: next });
          }}
        />
      ) : null}

      <ChipToggles
        legend={copy.specialties}
        options={leafOptions.map((c) => ({
          value: c.id,
          label: label(c),
          badge: view.data.pendingSpecialtyIds.includes(c.id)
            ? copy.specialtyPending
            : view.data.specialtyLeafIds.includes(c.id)
              ? copy.specialtyApproved
              : undefined,
        }))}
        selected={leaves}
        emptyText={copy.nothingYet}
        onToggle={(id) => {
          const next = leaves.includes(id) ? leaves.filter((l) => l !== id) : [...leaves, id];
          setLeaves(next);
          save({ specialtyLeafIds: next });
        }}
      />
      {errorFor('specialties') ? (
        <p
          role="alert"
          className="-mt-2 mb-3 text-red-600"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          {errorFor('specialties')}
        </p>
      ) : null}
    </>
  );
}

function ExperienceStep({ view, save, errorFor }: StepProps) {
  const { lang } = useLang();
  const copy = UI[lang];
  const equipment = useEquipmentCatalog();
  const [years, setYears] = useLocalField(
    view.data.yearsOfExperience === null ? '' : String(view.data.yearsOfExperience),
  );
  const [codes, setCodes] = useLocalField<string[]>(view.data.equipmentCodes);
  const [transport, setTransport] = useLocalField<ProviderTransportModeCode | null>(
    view.data.transportMode,
  );

  const items = equipment.data ?? [];

  return (
    <>
      <TextField
        id="years-of-experience"
        label={copy.yearsOfExperience}
        type="number"
        inputMode="numeric"
        required
        value={years}
        error={errorFor('yearsOfExperience')}
        onChange={(next) => {
          setYears(next);
          const parsed = Number(next);
          if (next !== '' && Number.isFinite(parsed)) {
            save({ yearsOfExperience: Math.trunc(parsed) });
          }
        }}
      />

      <ChipToggles
        legend={copy.equipment}
        options={items.map((item) => ({
          value: item.code,
          label: lang === 'ar' ? item.labelAr : item.labelEn,
        }))}
        selected={codes}
        emptyText={copy.nothingYet}
        onToggle={(code) => {
          const next = codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code];
          setCodes(next);
          save({ equipmentCodes: next });
        }}
      />

      <ChoiceGroup
        id="transport-mode"
        label={copy.transport}
        value={transport}
        options={TRANSPORT_MODES.map((mode) => ({
          value: mode,
          label: TRANSPORT_LABELS[lang][mode],
        }))}
        onChange={(next) => {
          setTransport(next);
          save({ transportMode: next });
        }}
      />
    </>
  );
}

interface LocalInterval {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

function AvailabilityStep({ view, save, errorFor }: StepProps) {
  const { lang } = useLang();
  const copy = UI[lang];
  const [rows, setRows] = useLocalField<LocalInterval[]>(
    view.data.availability.map((i) => ({
      dayOfWeek: i.dayOfWeek,
      startMinute: i.startMinute,
      endMinute: i.endMinute,
    })),
  );
  const [timezone, setTimezone] = useLocalField(
    view.data.timezone ??
      // The browser's zone as the default rather than a hard-coded one: a
      // provider in Aleppo and one in Dubai should each get theirs without
      // reading a dropdown of four hundred entries first.
      (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'),
  );

  // Client-side overlap detection, purely so the provider sees the problem
  // where they made it. The server validates the same rule independently and
  // is the one that decides — this is feedback, not enforcement.
  const overlapping = useMemo(() => {
    const bad = new Set<number>();
    rows.forEach((a, i) => {
      rows.forEach((b, j) => {
        if (i >= j) return;
        if (a.dayOfWeek !== b.dayOfWeek) return;
        if (a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
          bad.add(i);
          bad.add(j);
        }
      });
    });
    return bad;
  }, [rows]);

  const commit = (next: LocalInterval[]) => {
    setRows(next);
    // Do not send a set that is known-bad — the server would reject it, the
    // save indicator would go red, and the provider would see an error for a
    // problem the inline highlight is already showing them.
    const clean = next.every(
      (a, i) =>
        !next.some(
          (b, j) =>
            i !== j &&
            a.dayOfWeek === b.dayOfWeek &&
            a.startMinute < b.endMinute &&
            b.startMinute < a.endMinute,
        ),
    );
    const wellFormed = next.every((r) => r.startMinute < r.endMinute);
    if (clean && wellFormed) save({ availability: next, timezone });
  };

  return (
    <>
      <TextField
        id="timezone"
        label={copy.timezone}
        value={timezone}
        maxLength={64}
        onChange={(next) => {
          setTimezone(next);
          save({ timezone: next });
        }}
      />

      {rows.length === 0 ? (
        <p className="mb-3 text-slate-400" style={{ fontSize: '13px' }}>
          {copy.noHours}
        </p>
      ) : null}

      <ul className="space-y-2 mb-3">
        {rows.map((interval, i) => (
          <li
            key={`${interval.dayOfWeek}-${i}`}
            className={`p-3 rounded-2xl border ${
              overlapping.has(i)
                ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[110px]">
                <label
                  htmlFor={`day-${i}`}
                  className="block mb-1 text-slate-600 dark:text-slate-300"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {DAY_LABELS[lang][interval.dayOfWeek]}
                </label>
                <select
                  id={`day-${i}`}
                  value={interval.dayOfWeek}
                  onChange={(event) => {
                    const next = [...rows];
                    next[i] = { ...interval, dayOfWeek: Number(event.target.value) };
                    commit(next);
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40"
                  style={{ fontSize: '13px' }}
                >
                  {DAY_LABELS[lang].map((name, day) => (
                    <option key={day} value={day}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor={`from-${i}`}
                  className="block mb-1 text-slate-600 dark:text-slate-300"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {copy.from}
                </label>
                <input
                  id={`from-${i}`}
                  type="time"
                  value={minuteToTime(interval.startMinute)}
                  onChange={(event) => {
                    const minute = timeToMinute(event.target.value);
                    if (minute === null) return;
                    const next = [...rows];
                    next[i] = { ...interval, startMinute: minute };
                    commit(next);
                  }}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <div>
                <label
                  htmlFor={`to-${i}`}
                  className="block mb-1 text-slate-600 dark:text-slate-300"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {copy.to}
                </label>
                <input
                  id={`to-${i}`}
                  type="time"
                  value={minuteToTime(interval.endMinute)}
                  onChange={(event) => {
                    const minute = timeToMinute(event.target.value);
                    if (minute === null) return;
                    const next = [...rows];
                    next[i] = { ...interval, endMinute: minute };
                    commit(next);
                  }}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <button
                type="button"
                aria-label={`${copy.remove} ${DAY_LABELS[lang][interval.dayOfWeek]} ${minuteToTime(interval.startMinute)}`}
                onClick={() => commit(rows.filter((_, j) => j !== i))}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 active:scale-95 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
            {overlapping.has(i) ? (
              <p
                role="alert"
                className="mt-2 text-red-600"
                style={{ fontSize: '11.5px', fontWeight: 600 }}
              >
                {copy.overlapError}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => commit([...rows, { dayOfWeek: 1, startMinute: 540, endMinute: 1020 }])}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 active:scale-95 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        <Plus size={15} aria-hidden />
        {copy.addHours}
      </button>

      {errorFor('availability') ? (
        <p role="alert" className="mt-2 text-red-600" style={{ fontSize: '12px', fontWeight: 600 }}>
          {errorFor('availability')}
        </p>
      ) : null}
    </>
  );
}

function ProfileStep({ view, save, errorFor }: StepProps) {
  const { lang } = useLang();
  const copy = UI[lang];
  const [headline, setHeadline] = useLocalField(view.data.headline ?? '');
  const [bio, setBio] = useLocalField(view.data.bio ?? '');
  const [extra, setExtra] = useLocalField(view.data.additionalInformation ?? '');

  return (
    <>
      <TextField
        id="headline"
        label={copy.headline}
        required
        value={headline}
        error={errorFor('headline')}
        maxLength={120}
        onChange={(next) => {
          setHeadline(next);
          save({ headline: next });
        }}
      />
      <TextAreaField
        id="bio"
        label={copy.bio}
        required
        value={bio}
        error={errorFor('bio')}
        maxLength={2000}
        onChange={(next) => {
          setBio(next);
          save({ bio: next });
        }}
      />
      <TextAreaField
        id="additional-information"
        label={copy.additionalInformation}
        value={extra}
        maxLength={2000}
        rows={3}
        onChange={(next) => {
          setExtra(next);
          save({ additionalInformation: next });
        }}
      />
    </>
  );
}

function ConsentStep({ view, save, errorFor }: StepProps) {
  const { lang } = useLang();
  const copy = UI[lang];
  const accepted = view.data.acceptedConsentVersion !== null;

  return (
    <div>
      <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 cursor-pointer">
        <input
          type="checkbox"
          checked={accepted}
          aria-describedby="consent-version"
          onChange={(event) => {
            // The version is NOT chosen by the client. The server checks what
            // is sent against the currently published document and refuses a
            // stale one, so the wizard sends what it was told and never
            // invents a version.
            save({ acceptedConsentVersion: event.target.checked ? view.policyVersion : null });
          }}
          className="mt-0.5 w-5 h-5 rounded accent-blue-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        />
        <span>
          <span
            className="block text-slate-900 dark:text-slate-100"
            style={{ fontSize: '14px', fontWeight: 600, lineHeight: '1.5' }}
          >
            {copy.consentText}
          </span>
          <span
            id="consent-version"
            className="block mt-1 text-slate-500 dark:text-slate-400"
            style={{ fontSize: '11.5px' }}
          >
            {copy.consentVersion} {view.policyVersion}
            {view.data.consentAcceptedAt
              ? ` · ${new Date(view.data.consentAcceptedAt).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}`
              : ''}
          </span>
        </span>
      </label>
      {errorFor('consent') ? (
        <p role="alert" className="mt-2 text-red-600" style={{ fontSize: '12px', fontWeight: 600 }}>
          {errorFor('consent')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The review screen.
 *
 * Every section links BACK to the step that owns it. A read-only summary with
 * no way to fix what it shows is a dead end — the provider reads "no hours
 * added" and has to work out which of nine tabs collected hours.
 */
function ReviewStep({
  view,
  onGo,
}: {
  view: ProviderOnboardingDraftView;
  onGo: (step: ProviderOnboardingStep) => void;
}) {
  const { lang } = useLang();
  const copy = UI[lang];
  const submit = useSubmitOnboarding();
  const titles = STEP_TITLES[lang];

  const summaries: Partial<Record<ProviderOnboardingStep, string>> = {
    PROVIDER_TYPE:
      view.data.providerType === 'BUSINESS'
        ? `${copy.business}${view.data.legalBusinessName ? ` · ${view.data.legalBusinessName}` : ''}`
        : view.data.providerType === 'INDIVIDUAL'
          ? copy.individual
          : undefined,
    IDENTITY:
      [view.data.displayName, view.data.phoneNumber].filter(Boolean).join(' · ') || undefined,
    LOCATION:
      [view.data.serviceAreaCity, view.data.serviceAreaCountry].filter(Boolean).join(', ') +
        (view.data.serviceAreaRadiusKm ? ` · ${view.data.serviceAreaRadiusKm} km` : '') ||
      undefined,
    SPECIALTIES:
      view.data.specialtyLeafIds.length + view.data.pendingSpecialtyIds.length > 0
        ? `${view.data.specialtyLeafIds.length + view.data.pendingSpecialtyIds.length}`
        : undefined,
    EXPERIENCE:
      view.data.yearsOfExperience !== null
        ? `${view.data.yearsOfExperience} · ${view.data.transportMode ? TRANSPORT_LABELS[lang][view.data.transportMode] : ''}`
        : undefined,
    AVAILABILITY:
      view.data.availability.length > 0 ? `${view.data.availability.length}` : undefined,
    PROFILE: view.data.headline ?? undefined,
    CONSENT: view.data.acceptedConsentVersion ?? undefined,
  };

  return (
    <div>
      <p
        className="mb-4 text-slate-600 dark:text-slate-300"
        style={{ fontSize: '13px', lineHeight: '1.6' }}
      >
        {copy.reviewIntro}
      </p>

      <ul className="space-y-2 mb-5">
        {view.steps
          .filter((s) => s.step !== 'REVIEW')
          .map((s) => (
            <li key={s.step}>
              <button
                type="button"
                onClick={() => onGo(s.step)}
                className="w-full flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 text-start active:scale-[0.99] transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <span className="min-w-0">
                  <span
                    className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100"
                    style={{ fontSize: '13.5px', fontWeight: 700 }}
                  >
                    {s.complete ? (
                      <Check size={14} className="text-emerald-600 shrink-0" aria-hidden />
                    ) : (
                      <AlertCircle size={14} className="text-amber-600 shrink-0" aria-hidden />
                    )}
                    {titles[s.step]}
                  </span>
                  <span
                    className="block mt-0.5 truncate text-slate-500 dark:text-slate-400"
                    style={{ fontSize: '12px' }}
                  >
                    {s.issues.length > 0
                      ? issueText(lang, s.issues[0].field, s.issues[0].code)
                      : (summaries[s.step] ?? copy.nothingYet)}
                  </span>
                </span>
                <span
                  className="flex items-center gap-1 text-blue-600 shrink-0"
                  style={{ fontSize: '12px', fontWeight: 700 }}
                >
                  {copy.edit}
                  <ChevronRight size={14} className="rtl:rotate-180" aria-hidden />
                </span>
              </button>
            </li>
          ))}
      </ul>

      <button
        type="button"
        disabled={!view.complete || submit.isPending}
        onClick={() => submit.mutate({ version: view.version })}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-none active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        style={{ fontSize: '15px', fontWeight: 800 }}
      >
        {submit.isPending ? (
          <>
            <Loader2 size={17} className="animate-spin" aria-hidden />
            {copy.submitting}
          </>
        ) : (
          <>
            <Send size={17} aria-hidden />
            {copy.submit}
          </>
        )}
      </button>

      {/* The button is disabled from the SERVER's `complete`, and the reason it
          is disabled is spelled out rather than left to be inferred from a
          greyed-out control. */}
      {!view.complete ? (
        <ul className="mt-3 space-y-1">
          {view.missing.map((issue) => (
            <li
              key={`${issue.field}:${issue.code}`}
              className="flex items-start gap-1.5 text-amber-700 dark:text-amber-500"
              style={{ fontSize: '12px', fontWeight: 600 }}
            >
              <Clock size={12} className="mt-0.5 shrink-0" aria-hidden />
              {issueText(lang, issue.field, issue.code)}
            </li>
          ))}
        </ul>
      ) : null}

      {submit.isError ? (
        <p role="alert" className="mt-3 text-red-600" style={{ fontSize: '12px', fontWeight: 600 }}>
          {submit.error.response?.status === 409 ? copy.conflict : copy.saveError}
        </p>
      ) : null}
    </div>
  );
}
