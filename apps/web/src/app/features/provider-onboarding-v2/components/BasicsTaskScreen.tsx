import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { isPlausibleE164 } from '../../../../lib/provider/phone-format';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import {
  useOnboardingAutosave,
  useOnboardingStepAutosave,
} from '../autosave/ProviderOnboardingAutosaveProvider';
import { AvatarUploader } from '../avatar/AvatarUploader';
import { BASICS_COPY, type Lang } from '../copy/basics-copy';
import { ProviderErrorState, ProviderSkeleton, ProviderTextInput } from '../../provider-ui';

// Sprint 9B.17 — V2 Task 1: the basics, and the photo.
// Sprint 09B.29 Phase 5 — migrated to Provider UI against the approved
// prototype screen `basics` ("Basic details", task 1 of 6).
//
// THE APPROVED SCREEN IS THREE THINGS, IN THIS ORDER
//
//   the photo     an upload surface — camera or gallery — FIRST
//   the name      the name customers see
//   the phone     with the note that SMS verification is not active yet
//
// WHAT WAS REMOVED, AND ON WHOSE AUTHORITY
//
// The provider-type chooser (individual/business), its confirmation dialog and
// the legal-business-name field are gone. Ruling C1 makes `providerType` a
// SERVER-side default — INDIVIDUAL, written only when absent while creating a
// new V2 draft — and puts the business path on a later approved surface. The
// ruling says in terms: do not add provider-type, legal-business-name or
// duplicate professional-title controls to the approved onboarding screens.
//
// That is a behaviour change, not a tidy-up, so it is worth being explicit
// about what it does NOT do: nothing is deleted server-side. A provider whose
// profile already says BUSINESS keeps it, keeps their legal name, and keeps
// every document they have sent. The screen stops asking a question the
// approved design does not ask, and the server stops needing it answered here.
//
// WHAT IS DELIBERATELY STILL NOT HERE
//
//   the address     Where a provider works is the WORK_AREA task, and it is a
//                   city and a radius, not a street.
//   an image URL    Replaced by a real presigned upload in Phase 4.
//   phone proof     Collected and format-checked, never claimed as verified,
//                   because no SMS channel exists to verify it with.
//
// BEHAVIOUR IS UNCHANGED BY THE MIGRATION: same step ownership, same version
// handshake through the shared coordinator, same keystroke-commit contract,
// same exit tracking for the photo, same stable test ids.

interface BasicsTaskScreenProps {
  view: ProviderOnboardingDraftView;
  lang: Lang;
  /** False while the application is locked (submitted and not withdrawn). */
  editable: boolean;
}

export function BasicsTaskScreen({ view, lang, editable }: BasicsTaskScreenProps) {
  const copy = BASICS_COPY[lang];
  const qc = useQueryClient();

  // Sprint 09B.29 Phase 4 — the photo upload joins the exit contract, and
  // this screen is where the two meet: it already holds the coordinator, and
  // AvatarUploader stays a component that does not care where it is mounted.
  const { trackExternalWork } = useOnboardingAutosave();
  const identityAutosave = useOnboardingStepAutosave('IDENTITY');

  const data = view.data;
  const [displayName, setDisplayName] = useState(data.displayName ?? '');
  const [phone, setPhone] = useState(data.phoneNumber ?? '');
  const [phoneTouched, setPhoneTouched] = useState(false);

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

  // One step owns every field on this screen now that provider type has moved
  // server-side, so there is one status rather than a merge of two — and since
  // Phase 5A it is reported by the approved sticky bar rather than by a line
  // inside the form, so this screen no longer renders it itself.

  /**
   * Never write an empty display name: the column is NOT NULL and the server
   * refuses it, so sending it would turn a blank field into an error banner
   * the provider cannot act on.
   */
  const commitDisplayName = (next: string) => {
    if (next.trim() !== '') identityAutosave.save({ displayName: next });
  };

  /**
   * A number the server would refuse is not sent. Clearing IS a real
   * intention, so an empty value still writes null — the provider is removing
   * something they already said. A half-typed number is therefore NOT queued,
   * which is why the phone field can still show "Saved" from an earlier write
   * while an invalid number is on screen; the inline error speaks for that.
   */
  const commitPhone = (next: string) => {
    setPhoneTouched(true);
    if (next.trim() === '' || isPlausibleE164(next)) {
      identityAutosave.save({ phoneNumber: next.trim() === '' ? null : next });
    }
  };

  return (
    <div className="flex flex-col gap-[18px]" data-testid="basics-task">
      {/* ── Photo, first, as the approved screen has it ─────────────────── */}
      <AvatarUploader
        imageUrl={data.profileImageUrl ?? null}
        version={view.version}
        lang={lang}
        onSaved={onAvatarSaved}
        trackWork={trackExternalWork}
        disabled={!editable}
      />

      {/* ── The name customers see ──────────────────────────────────────── */}
      <ProviderTextInput
        label={copy.displayName}
        data-testid="field-displayName"
        value={displayName}
        disabled={!editable}
        autoComplete="name"
        onChange={(event) => {
          setDisplayName(event.target.value);
          // Sprint 9B.28 — the coordinator hears about the keystroke NOW.
          //
          // It debounces, so typing a sentence is still one write. What this
          // changes is that the status goes `dirty` on the first character
          // instead of showing the PREVIOUS write's "Saved" until blur — and
          // that an exit taken without blurring still has the text to flush.
          commitDisplayName(event.target.value);
        }}
        // Still on blur as well: leaving a field commits it rather than waiting
        // out a timer the provider cannot see.
        onBlur={() => commitDisplayName(displayName)}
      />

      {/* ── Phone ───────────────────────────────────────────────────────── */}
      <ProviderTextInput
        label={copy.phone}
        // The approved screen carries ONE sentence under the phone field, and
        // it is the one that stops "we have your number" reading as "your
        // number is verified". As the hint it is wired to the input through
        // `aria-describedby`; as the paragraph it used to be, it was prose
        // sitting nearby that no screen reader ever connected to the field.
        hint={copy.phoneNotVerified}
        error={phoneError ?? undefined}
        data-testid="field-phoneNumber"
        type="tel"
        inputMode="tel"
        value={phone}
        disabled={!editable}
        autoComplete="tel"
        onChange={(event) => {
          setPhone(event.target.value);
          commitPhone(event.target.value);
        }}
        onBlur={() => commitPhone(phone)}
      />
    </div>
  );
}

/**
 * The route-level wrapper: fetch, guard, then render.
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
    return <ProviderSkeleton label={copy.saving} />;
  }

  // The SHAPE, not merely presence. A 200 carrying something that is not a
  // draft — a proxy's error envelope, an older API, a misrouted stub — would
  // otherwise reach the form, which reads `view.data.displayName` and throws,
  // taking the whole task screen down with it. A form that cannot load should
  // say so, not disappear.
  const view = draft.data;
  const usable = view && typeof view.version === 'number' && view.data !== undefined;

  if (!usable) {
    return <ProviderErrorState title={copy.saveFailed} testId="basics-load-failed" />;
  }

  // `editable` is the server's word, not a guess: a submitted application is
  // locked until it is withdrawn, and rendering live inputs over a locked
  // application would collect edits every save then rejects.
  return <BasicsTaskScreen view={view} lang={lang} editable={view.editable} />;
}
