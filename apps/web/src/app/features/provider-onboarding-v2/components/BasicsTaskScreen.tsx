import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { isPlausibleE164 } from '../../../../lib/provider/phone-format';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import {
  useOnboardingDraft,
  useOnboardingStepAutosave,
} from '../../../hooks/provider/useProviderOnboarding';
import { AvatarUploader } from '../avatar/AvatarUploader';
import { BASICS_COPY, type Lang } from '../copy/basics-copy';

// Sprint 9B.17 — V2 Task 1: account type, basics, and the photo.
//
// SHORT AND DYNAMIC, which is the whole point of the six-task model. The
// Sprint 8 wizard asked every provider the same nine screens; this asks four
// things, and one of them only of businesses.
//
// WHAT IS DELIBERATELY NOT HERE
//
//   the address     Where a provider works is the WORK_AREA task, and it is a
//                   city and a radius, not a street. Asking someone for their
//                   home address on the first screen of a signup — before they
//                   have any reason to trust the product — is how people stop
//                   signing up.
//   an image URL    Replaced by a real upload. Asking someone to host a photo
//                   somewhere else first is why that field was always empty.
//   phone proof     A number is collected and format-checked. It is not
//                   CONFIRMED, because no SMS channel exists to confirm it
//                   with, and a form that demands proof nothing can issue is a
//                   dead end.
//
// TWO STEPS, ONE SCREEN
//
// The server still models these as PROVIDER_TYPE and IDENTITY, so the screen
// drives two autosaves. Each keeps its own version handshake; a field only
// ever writes to the step that owns it, which is what the server's per-step
// field guard enforces anyway.

interface BasicsTaskScreenProps {
  view: ProviderOnboardingDraftView;
  lang: Lang;
  /** False while the application is locked (submitted and not withdrawn). */
  editable: boolean;
}

type ProviderType = 'INDIVIDUAL' | 'BUSINESS';

export function BasicsTaskScreen({ view, lang, editable }: BasicsTaskScreenProps) {
  const copy = BASICS_COPY[lang];
  const qc = useQueryClient();

  const typeAutosave = useOnboardingStepAutosave('PROVIDER_TYPE');
  const identityAutosave = useOnboardingStepAutosave('IDENTITY');

  const data = view.data;
  const [displayName, setDisplayName] = useState(data.displayName ?? '');
  const [legalName, setLegalName] = useState(data.legalBusinessName ?? '');
  const [phone, setPhone] = useState(data.phoneNumber ?? '');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [pendingType, setPendingType] = useState<ProviderType | null>(null);

  const providerType = (data.providerType ?? null) as ProviderType | null;

  const seed = useCallback(
    (next: unknown) => {
      qc.setQueryData(providerQueryKeys.onboarding.draft(), next);
    },
    [qc],
  );

  // The photo is the only field with a save path of its own, because it is the
  // only one whose value the server has to go and look at before accepting.
  const onAvatarSaved = useCallback((next: unknown) => seed(next), [seed]);

  const phoneError = useMemo(() => {
    if (!phoneTouched || phone.trim() === '') return null;
    return isPlausibleE164(phone) ? null : copy.phoneInvalid;
  }, [copy.phoneInvalid, phone, phoneTouched]);

  /**
   * Changing provider type is confirmed, not silent.
   *
   * Individual and business are verified against different documents. A
   * provider who switches after uploading evidence needs to know what that
   * means — and, just as importantly, needs to be told what it does NOT mean:
   * nothing already sent is deleted. The server keeps evidence and decisions
   * on the record regardless of type, so the honest message is "the
   * requirements change", not a warning about losing work.
   */
  const requestTypeChange = (next: ProviderType) => {
    if (next === providerType) return;
    // Only a CHANGE needs confirming. The first choice on an empty form is not
    // a change, and a dialog there is friction for nothing.
    if (providerType === null) {
      typeAutosave.save({ providerType: next });
      return;
    }
    setPendingType(next);
  };

  const confirmTypeChange = () => {
    if (!pendingType) return;
    typeAutosave.save({ providerType: pendingType });
    // Clearing the business name is the server's decision, not ours: the
    // completeness policy simply stops asking for it. Sending null here would
    // discard something the provider typed, and if they switch back it is gone.
    setPendingType(null);
  };

  const status = mergeStatus(typeAutosave.status, identityAutosave.status);

  return (
    <div className="flex flex-col gap-6" data-testid="basics-task">
      <SaveStatus status={status} copy={copy} />

      {/* ── How do you work? ────────────────────────────────────────────── */}
      <fieldset className="min-w-0" disabled={!editable}>
        <legend
          className="mb-1 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '14px', fontWeight: 700 }}
        >
          {copy.typeLegend}
        </legend>
        <p
          className="mb-2 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
        >
          {copy.typeHint}
        </p>

        <div className="flex flex-col gap-2">
          <TypeOption
            testId="provider-type-INDIVIDUAL"
            checked={providerType === 'INDIVIDUAL'}
            label={copy.individual}
            hint={copy.individualHint}
            onSelect={() => requestTypeChange('INDIVIDUAL')}
            disabled={!editable}
          />
          <TypeOption
            testId="provider-type-BUSINESS"
            checked={providerType === 'BUSINESS'}
            label={copy.business}
            hint={copy.businessHint}
            onSelect={() => requestTypeChange('BUSINESS')}
            disabled={!editable}
          />
        </div>
      </fieldset>

      {pendingType ? (
        <div
          role="alertdialog"
          aria-labelledby="type-change-title"
          aria-describedby="type-change-body"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-3"
          data-testid="provider-type-change-dialog"
        >
          <h3
            id="type-change-title"
            className="break-words text-amber-900"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            {copy.typeChangeTitle}
          </h3>
          <p
            id="type-change-body"
            className="mt-1 break-words text-amber-800"
            style={{ fontSize: '12px' }}
          >
            {copy.typeChangeBody}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirmTypeChange}
              data-testid="provider-type-change-confirm"
              className="rounded-xl bg-blue-600 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
            >
              {copy.typeChangeConfirm}
            </button>
            <button
              type="button"
              onClick={() => setPendingType(null)}
              data-testid="provider-type-change-cancel"
              className="rounded-xl border border-slate-200 bg-white px-3 text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
            >
              {copy.typeChangeCancel}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Business name, only for businesses ──────────────────────────── */}
      {providerType === 'BUSINESS' ? (
        <Field
          testId="field-legalBusinessName"
          label={copy.legalName}
          hint={copy.legalNameHint}
          required
          requiredLabel={copy.required}
          value={legalName}
          disabled={!editable}
          onChange={setLegalName}
          onCommit={() => typeAutosave.save({ legalBusinessName: legalName })}
        />
      ) : null}

      {/* ── Name customers see ──────────────────────────────────────────── */}
      <Field
        testId="field-displayName"
        label={copy.displayName}
        hint={copy.displayNameHint}
        required
        requiredLabel={copy.required}
        value={displayName}
        disabled={!editable}
        onChange={setDisplayName}
        onCommit={() => {
          // Never write an empty display name: the column is NOT NULL and the
          // server refuses it, so sending it would turn a blank field into an
          // error banner the provider cannot act on.
          if (displayName.trim() !== '') identityAutosave.save({ displayName });
        }}
      />

      {/* ── Phone ───────────────────────────────────────────────────────── */}
      <Field
        testId="field-phoneNumber"
        label={copy.phone}
        hint={copy.phoneHint}
        required
        requiredLabel={copy.required}
        value={phone}
        disabled={!editable}
        inputMode="tel"
        type="tel"
        error={phoneError}
        onChange={setPhone}
        onCommit={() => {
          setPhoneTouched(true);
          // Only send something the server will accept. A round-trip whose
          // only outcome is a 400 teaches nothing the inline message has not
          // already said.
          if (phone.trim() === '' || isPlausibleE164(phone)) {
            identityAutosave.save({ phoneNumber: phone.trim() === '' ? null : phone });
          }
        }}
      />
      <p
        className="-mt-4 break-words text-slate-500 dark:text-slate-400"
        style={{ fontSize: '12px' }}
        data-testid="phone-verification-note"
      >
        {copy.phoneNotVerified}
      </p>

      {/* ── Photo ───────────────────────────────────────────────────────── */}
      <AvatarUploader
        imageUrl={data.profileImageUrl ?? null}
        version={view.version}
        lang={lang}
        onSaved={onAvatarSaved}
        disabled={!editable}
      />
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function TypeOption({
  testId,
  checked,
  label,
  hint,
  onSelect,
  disabled,
}: {
  testId: string;
  checked: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <label
      className={`flex min-w-0 items-start gap-3 rounded-2xl border p-3 ${
        checked ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 dark:border-slate-700'
      }`}
      style={{ minHeight: '44px' }}
      data-testid={testId}
    >
      <input
        type="radio"
        name="providerType"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="mt-0.5 h-5 w-5 flex-shrink-0 accent-blue-600"
      />
      <span className="min-w-0">
        <span
          className="block break-words text-slate-900 dark:text-white"
          style={{ fontSize: '14px', fontWeight: 600 }}
        >
          {label}
        </span>
        <span
          className="block break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
        >
          {hint}
        </span>
      </span>
    </label>
  );
}

function Field({
  testId,
  label,
  hint,
  value,
  onChange,
  onCommit,
  disabled,
  required,
  requiredLabel,
  error,
  type = 'text',
  inputMode,
}: {
  testId: string;
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  disabled: boolean;
  required?: boolean;
  requiredLabel?: string;
  error?: string | null;
  type?: string;
  inputMode?: 'tel' | 'text';
}) {
  const id = `basics-${testId}`;
  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="mb-1 flex flex-wrap items-baseline gap-2 break-words text-slate-900 dark:text-white"
        style={{ fontSize: '14px', fontWeight: 600 }}
      >
        {label}
        {required && requiredLabel ? (
          <span className="text-slate-400" style={{ fontSize: '11px', fontWeight: 500 }}>
            {requiredLabel}
          </span>
        ) : null}
      </label>
      <input
        id={id}
        data-testid={testId}
        type={type}
        inputMode={inputMode}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
        // Save on BLUR as well as on the debounce inside the autosave hook, so
        // leaving a field commits it rather than waiting out a timer the
        // provider cannot see.
        onBlur={onCommit}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        style={{ fontSize: '14px', minHeight: '44px' }}
      />
      <p
        id={`${id}-hint`}
        className={`mt-1 break-words ${error ? 'text-rose-600' : 'text-slate-500 dark:text-slate-400'}`}
        style={{ fontSize: '12px' }}
      >
        {error ?? hint}
      </p>
    </div>
  );
}

type Status = ReturnType<typeof useOnboardingStepAutosave>['status'];

/**
 * One status line for two autosaves.
 *
 * Precedence is deliberate: a conflict outranks an error outranks saving. The
 * provider needs the most consequential fact, and "Saved" appearing while the
 * other step is mid-conflict would be a lie by omission.
 */
function mergeStatus(a: Status, b: Status): Status {
  const rank = (s: Status) =>
    s.kind === 'conflict'
      ? 4
      : s.kind === 'error'
        ? 3
        : s.kind === 'offline'
          ? 2
          : s.kind === 'saving'
            ? 1
            : 0;
  return rank(a) >= rank(b) ? a : b;
}

function SaveStatus({ status, copy }: { status: Status; copy: (typeof BASICS_COPY)['en'] }) {
  if (status.kind === 'idle') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="basics-save-status"
      data-status={status.kind}
      className="flex flex-wrap items-center gap-2"
      style={{ fontSize: '12px' }}
    >
      {status.kind === 'saving' ? <span className="text-slate-500">{copy.saving}</span> : null}
      {status.kind === 'saved' ? <span className="text-emerald-700">{copy.saved}</span> : null}
      {status.kind === 'offline' ? <span className="text-amber-700">{copy.offline}</span> : null}
      {status.kind === 'conflict' ? (
        <span className="break-words text-rose-600">{copy.saveConflict}</span>
      ) : null}
      {status.kind === 'error' ? (
        <>
          <span className="text-rose-600">{copy.saveFailed}</span>
          <button
            type="button"
            onClick={status.retry}
            data-testid="basics-save-retry"
            className="rounded-lg px-2 text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            style={{ fontWeight: 600, minHeight: '44px' }}
          >
            {copy.saveRetry}
          </button>
        </>
      ) : null}
    </div>
  );
}

// ─── Container ──────────────────────────────────────────────────────────────

/**
 * Loads the draft and renders the form.
 *
 * A separate component rather than a branch inside the task route, because the
 * draft query must only run for the task that needs it — hooks cannot be
 * conditional, and every other task screen has no business fetching the whole
 * application.
 *
 * The draft is the SAME resource the Sprint 8 wizard reads, which is what
 * makes the version contract here a real one rather than a second, parallel
 * notion of "current".
 */
export function BasicsTask({ lang }: { lang: Lang }) {
  const draft = useOnboardingDraft();
  const copy = BASICS_COPY[lang];

  if (!draft.isFetched) {
    return (
      <div className="flex justify-center py-10" role="status" aria-live="polite">
        <span className="sr-only">{copy.saving}</span>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      </div>
    );
  }

  // The SHAPE, not merely presence. A 200 carrying something that is not a
  // draft — a proxy's error envelope, an older API, a misrouted stub — would
  // otherwise reach the form, which reads `view.data.displayName` and throws,
  // taking the whole task screen down with it. A form that cannot load should
  // say so, not disappear.
  const view = draft.data;
  const usable = view && typeof view.version === 'number' && view.data !== undefined;

  if (!usable) {
    return (
      <p
        className="break-words text-rose-600"
        style={{ fontSize: '13px' }}
        data-testid="basics-load-failed"
      >
        {copy.saveFailed}
      </p>
    );
  }

  // `editable` is the server's word, not a guess: a submitted application is
  // locked until it is withdrawn, and rendering live inputs over a locked
  // application would collect edits every save then rejects.
  return <BasicsTaskScreen view={view} lang={lang} editable={view.editable} />;
}
