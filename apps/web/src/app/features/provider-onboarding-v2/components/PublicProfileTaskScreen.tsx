import { AutosaveStatus } from './AutosaveStatus';
import { useState } from 'react';
import { Eye, Lock, ShieldCheck } from 'lucide-react';
import type {
  ProviderOnboardingDraftView,
  ProviderPublicProfilePreviewResponse,
} from '@homeservicemarketplace/contracts';

import { PortfolioSection } from '../../../components/provider/portfolio/PortfolioSection';
import {
  useOnboardingDraft,
  useOnboardingStepAutosave,
} from '../../../hooks/provider/useProviderOnboarding';
import { usePublicProfilePreview } from '../../../hooks/provider/useProviderPortfolio';
import {
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
  validateProfessionalTitle,
} from '../../../../lib/provider/title-format';
import { PUBLIC_PROFILE_COPY, formatCount, type Lang } from '../copy/public-profile-copy';

// Sprint 9B.22 — V2 Task 5: the profile a customer will see.
//
// docs/sprint-09b22/PUBLIC_PROFILE_AND_PORTFOLIO.md
//
// COMPOSITION, NOT CONSTRUCTION. The portfolio below is the Sprint 9B.10
// component, unmodified and unwrapped — same upload pipeline, same ownership
// rules, same limits, same refusal codes. Rebuilding a gallery here would have
// meant a second uploader with its own idea of what a public asset is, which is
// the one thing the portfolio design spends its whole file preventing.
//
// THE PREVIEW IS NOT BUILT FROM THIS PAGE'S STATE.
//
// It is fetched from the server, which builds it with the same projection a
// customer-facing route will use. Rendering it from the draft would show the
// provider a preview of their PRIVATE record — phone number, coordinates,
// pending photos — dressed up as a public page, and it would agree with reality
// only until somebody edited either side.
//
// AND IT DOES NOT PRETEND. There is no public profile route on the platform
// yet, and nothing reviews a portfolio photo. Both facts arrive as flags on the
// preview response and both are said out loud.

interface PublicProfileTaskScreenProps {
  view: ProviderOnboardingDraftView;
  lang: Lang;
  editable: boolean;
}

/** The completeness policy's minimum. Mirrored from the server's
 *  MIN_BIO_LENGTH — the server refuses a shorter one at submission, so telling
 *  the provider now is the difference between a fixable hint and a rejection
 *  three screens later. */
const MIN_BIO_LENGTH = 40;
const MAX_BIO_LENGTH = 2000;

export function PublicProfileTaskScreen({ view, lang, editable }: PublicProfileTaskScreenProps) {
  const copy = PUBLIC_PROFILE_COPY[lang];
  const autosave = useOnboardingStepAutosave('PROFILE');
  const preview = usePublicProfilePreview(lang);

  const data = view.data;
  const [title, setTitle] = useState(data.headline ?? '');
  const [bio, setBio] = useState(data.bio ?? '');

  const suggestion = data.suggestedTitle ? data.suggestedTitle[lang] : null;

  // Validated with the SAME rules Task 2 previewed the suggestion under. A
  // title that was acceptable there and refused here would make the suggestion
  // look like a trap.
  const titleVerdict = title.trim() === '' ? null : validateProfessionalTitle(title);
  const titleError =
    titleVerdict && !titleVerdict.ok ? (copy.titleRefusal[titleVerdict.code] ?? null) : null;

  // Trimmed, because the server trims before it measures. A counter that
  // included trailing spaces would promise a save the server refuses.
  const bioLength = bio.trim().length;
  const bioOver = bioLength > MAX_BIO_LENGTH;
  const bioShort = bioLength > 0 && bioLength < MIN_BIO_LENGTH;

  const commitTitle = () => {
    if (!editable) return;
    const trimmed = title.trim();
    // Never save a title the server's own validator refuses. Sending it anyway
    // would trade a clear inline message for a 422 the provider has to decode.
    if (trimmed !== '' && !validateProfessionalTitle(trimmed).ok) return;
    autosave.save({ headline: trimmed === '' ? null : trimmed });
  };

  const commitBio = () => {
    if (!editable || bioOver) return;
    const trimmed = bio.trim();
    autosave.save({ bio: trimmed === '' ? null : trimmed });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="public-profile-task">
      <p className="break-words text-slate-500 dark:text-slate-400" style={{ fontSize: '13px' }}>
        {copy.intro}
      </p>

      <AutosaveStatus status={autosave.status} lang={lang} testIdPrefix="public-profile" />

      {/* ── What you do ──────────────────────────────────────────────────── */}
      <section aria-labelledby="title-heading" className="min-w-0">
        <h2
          id="title-heading"
          className="break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.titleLegend}
        </h2>
        <p
          className="mt-1 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
        >
          {copy.titleHint}
        </p>

        {/* The suggestion from Task 2. It fills the box; it never writes
            itself — a suggestion that saved silently would put words in
            somebody's mouth on the surface customers judge them by. */}
        {suggestion ? (
          <div
            className="mt-2 flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700"
            data-testid="title-suggestion"
          >
            <span className="min-w-0 flex-1 break-words" style={{ fontSize: '13px' }}>
              <span
                className="block text-slate-500 dark:text-slate-400"
                style={{ fontSize: '11px' }}
              >
                {copy.titleSuggestionLabel}
              </span>
              <span className="text-slate-900 dark:text-white" style={{ fontWeight: 600 }}>
                {suggestion}
              </span>
            </span>
            <button
              type="button"
              disabled={!editable}
              data-testid="title-use-suggestion"
              onClick={() => setTitle(suggestion)}
              className="flex-shrink-0 rounded-xl bg-blue-600 px-3 text-white disabled:opacity-50"
              style={{ minHeight: '44px', fontSize: '13px', fontWeight: 600 }}
            >
              {copy.titleUse}
            </button>
          </div>
        ) : null}

        <label className="mt-2 flex min-w-0 flex-col gap-1" htmlFor="public-title">
          <span className="text-slate-700 dark:text-slate-200" style={{ fontSize: '13px' }}>
            {copy.titleLabel}
          </span>
          <input
            id="public-title"
            data-testid="title-input"
            type="text"
            value={title}
            disabled={!editable}
            maxLength={TITLE_MAX_LENGTH}
            placeholder={copy.titlePlaceholder}
            aria-invalid={titleError ? true : undefined}
            aria-describedby="title-help"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            style={{ minHeight: '44px', fontSize: '15px' }}
          />
        </label>
        <p
          id="title-help"
          className={`mt-1 break-words ${titleError ? 'text-rose-600' : 'text-slate-500 dark:text-slate-400'}`}
          style={{ fontSize: '12px' }}
          data-testid="title-help"
          role={titleError ? 'alert' : undefined}
        >
          {titleError ?? copy.titleTooShort(formatCount(TITLE_MIN_LENGTH, lang))}
        </p>
      </section>

      {/* ── About ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="bio-heading" className="min-w-0">
        <h2
          id="bio-heading"
          className="break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.bioLegend}
        </h2>
        <p
          className="mt-1 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
        >
          {copy.bioHint}
        </p>

        {/* Prompts rather than a template. A pre-filled paragraph gets sent
            unedited, and every provider then sounds the same. */}
        <div
          className="mt-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800"
          data-testid="bio-examples"
        >
          <p
            className="break-words text-slate-700 dark:text-slate-200"
            style={{ fontSize: '12px', fontWeight: 600 }}
            id="bio-examples-label"
          >
            {copy.bioExamplesLabel}
          </p>
          <ul
            className="mt-1 list-disc space-y-1 ps-5 text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px' }}
            aria-labelledby="bio-examples-label"
          >
            {copy.bioExamples.map((example) => (
              <li key={example} className="break-words">
                {example}
              </li>
            ))}
          </ul>
        </div>

        <label className="mt-2 flex min-w-0 flex-col gap-1" htmlFor="public-bio">
          <span className="text-slate-700 dark:text-slate-200" style={{ fontSize: '13px' }}>
            {copy.bioLabel}
          </span>
          <textarea
            id="public-bio"
            data-testid="bio-input"
            value={bio}
            disabled={!editable}
            rows={6}
            placeholder={copy.bioPlaceholder}
            aria-describedby="bio-counter bio-help"
            aria-invalid={bioOver ? true : undefined}
            onChange={(event) => setBio(event.target.value)}
            onBlur={commitBio}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            style={{ fontSize: '15px' }}
          />
        </label>
        <div className="mt-1 flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p
            id="bio-help"
            className={`break-words ${bioShort ? 'text-amber-700' : 'text-slate-500 dark:text-slate-400'}`}
            style={{ fontSize: '12px' }}
            data-testid="bio-help"
          >
            {bioOver
              ? copy.bioCounterOver
              : bioShort
                ? copy.bioTooShort(formatCount(MIN_BIO_LENGTH, lang))
                : ''}
          </p>
          {/* aria-live so a screen reader hears the count change without the
              whole field being re-announced on every keystroke. */}
          <p
            id="bio-counter"
            className={`flex-shrink-0 ${bioOver ? 'text-rose-600' : 'text-slate-500 dark:text-slate-400'}`}
            style={{ fontSize: '12px' }}
            data-testid="bio-counter"
            role="status"
            aria-live="polite"
          >
            {copy.bioCounter(formatCount(bioLength, lang), formatCount(MAX_BIO_LENGTH, lang))}
          </p>
        </div>
      </section>

      {/* ── Portfolio ────────────────────────────────────────────────────── */}
      {/* The Sprint 9B.10 component, as-is. See the header. */}
      <section className="min-w-0" data-testid="public-profile-portfolio">
        <PortfolioSection />
      </section>

      {/* ── Preview ──────────────────────────────────────────────────────── */}
      <PreviewSection
        copy={copy}
        lang={lang}
        state={preview}
        onRefresh={() => void preview.refetch()}
      />
    </div>
  );
}

// ─── Preview ────────────────────────────────────────────────────────────────

function PreviewSection({
  copy,
  lang,
  state,
  onRefresh,
}: {
  copy: PublicProfileCopyShape;
  lang: Lang;
  state: ReturnType<typeof usePublicProfilePreview>;
  onRefresh: () => void;
}) {
  const response: ProviderPublicProfilePreviewResponse | undefined = state.data;

  return (
    <section aria-labelledby="preview-heading" className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2
          id="preview-heading"
          className="flex min-w-0 items-center gap-2 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          <Eye size={16} aria-hidden="true" />
          {copy.previewLegend}
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          data-testid="preview-refresh"
          className="rounded-xl border border-slate-300 px-3 text-slate-700 dark:border-slate-600 dark:text-slate-200"
          style={{ minHeight: '44px', fontSize: '13px' }}
        >
          {copy.previewRefresh}
        </button>
      </div>
      <p
        className="mt-1 break-words text-slate-500 dark:text-slate-400"
        style={{ fontSize: '12px' }}
      >
        {copy.previewHint}
      </p>

      {state.isError ? (
        <p
          className="mt-2 break-words text-rose-600"
          style={{ fontSize: '13px' }}
          role="alert"
          data-testid="preview-load-failed"
        >
          {copy.previewLoadFailed}
        </p>
      ) : null}

      {response ? (
        <>
          <div
            className="mt-2 min-w-0 rounded-2xl border border-slate-200 p-3 dark:border-slate-700"
            data-testid="public-preview"
          >
            <p
              className="break-words text-slate-900 dark:text-white"
              style={{ fontSize: '15px', fontWeight: 700 }}
              data-testid="preview-display-name"
            >
              {response.profile.displayName}
            </p>
            {response.profile.about.headline ? (
              <p
                className="break-words text-slate-700 dark:text-slate-200"
                style={{ fontSize: '13px' }}
                data-testid="preview-headline"
              >
                {response.profile.about.headline}
              </p>
            ) : null}

            {response.profile.about.bio ? (
              <p
                className="mt-2 whitespace-pre-line break-words text-slate-700 dark:text-slate-200"
                style={{ fontSize: '13px' }}
                data-testid="preview-bio"
              >
                {response.profile.about.bio}
              </p>
            ) : (
              <p
                className="mt-2 break-words text-slate-400"
                style={{ fontSize: '13px' }}
                data-testid="preview-about-empty"
              >
                {copy.previewEmptyAbout}
              </p>
            )}

            {response.profile.area.city ? (
              <p
                className="mt-2 break-words text-slate-500 dark:text-slate-400"
                style={{ fontSize: '12px' }}
                data-testid="preview-area"
              >
                {copy.previewAreaLabel}:{' '}
                {[response.profile.area.city, response.profile.area.country]
                  .filter(Boolean)
                  .join(lang === 'ar' ? '، ' : ', ')}
              </p>
            ) : null}

            {response.profile.services.length > 0 ? (
              <p
                className="mt-1 break-words text-slate-500 dark:text-slate-400"
                style={{ fontSize: '12px' }}
                data-testid="preview-services"
              >
                {copy.previewServicesLabel}:{' '}
                {response.profile.services.join(lang === 'ar' ? '، ' : ', ')}
              </p>
            ) : null}

            {response.profile.portfolio.length > 0 ? (
              <ul
                className="mt-3 grid grid-cols-3 gap-2"
                data-testid="preview-photos"
                aria-label={copy.previewLegend}
              >
                {response.profile.portfolio.map((image) => (
                  <li key={image.url} className="min-w-0">
                    <img
                      src={image.url}
                      alt={image.title ?? ''}
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p
                className="mt-3 break-words text-slate-400"
                style={{ fontSize: '12px' }}
                data-testid="preview-no-photos"
              >
                {copy.previewNoPhotos}
              </p>
            )}
          </div>

          {/* ── The honest notices ──────────────────────────────────────────
              Each one is driven by a SERVER flag, so the day the capability
              ships the sentence disappears without a web deploy guessing. */}
          <div className="mt-2 flex min-w-0 flex-col gap-2">
            {!response.publicProfileRouteAvailable ? (
              <Notice icon="lock" testId="notice-route-unavailable">
                {copy.noticeRouteUnavailable}
              </Notice>
            ) : null}
            {response.awaitingReviewCount > 0 ? (
              <Notice icon="lock" testId="notice-awaiting-review">
                {copy.noticeAwaitingReview(formatCount(response.awaitingReviewCount, lang))}
              </Notice>
            ) : null}
            {!response.moderationReviewAvailable && response.awaitingReviewCount > 0 ? (
              <Notice icon="lock" testId="notice-no-reviewer">
                {copy.noticeNoReviewer}
              </Notice>
            ) : null}
            <Notice icon="shield" testId="notice-private-not-shown">
              {copy.noticePrivateNotShown}
            </Notice>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Notice({
  icon,
  testId,
  children,
}: {
  icon: 'lock' | 'shield';
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className="flex min-w-0 items-start gap-2 break-words text-slate-500 dark:text-slate-400"
      style={{ fontSize: '12px' }}
      data-testid={testId}
    >
      <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
        {icon === 'lock' ? <Lock size={14} /> : <ShieldCheck size={14} />}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

type PublicProfileCopyShape = (typeof PUBLIC_PROFILE_COPY)['en'];

/** The same status vocabulary the other tasks use. A conflict is a different
 *  fact from a failure, and "Saved" while the server holds something else is a
 *  lie by omission. */

// ─── Container ──────────────────────────────────────────────────────────────

/** Loads the draft and renders Task 5. Mirrors the other V2 task containers. */
export function PublicProfileTask({ lang }: { lang: Lang }) {
  const draft = useOnboardingDraft();
  const copy = PUBLIC_PROFILE_COPY[lang];

  if (!draft.isFetched) {
    return (
      <div className="flex justify-center py-10" role="status" aria-live="polite">
        <span className="sr-only">{copy.heading}</span>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      </div>
    );
  }

  const view = draft.data;
  const usable = view && typeof view.version === 'number' && view.data !== undefined;

  if (!usable) {
    return (
      <p
        className="break-words text-rose-600"
        style={{ fontSize: '13px' }}
        data-testid="public-profile-load-failed"
      >
        {copy.heading}
      </p>
    );
  }

  return <PublicProfileTaskScreen view={view} lang={lang} editable={view.editable} />;
}
