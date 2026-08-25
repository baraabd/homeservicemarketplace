import { AlertTriangle, Check, FileText, Lock, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type {
  AdminVerificationCase,
  AdminVerificationDocument,
  AdminVerificationRequirement,
} from '@homeservicemarketplace/contracts';

import {
  CASE_STATE_LABELS,
  DOCUMENT_KIND_LABELS,
  SCAN_STATE_LABELS,
  UI,
  type Lang,
} from '../copy/verification-copy';

// Sprint 9B — the reviewer's evidence surface.
//
// Replaces <DocumentsPlaceholder />, whose copy read "Document storage ships in
// a follow-up sprint." A reviewer approving against a placeholder is approving
// against no evidence at all (docs/sprint-09/INSPECTION.md D-4, seen from the
// UI side).
//
// WHY THIS IS A FEATURE-LOCAL COMPONENT rather than RequestMediaGallery
// (docs/sprint-09b/UX-UI-COMPONENT-AUDIT.md, decision 11):
//
//   RequestMediaGallery is public-media specific by design. It resolves a
//   permanent public URL through resolveMediaUrl and hands it to an <img>,
//   which is correct for a photo of a leaking tap and catastrophic for a
//   passport — that path is @Public(), unauthenticated, and cached
//   `public, immutable` for a year.
//
//   The security semantics here are genuinely different: scan-state gating,
//   short-lived single-use reads minted per open, no signed URL in the query
//   cache, and every open audited. None of that is a styling difference, which
//   is why it is a CREATE rather than an extension.
//
// It still reuses the visual vocabulary — slate surfaces, rounded-2xl controls,
// lucide icons, logical properties — so it reads as the same product.
//
// This component renders METADATA ONLY. It never receives a storage key or a
// signed URL; opening a document is a separate call the parent owns.

function ScanBadge({ doc, lang }: { doc: AdminVerificationDocument; lang: Lang }) {
  const label = SCAN_STATE_LABELS[lang][doc.scanState];

  // Non-colour cue as well as colour (WCAG 2.2 AA): each state carries its own
  // icon and its own words, so the meaning survives greyscale and colour
  // blindness.
  const tone =
    doc.scanState === 'CLEAN'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      : doc.scanState === 'QUARANTINED'
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';

  const Icon =
    doc.scanState === 'CLEAN'
      ? ShieldCheck
      : doc.scanState === 'QUARANTINED'
        ? ShieldAlert
        : AlertTriangle;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${tone}`}
      style={{ fontSize: '10px', fontWeight: 700 }}
    >
      <Icon size={11} aria-hidden />
      {label}
    </span>
  );
}

function RequirementRow({
  requirement,
  lang,
}: {
  requirement: AdminVerificationRequirement;
  lang: Lang;
}) {
  const copy = UI[lang];
  const label = DOCUMENT_KIND_LABELS[lang][requirement.kind];
  const category =
    lang === 'ar' ? requirement.serviceCategoryLabelAr : requirement.serviceCategoryLabelEn;

  return (
    <li className="flex items-center gap-2 py-1.5">
      {requirement.satisfied ? (
        <Check size={14} className="text-green-600 shrink-0" aria-hidden />
      ) : (
        <X size={14} className="text-rose-600 shrink-0" aria-hidden />
      )}
      <span className="text-slate-700 dark:text-slate-200" style={{ fontSize: '12px' }}>
        {label}
        {category ? ` — ${category}` : ''}
      </span>
      {/* The status word, not just the icon colour. */}
      <span className="text-slate-400 ms-auto" style={{ fontSize: '11px', fontWeight: 600 }}>
        {requirement.satisfied ? copy.satisfied : copy.outstanding}
      </span>
    </li>
  );
}

function DocumentRow({
  doc,
  lang,
  onView,
}: {
  doc: AdminVerificationDocument;
  lang: Lang;
  onView?: (documentId: string) => void;
}) {
  const copy = UI[lang];
  const kind = DOCUMENT_KIND_LABELS[lang][doc.kind];
  const category = lang === 'ar' ? doc.serviceCategoryLabelAr : doc.serviceCategoryLabelEn;

  return (
    <li className="flex items-start gap-3 py-2.5 border-b border-slate-50 dark:border-slate-700 last:border-0">
      <FileText size={16} className="text-slate-400 mt-0.5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <p
          className="text-slate-900 dark:text-white truncate"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          {kind}
          {category ? ` — ${category}` : ''}
        </p>
        {/* The uploader's filename, already sanitised server-side: directory
            components stripped, double extensions defused, bidi overrides
            removed. Rendered as a label, never used as a path. */}
        {doc.displayFilename ? (
          <p className="text-slate-400 truncate" style={{ fontSize: '11px' }}>
            {doc.displayFilename}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <ScanBadge doc={doc} lang={lang} />
          {doc.evidenceDeletedAt ? (
            <span className="text-slate-400" style={{ fontSize: '10px' }}>
              {copy.evidenceDeleted}
            </span>
          ) : null}
          {doc.supersededAt ? (
            <span className="text-slate-400" style={{ fontSize: '10px' }}>
              {copy.superseded}
            </span>
          ) : null}
        </div>
      </div>

      {/* `viewable` is computed SERVER-side. The client does not decide from
          scanState — that would put an authorization rule in React and make
          every future scan state viewable by default. */}
      <button
        type="button"
        disabled={!doc.viewable}
        onClick={() => onView?.(doc.id)}
        // 44x44 minimum touch target (WCAG 2.2 AA target size).
        className="shrink-0 inline-flex items-center justify-center gap-1 px-3 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ fontSize: '11px', fontWeight: 700, minHeight: '44px', minWidth: '44px' }}
        aria-label={doc.viewable ? `${copy.view}: ${kind}` : `${copy.notViewable}: ${kind}`}
      >
        <Lock size={11} aria-hidden />
        {doc.viewable ? copy.view : copy.notViewable}
      </button>
    </li>
  );
}

export function VerificationEvidencePanel({
  verificationCase,
  lang,
  isLoading,
  isError,
  onView,
}: {
  verificationCase: AdminVerificationCase | null | undefined;
  lang: Lang;
  isLoading?: boolean;
  isError?: boolean;
  onView?: (documentId: string) => void;
}) {
  const copy = UI[lang];

  return (
    <section className="flex flex-col gap-2" aria-labelledby="verification-evidence-heading">
      <h3
        id="verification-evidence-heading"
        className="text-slate-500"
        style={{ fontSize: '11px', fontWeight: 700 }}
      >
        {copy.documents}
      </h3>

      {/* Reviewers are told their reads are audited. Detection is only a
          deterrent if the people it applies to know about it. */}
      <p className="text-slate-400" style={{ fontSize: '10px' }}>
        {copy.restrictedNotice}
      </p>

      {/* aria-live so a screen-reader user hears the panel resolve rather than
          discovering it by chance on a later tab stop. */}
      <div aria-live="polite" aria-busy={isLoading ? true : undefined}>
        {isLoading ? (
          <p className="text-slate-400 py-4" role="status" style={{ fontSize: '12px' }}>
            {copy.loading}
          </p>
        ) : isError ? (
          <p className="text-rose-600 py-4" role="status" style={{ fontSize: '12px' }}>
            {copy.failed}
          </p>
        ) : !verificationCase ? (
          // "Never submitted" is a STATE, not an error — the endpoint returns
          // null rather than 404 for exactly this reason.
          <p className="text-slate-400 py-4" role="status" style={{ fontSize: '12px' }}>
            {copy.noCase}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                style={{ fontSize: '10px', fontWeight: 700 }}
              >
                {CASE_STATE_LABELS[lang][verificationCase.state]}
              </span>
              {/* The policy version is shown because a reviewer is judging
                  under the rules in force at SUBMISSION, not today's. */}
              <span className="text-slate-400" style={{ fontSize: '10px' }}>
                {copy.policyVersion}: {verificationCase.policyVersion}
              </span>
            </div>

            {verificationCase.requirements.length > 0 ? (
              <div>
                <h4 className="text-slate-500 mb-1" style={{ fontSize: '10px', fontWeight: 700 }}>
                  {copy.requirements}
                </h4>
                <ul className="flex flex-col">
                  {verificationCase.requirements.map((req) => (
                    <RequirementRow
                      key={`${req.kind}:${req.serviceCategoryId ?? ''}`}
                      requirement={req}
                      lang={lang}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            <ul className="flex flex-col">
              {verificationCase.documents.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} lang={lang} onView={onView} />
              ))}
            </ul>

            {/* Why an action a reviewer expects is absent. Stable codes, no
                policy detail — the same discipline as capability denial
                reasons. */}
            {verificationCase.blockedReason ? (
              <p className="text-amber-600 dark:text-amber-400" style={{ fontSize: '11px' }}>
                {verificationCase.blockedReason === 'SELF_REVIEW'
                  ? copy.selfReview
                  : verificationCase.blockedReason === 'NOT_SUBMITTED'
                    ? copy.notSubmitted
                    : copy.terminalState}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
