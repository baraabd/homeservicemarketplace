import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VerificationDocumentKindCode } from '@homeservicemarketplace/contracts';

import { useLang } from '../../../i18n/LanguageContext';
import { Button } from '../../../components/ds/Button';
import { Badge } from '../../../components/ui/badge';
import { Progress } from '../../../components/ui/progress';
import { Skeleton } from '../../../components/ui/skeleton';
import { useProviderProfile } from '../../../hooks/provider/useProviderProfile';
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

export function ProviderVerificationScreen() {
  const { lang, dir } = useLang();
  const qc = useQueryClient();
  const t = UI_COPY[lang];

  const capsQuery = useQuery({ queryKey: CAPS_KEY, queryFn: getProviderCapabilities });
  const caseQuery = useQuery({ queryKey: CASE_KEY, queryFn: getVerificationCase });
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

  const startMut = useMutation({ mutationFn: startVerificationCase, onSuccess: invalidate });
  const submitMut = useMutation({ mutationFn: submitVerificationCase, onSuccess: invalidate });

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
    if (!pendingKind) return;
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
      setErrorText(t.loadFailed);
    } finally {
      setProgress(null);
    }
  }

  function primaryAction() {
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
        const first = view.outstanding[0] ?? null;
        setPendingKind((first?.kind as VerificationDocumentKindCode) ?? 'INDIVIDUAL_IDENTITY');
        setPendingCategory(first?.serviceCategoryId ?? null);
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
    view.state === 'READY_TO_SUBMIT' && view.availableActions.includes('submit');

  /** Only the states where sending a document is actually possible.
   *
   *  The picker is not rendered otherwise, and that is an accessibility fix
   *  rather than tidiness: a file input is exposed as a BUTTON to assistive
   *  technology, so leaving it mounted puts a "choose a file" control in the
   *  tab order of a screen — "with our team" — where uploading does nothing. */
  const canUpload =
    view.state === 'EVIDENCE_REQUIRED' ||
    view.state === 'EVIDENCE_UNUSABLE' ||
    view.state === 'CHANGES_REQUESTED';

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
        <p role="alert" data-testid="verification-error" className="text-sm text-destructive">
          {errorText}
        </p>
      )}

      <VerificationAxisBadges axes={view.axes} />

      {/* What the reviewer said, when there is something to act on. */}
      {(view.state === 'CHANGES_REQUESTED' || view.state === 'REJECTED') && (
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
          className="sr-only"
          // Its own accessible name, distinct from the button that opens it:
          // two controls sharing one name is an ambiguity for anyone
          // navigating by name.
          aria-label={t.uploadLabel}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFileChosen(file);
            e.target.value = '';
          }}
        />
      )}

      {/* Sprint 9B.24 — READY_TO_SUBMIT is the one state whose CTA is a case
          TRANSITION rather than a local navigation, so it is the one gated on
          the server's own action list. The others open a file picker or start a
          new case, neither of which the transition table governs. */}
      {copy.cta && (view.state !== 'READY_TO_SUBMIT' || canSubmitCase) && (
        <Button
          tone="provider"
          fullWidth
          state={busy ? 'loading' : 'default'}
          onClick={primaryAction}
        >
          {copy.cta}
        </Button>
      )}
    </section>
  );
}
