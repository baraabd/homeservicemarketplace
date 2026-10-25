import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { VerificationDocumentKindCode } from '@homeservicemarketplace/contracts';

import { useLang } from '../../../i18n/LanguageContext';
import { Button } from '../../../components/ds/Button';
import { Badge } from '../../../components/ui/badge';
import { Progress } from '../../../components/ui/progress';
import { Skeleton } from '../../../components/ui/skeleton';
import { useProviderProfile } from '../../../hooks/provider/useProviderProfile';
import { isProviderOnboardingV2Enabled } from '../../../../lib/feature-flags';
import {
  getProviderCapabilities,
  getVerificationCase,
  startVerificationCase,
  submitVerificationCase,
  uploadEvidence,
} from '../../../../lib/provider/provider-verification-api';
import {
  DOCUMENT_KIND_LABELS,
  SCAN_STATE_LABELS,
  STATE_COPY,
  UI_COPY,
  reasonText,
} from '../copy/provider-verification-copy';
import { deriveVerificationView } from '../verification-view-state';
import { VerificationAxisBadges } from './VerificationAxisBadges';

// Sprint 9B.11 — the provider's verification screen.
//
// docs/sprint-09b11/PROVIDER_VERIFICATION_EXPERIENCE.md
//
// This component RENDERS. It decides nothing: `deriveVerificationView` owns the
// precedence, and its own test proves all fourteen states are reachable and
// that a suspended provider is never shown an upload button.
//
// REUSED: `ds/Button`, `ui/{badge,progress,skeleton}`, `useLang`, the existing
// `useProviderProfile` query, and the reviewer surface's DOCUMENT_KIND_LABELS
// and SCAN_STATE_LABELS. The visual language — gradient header card, rounded
// corners, Cairo for Arabic — is lifted from ProviderStatusState so this screen
// belongs to the same app rather than looking like a bolt-on.

const CASE_KEY = ['provider', 'verification', 'case'] as const;
const CAPS_KEY = ['provider', 'verification', 'capabilities'] as const;
const ACCEPTED = 'image/jpeg,image/png,image/webp,application/pdf';

type ApplicationCorrection = 'profileRequired' | 'termsRequired' | 'profileAndTermsRequired';

/** Explain only the server's documented readiness blockers; never echo its prose. */
function applicationCorrectionFrom(error: unknown): ApplicationCorrection | null {
  if (
    !isAxiosError<{ error?: { code?: unknown; details?: { blockers?: unknown } } }>(error) ||
    error.response?.status !== 422 ||
    error.response.data?.error?.code !== 'VALIDATION_ERROR'
  ) {
    return null;
  }
  const blockers = error.response.data.error.details?.blockers;
  if (!Array.isArray(blockers)) return null;
  const codes = new Set(
    blockers.flatMap((blocker: unknown) =>
      blocker !== null && typeof blocker === 'object' && 'code' in blocker ? [blocker.code] : [],
    ),
  );
  const profile = codes.has('ONBOARDING_INCOMPLETE');
  const terms = codes.has('TERMS_NOT_ACCEPTED');
  return profile && terms
    ? 'profileAndTermsRequired'
    : profile
      ? 'profileRequired'
      : terms
        ? 'termsRequired'
        : null;
}

export function ProviderVerificationScreen() {
  const { lang, dir } = useLang();
  const qc = useQueryClient();
  const t = UI_COPY[lang];
  const applicationHref = isProviderOnboardingV2Enabled()
    ? '/provider/onboarding'
    : '/provider/profile';

  const capsQuery = useQuery({ queryKey: CAPS_KEY, queryFn: getProviderCapabilities });
  const caseQuery = useQuery({
    queryKey: CASE_KEY,
    queryFn: getVerificationCase,
    refetchInterval: (query) =>
      capsQuery.data?.allowed.includes('MANAGE_VERIFICATION') &&
      query.state.status !== 'error' &&
      Array.isArray(query.state.data?.case?.documents) &&
      query.state.data.case.documents.some(
        (document) => !document.superseded && document.scanState === 'PENDING',
      )
        ? 2000
        : false,
  });
  const profileQuery = useProviderProfile();

  const [progress, setProgress] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<VerificationDocumentKindCode | null>(null);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [offline, setOffline] = useState(
    typeof navigator === 'undefined' ? false : !navigator.onLine,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  // Offline is a first-class state here because this screen is mostly used on a
  // phone, often in a customer's home with poor signal, and a failed upload
  // that looks like a rejection is the worst possible misreading.
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: CASE_KEY });
    void qc.invalidateQueries({ queryKey: CAPS_KEY });
  };

  const startMut = useMutation({
    mutationFn: startVerificationCase,
    onMutate: () => setErrorText(null),
    onSuccess: invalidate,
    onError: () => setErrorText(t.startFailed),
  });
  const submitMut = useMutation({
    mutationFn: submitVerificationCase,
    onMutate: () => setErrorText(null),
    onSuccess: invalidate,
    onError: (error) => setErrorText(t[applicationCorrectionFrom(error) ?? 'submitFailed']),
  });

  const loading = capsQuery.isLoading || caseQuery.isLoading;
  const failed = capsQuery.isError || caseQuery.isError;

  if (loading) {
    return (
      <section
        aria-busy="true"
        aria-label={STATE_COPY[lang].NOT_STARTED.title}
        dir={dir}
        className="space-y-3 p-5"
      >
        <span className="sr-only">{t.loading}</span>
        <Skeleton className="h-28 w-full rounded-3xl" />
        <Skeleton className="h-10 w-2/3 rounded-xl" />
      </section>
    );
  }

  if (failed) {
    return (
      <section aria-label={t.loadFailed} dir={dir} className="space-y-3 p-5">
        <p role="alert" className="text-sm text-destructive">
          {t.loadFailed}
        </p>
        <Button
          variant="secondary"
          tone="provider"
          onClick={() => {
            void capsQuery.refetch();
            void caseQuery.refetch();
          }}
        >
          {t.retry}
        </Button>
      </section>
    );
  }

  const view = deriveVerificationView({
    capabilities: capsQuery.data ?? null,
    verificationCase: caseQuery.data?.case ?? null,
    profile: profileQuery.data?.profile
      ? {
          verified: profileQuery.data.profile.verified,
          topPro: profileQuery.data.profile.topPro,
        }
      : null,
    // No server source for a paid tier on this surface yet. Threaded rather
    // than hard-coded so the badge is real the day one exists — see the doc.
    vip: false,
  });
  const copy = STATE_COPY[lang][view.state];

  async function onFileChosen(file: File) {
    if (!pendingKind || !view.canManageVerification || busy || offline) return;
    setErrorText(null);
    setProgress(0);
    try {
      await uploadEvidence({
        file,
        kind: pendingKind,
        serviceCategoryId: pendingCategory,
        onProgress: setProgress,
      });
      invalidate();
      setPendingKind(null);
      setPendingCategory(null);
    } catch {
      // Deliberately generic: the upload routes refuse with codes about file
      // shape, and a provider on a phone needs "try again" far more than a
      // taxonomy. The specific refusals they CAN act on arrive as scan states
      // on the document list below.
      setErrorText(t.uploadFailed);
    } finally {
      setProgress(null);
    }
  }

  function primaryAction() {
    if (!view.canManageVerification || busy || offline) return;
    switch (view.state) {
      // Sprint 9B.24 — opening a NEW case is the answer to an expired one.
      // VERIFIED_NO_ACCESS is deliberately absent from this group: that
      // provider's documents still stand, and a new case would not restore
      // their permission to work.
      case 'NOT_STARTED':
      case 'REJECTED':
      case 'REVERIFICATION_REQUIRED':
        startMut.mutate();
        return;
      case 'READY_TO_SUBMIT':
        submitMut.mutate();
        return;
      case 'EVIDENCE_REQUIRED':
      case 'EVIDENCE_UNUSABLE':
      case 'CHANGES_REQUESTED': {
        const first = view.uploadTarget;
        // Never invent a document kind when the server supplied no target.
        if (!first) return;
        setPendingKind(first.kind);
        setPendingCategory(first.serviceCategoryId);
        fileInput.current?.click();
        return;
      }
      default:
        return;
    }
  }

  const busy = startMut.isPending || submitMut.isPending || progress !== null;

  /**
   * Sprint 9B.24 — submitting is offered only when the SERVER offers it.
   *
   * `READY_TO_SUBMIT` is this client's reading of the evidence; whether the
   * case may actually move is the transition table's answer, and it now
   * travels on the case as `availableActions`. Gating on the derived state
   * alone is the second copy of a rule that case-transitions.ts exists to
   * prevent — it is how a surface offers a button the API answers with a 409.
   *
   * Both conditions, not either: the server's permission AND a local state
   * where pressing it means something.
   */
  const canSubmitCase =
    view.canManageVerification &&
    (view.state === 'READY_TO_SUBMIT' || view.state === 'CHANGES_REQUESTED') &&
    view.outstanding.length === 0 &&
    view.scanning.length === 0 &&
    view.unusable.length === 0 &&
    view.availableActions.includes('submit');

  /** Mount the programmatic picker only where uploading is permitted.
   * Visible Add/Replace buttons select the document target before opening it. */
  const canUpload =
    view.canManageVerification &&
    view.uploadTarget !== null &&
    (view.state === 'EVIDENCE_REQUIRED' ||
      view.state === 'EVIDENCE_UNUSABLE' ||
      view.state === 'CHANGES_REQUESTED');
  const correctionRequested = caseQuery.data?.case?.state === 'ACTION_REQUIRED';
  const submissionNeedsApplication =
    submitMut.isError && applicationCorrectionFrom(submitMut.error) !== null;
  const showApplicationReturn =
    view.state === 'PENDING_REVIEW' &&
    capsQuery.data?.primaryReason === 'ONBOARDING_INCOMPLETE' &&
    capsQuery.data.allowed.includes('COMPLETE_ONBOARDING');

  return (
    <section
      aria-label={copy.title}
      dir={dir}
      data-testid={`verification-${view.state}`}
      className="space-y-4 p-5"
      style={{ fontFamily: lang === 'ar' ? "'Cairo', 'Inter', sans-serif" : "'Inter', sans-serif" }}
    >
      {/* The headline card, in the Provider app's existing visual language. */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 py-6">
        <div className="absolute -top-6 -end-6 h-28 w-28 rounded-full bg-white/10" />
        <div className="relative">
          {/* aria-live so a provider using a screen reader hears the state
              CHANGE after an upload or a submit, rather than only on load. */}
          <h2
            className="text-white"
            style={{ fontSize: '18px', fontWeight: 800 }}
            aria-live="polite"
          >
            {copy.title}
          </h2>
          <p className="mt-1.5 text-white/75" style={{ fontSize: '13px', lineHeight: 1.55 }}>
            {copy.body}
          </p>
        </div>
      </header>

      {offline && (
        <p
          role="status"
          data-testid="verification-offline"
          className="text-sm text-muted-foreground"
        >
          {t.offline}
        </p>
      )}

      {errorText && (
        <div className="space-y-2">
          <p role="alert" data-testid="verification-error" className="text-sm text-destructive">
            {errorText}
          </p>
          {submissionNeedsApplication && (
            <a
              className="inline-flex min-h-11 items-center text-sm font-semibold underline"
              href={applicationHref}
            >
              {t.returnToApplication}
            </a>
          )}
        </div>
      )}

      {showApplicationReturn && (
        <div className="space-y-2 rounded-xl border p-3">
          <p role="status" className="text-sm">
            {t.applicationNext}
          </p>
          <a
            className="inline-flex min-h-11 items-center text-sm font-semibold underline"
            href={applicationHref}
          >
            {t.returnToApplication}
          </a>
        </div>
      )}

      <VerificationAxisBadges axes={view.axes} />

      {/* What the reviewer said, when there is something to act on. */}
      {(correctionRequested || view.state === 'REJECTED') && (
        <section aria-label={t.reasonHeading} className="rounded-xl border p-3">
          <h3 className="text-sm font-semibold">{t.reasonHeading}</h3>
          <p className="mt-1 text-sm" data-testid="verification-reason">
            {reasonText(lang, view.reasonCode)}
          </p>
        </section>
      )}

      {/* What is still needed. */}
      {view.outstanding.length > 0 && (
        <section aria-label={t.requirementsHeading} className="space-y-1">
          <h3 className="text-sm font-semibold">{t.requirementsHeading}</h3>
          <ul className="space-y-1" data-testid="verification-requirements">
            {view.outstanding.map((r, i) => (
              <li key={`${r.kind}-${r.serviceCategoryId ?? 'none'}-${i}`} className="text-sm">
                {DOCUMENT_KIND_LABELS[lang][r.kind]}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* What has been sent, and where each file stands. */}
      <section aria-label={t.documentsHeading} className="space-y-1">
        <h3 className="text-sm font-semibold">{t.documentsHeading}</h3>
        {(caseQuery.data?.case?.documents ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="verification-no-documents">
            {t.noDocuments}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="verification-documents">
            {(caseQuery.data?.case?.documents ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{DOCUMENT_KIND_LABELS[lang][d.kind]}</span>
                <Badge
                  variant={
                    d.scanState === 'CLEAN'
                      ? 'default'
                      : d.scanState === 'PENDING'
                        ? 'secondary'
                        : 'destructive'
                  }
                  data-testid={`document-${d.id}`}
                  data-scan={d.scanState}
                >
                  {SCAN_STATE_LABELS[lang][d.scanState]}
                </Badge>
                {d.superseded && <span className="text-xs text-muted-foreground">↺</span>}
                {canUpload && !d.superseded && d.scanState !== 'PENDING' && (
                  <Button
                    variant="secondary"
                    tone="provider"
                    state={busy || offline ? 'disabled' : 'default'}
                    onClick={() => {
                      setPendingKind(d.kind);
                      setPendingCategory(d.serviceCategoryId);
                      fileInput.current?.click();
                    }}
                  >
                    {t.replace}
                    <span className="sr-only">: {DOCUMENT_KIND_LABELS[lang][d.kind]}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {progress !== null && (
        <div data-testid="verification-progress">
          <Progress value={progress} aria-label={t.submitting} />
          <p className="text-xs text-muted-foreground">{progress}%</p>
        </div>
      )}

      {canUpload && (
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED}
          // Keyboard and assistive-technology users use the visible buttons,
          // which establish a document target before opening the file picker.
          hidden
          aria-label={t.uploadLabel}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFileChosen(file);
            e.target.value = '';
          }}
        />
      )}

      {/* Submission and resubmission both use the server's action list.
          Opening a case and uploading still require MANAGE_VERIFICATION. */}
      {copy.cta &&
        view.canManageVerification &&
        (view.state !== 'READY_TO_SUBMIT' || canSubmitCase) && (
          <Button
            variant={view.state === 'CHANGES_REQUESTED' && canSubmitCase ? 'secondary' : 'primary'}
            tone="provider"
            fullWidth
            state={busy ? 'loading' : offline ? 'disabled' : 'default'}
            onClick={primaryAction}
          >
            {copy.cta}
          </Button>
        )}
      {view.state === 'CHANGES_REQUESTED' && canSubmitCase && (
        <Button
          tone="provider"
          fullWidth
          state={busy ? 'loading' : offline ? 'disabled' : 'default'}
          onClick={() => submitMut.mutate()}
        >
          {t.resubmit}
        </Button>
      )}
    </section>
  );
}
