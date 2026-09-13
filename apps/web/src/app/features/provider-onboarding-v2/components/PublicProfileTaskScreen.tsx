import { useCallback, useRef, useState } from 'react';
import { Clock, ImagePlus, Paintbrush } from 'lucide-react';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import {
  useOnboardingAutosave,
  useOnboardingStepAutosave,
} from '../autosave/ProviderOnboardingAutosaveProvider';
import {
  useCreatePortfolioItem,
  useProviderPortfolio,
  portfolioErrorCode,
} from '../../../hooks/provider/useProviderPortfolio';
import {
  preparePortfolioUpload,
  uploadPortfolioFile,
} from '../../../../lib/provider/provider-portfolio-api';
import { currentPublicationAck } from '../../../../lib/provider/publication-ack';
import { PUBLIC_PROFILE_COPY, type Lang } from '../copy/public-profile-copy';
import { OnboardingAlert } from './OnboardingAlert';
import {
  ProviderButton,
  ProviderCard,
  ProviderErrorState,
  ProviderSkeleton,
  ProviderTextArea,
} from '../../provider-ui';

// Sprint 9B.23 — V2 Task 5: the public profile, and the work behind it.
// Sprint 09B.29 Phase 5A — rebuilt as the two approved screens: `profile`
// (task 5 of 6, part 1) and `portfolio` (part 2).
//
// WHAT THE APPROVED DESIGN CHANGED
//
//   the title      gone as an INPUT. The approved profile screen shows what a
//                  customer will read and offers nothing to edit; the
//                  generated title is server-owned under ruling C1, and the
//                  experience screen already explains it can be changed later
//                  on the surface that owns it.
//   the bio        one field with one sentence of guidance. The counter, the
//                  examples panel and the minimum-length hint are not on the
//                  approved screen. The server still enforces the minimum, so
//                  a short bio is refused at submission rather than here —
//                  RECORDED FOR PHASE 5B, because losing the counter means the
//                  provider learns the rule later than they used to.
//   the portfolio  composed here rather than borrowed. `PortfolioSection` is
//                  the Sprint 9B.10 workspace gallery, and the conformance
//                  gate refuses that import by name: it carries its own
//                  dialogs, badges and chrome, none of which is on the
//                  approved screen.
//
// WHAT WAS DELIBERATELY KEPT
//
// The publication-rights acknowledgement. The server records WHICH wording was
// agreed to and refuses a stale version, so a create that sent
// `publicationRightAck: true` without showing the sentence would be recording
// agreement to text nobody saw. The approved screen does not draw it because
// the reference depicts the screen at REST — the gate appears after a file is
// picked, which is a state the reference never shows.

/**
 * The server's ceiling, kept as an input cap now that the counter is gone.
 *
 * The approved screen shows no character count, but the limit is still real:
 * without `maxLength` a provider could type past it and only learn so when
 * the save was refused. The attribute enforces it silently and draws nothing.
 */
const MAX_BIO_LENGTH = 2000;

interface PublicProfileTaskScreenProps {
  view: ProviderOnboardingDraftView;
  lang: Lang;
  editable: boolean;
  part: PublicProfilePart;
}

/** Which of the task's two approved screens is showing. */
export type PublicProfilePart = 'profile' | 'portfolio';

export function PublicProfileTaskScreen({
  view,
  lang,
  editable,
  part,
}: PublicProfileTaskScreenProps) {
  const copy = PUBLIC_PROFILE_COPY[lang];
  const autosave = useOnboardingStepAutosave('PROFILE');
  const { trackExternalWork } = useOnboardingAutosave();

  const data = view.data;
  const [bio, setBio] = useState(data.bio ?? '');

  /**
   * Never write an empty bio as a value the server must interpret.
   *
   * Clearing IS a real intention, so an empty field writes null — the provider
   * is removing something they said — and the server's minimum-length rule
   * still decides whether the task is complete.
   */
  const commitBio = (next: string) => {
    const trimmed = next.trim();
    autosave.save({ bio: trimmed === '' ? null : trimmed });
  };

  /** What a customer reads first. Server-owned; never edited here. */
  const publicTitle = data.suggestedTitle?.[lang] ?? data.headline ?? '';

  /**
   * The preview line, composed from the draft and from nothing else.
   *
   * Every part is already the provider's own answer: the city they typed, the
   * radius the server granted, the years the stepper set. Absent when any of
   * them is — a half-composed line reads as a defect rather than as a profile.
   */
  const previewCity = data.serviceAreaCity?.split(',')[0]?.trim() ?? null;
  const previewKm = data.serviceAreaRadiusKm ?? data.radiusPolicy?.suggestedKm ?? null;
  const previewYears = data.yearsOfExperience ?? null;
  const previewLine =
    previewCity && previewKm !== null && previewYears !== null
      ? copy.previewLine(previewCity, previewKm, previewYears)
      : null;

  // ── The portfolio ────────────────────────────────────────────────────────

  const gallery = useProviderPortfolio();
  const createItem = useCreatePortfolioItem();
  const fileInput = useRef<HTMLInputElement>(null);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const ack = currentPublicationAck(lang === 'ar' ? 'ar' : 'en');

  const items = gallery.data?.items ?? [];

  const runUpload = useCallback(
    async (file: File) => {
      setUploadError(null);
      try {
        const prepared = await preparePortfolioUpload(file);
        await uploadPortfolioFile(prepared.uploadUrl, file);
        await createItem.mutateAsync({
          storageKey: prepared.storageKey,
          contentType: file.type,
          sizeBytes: file.size,
          publicationRightAck: true,
          // WHICH wording was shown. The server refuses a stale version rather
          // than recording agreement to text nobody saw.
          publicationRightAckVersion: ack.version,
        });
        setPendingFile(null);
        setConsent(false);
      } catch (err) {
        setUploadError(portfolioErrorCode(err) ?? 'UPLOAD_FAILED');
        // Rethrown so the exit coordinator can tell a failed upload from a
        // finished one; `trackExternalWork` terminates the rejection.
        throw err;
      }
    },
    [ack.version, createItem],
  );

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setPendingFile(file);
  };

  // ── Screen 8: the public profile ─────────────────────────────────────────
  if (part === 'profile') {
    return (
      <div className="flex flex-col gap-[18px]" data-testid="public-profile-task">
        <ProviderTextArea
          label={copy.bioApprovedLabel}
          hint={copy.bioApprovedHint}
          data-testid="bio-input"
          maxLength={MAX_BIO_LENGTH}
          value={bio}
          disabled={!editable}
          onChange={(event) => {
            setBio(event.target.value);
            commitBio(event.target.value);
          }}
          onBlur={() => commitBio(bio)}
        />

        {/* `.hsm-panel`: what a customer will actually read, composed from what
            the provider has already told the server. Nothing here is a second
            source of truth; it is the same draft, read back. */}
        <ProviderCard className="p-4" style={{ borderRadius: 14 }} data-testid="customer-preview">
          <h3
            className="break-words text-pv-input text-pv-text"
            style={{ marginBottom: 5, fontWeight: 500, lineHeight: 1.25 }}
          >
            {copy.previewTitle}
          </h3>
          <p className="break-words text-pv-label text-pv-muted" style={{ lineHeight: 1.65 }}>
            {/* Weight only. `.hsm-panel p` is muted and the `strong` inside it
                inherits that — the title is emphasis within a quiet block, not
                a heading in its own right. */}
            <strong className="font-medium" data-testid="preview-title">
              {publicTitle}
            </strong>
            {previewLine ? (
              <>
                <br />
                <span data-testid="preview-line">{previewLine}</span>
              </>
            ) : null}
          </p>
        </ProviderCard>
      </div>
    );
  }

  // ── Screen 9: the portfolio ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-[18px]" data-testid="portfolio-section">
      {/* `.hsm-upload`, the same surface the photo on Basics uses — with a
          second line here, because this screen can crop and reorder where the
          avatar cannot. One `accept="image/*"` input with no `capture`, which
          is what makes "take a photo or choose from gallery" true on a phone. */}
      <button
        type="button"
        data-testid="portfolio-add-photo"
        disabled={!editable}
        onClick={() => fileInput.current?.click()}
        className="grid min-h-[128px] w-full place-items-center rounded-pv-card border-[1.5px] border-dashed border-pv-border-strong bg-pv-surface p-[18px] text-center text-pv-accent-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
      >
        <ImagePlus size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className="mt-2 text-pv-label font-bold leading-pv-base">{copy.uploadPrompt}</span>
        {/* No margin here: `.hsm-upload` stretches its rows, and only its `p`
            declares one. A second `mt-2` added 5px the reference does not have. */}
        <span className="text-pv-help font-normal leading-pv-help text-pv-muted">
          {copy.uploadHint}
        </span>
      </button>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onPick}
        data-testid="portfolio-file-input"
        aria-label={copy.choosePhotoFile}
        tabIndex={-1}
      />

      {/* `.hsm-photos`: three columns, 8px gutters, square tiles. */}
      {items.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2" data-testid="portfolio-grid">
          {items.map((item, index) => (
            <li
              key={item.id}
              data-testid={`portfolio-item-${item.id}`}
              data-moderation={item.moderationState}
              className="pv-photo-surface relative grid aspect-square place-items-center overflow-hidden rounded-pv-control"
            >
              {/* A photo the platform has not cleared is NOT shown.

                  That is not a styling choice — it is the promise the notice
                  below makes in words: review "controls when photos become
                  visible". Rendering the image anyway would contradict it on
                  the one screen that states it. */}
              {item.moderationState === 'APPROVED' && item.media?.url ? (
                <img
                  src={item.media.url}
                  alt={item.title ?? ''}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Paintbrush size={16} strokeWidth={1.8} aria-hidden="true" />
              )}

              {index === 0 ? (
                <span
                  className="absolute inset-x-[5px] bottom-[5px] rounded-sm bg-pv-photo-label px-1.5 py-[3px] text-pv-photo-label-fg text-pv-photo-caption"
                  data-testid="portfolio-cover-label"
                >
                  {copy.coverPhoto}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* The consent gate. Shown only once a file is waiting, which is why it
          does not appear on the approved screen at rest. */}
      {pendingFile ? (
        <ProviderCard className="flex flex-col gap-3 p-4" data-testid="portfolio-consent">
          {/* A real checkbox, ticked deliberately, and the exact sentence the
              server will record agreement to. Not a button whose label implies
              consent: the version is stored against the wording, and a provider
              must have been shown the wording they are agreeing to. */}
          <label className="flex items-start gap-2.5 text-pv-label font-normal leading-pv-help text-pv-text">
            <input
              type="checkbox"
              className="ms-1 me-[3px] mt-0.5 h-5 w-5 flex-shrink-0 accent-pv-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span className="min-w-0 break-words">{ack.text}</span>
          </label>
          <div className="flex gap-2">
            <ProviderButton
              tone="secondary"
              shape="onboarding"
              onClick={() => {
                setPendingFile(null);
                setConsent(false);
              }}
              data-testid="portfolio-consent-cancel"
            >
              {copy.cancel}
            </ProviderButton>
            <ProviderButton
              tone="primary"
              shape="onboarding"
              disabled={!consent}
              onClick={() => trackExternalWork(runUpload(pendingFile))}
              data-testid="portfolio-consent-agree"
            >
              {copy.addPhoto}
            </ProviderButton>
          </div>
        </ProviderCard>
      ) : null}

      {uploadError ? (
        <p
          className="break-words text-pv-label text-pv-danger"
          role="alert"
          data-testid="portfolio-error"
        >
          {copy.uploadFailed}
        </p>
      ) : null}

      <OnboardingAlert
        tone="waiting"
        icon={Clock}
        title={copy.photosCheckingTitle}
        body={copy.photosCheckingBody}
        density="compact"
        data-testid="portfolio-moderation-notice"
      />
    </div>
  );
}

// ─── Container ──────────────────────────────────────────────────────────────

/** Loads the draft and renders Task 5. Mirrors the other task containers. */
export function PublicProfileTask({ lang, part }: { lang: Lang; part: PublicProfilePart }) {
  const draft = useOnboardingDraft();
  const copy = PUBLIC_PROFILE_COPY[lang];

  if (!draft.isFetched) {
    return <ProviderSkeleton label={copy.heading} />;
  }

  const view = draft.data;
  const usable = view && typeof view.version === 'number' && view.data !== undefined;

  if (!usable) {
    return <ProviderErrorState title={copy.heading} testId="public-profile-load-failed" />;
  }

  return <PublicProfileTaskScreen view={view} lang={lang} editable={view.editable} part={part} />;
}
