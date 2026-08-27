import { useEffect, useRef, useState } from 'react';
import type {
  AdminVerificationCase,
  VerificationCaseActionCode,
} from '@homeservicemarketplace/contracts';

import { useLang } from '../../../i18n/LanguageContext';
import { UI } from '../copy/verification-copy';

// Sprint 9B.12 — the verification-CASE actions.
//
// docs/sprint-09b12/ADMIN_VERIFICATION_UX.md
//
// THERE IS NO TRANSITION TABLE IN THIS FILE, and that absence is the design.
// Every button rendered comes from the server's `availableActions`, which is
// computed per reviewer — a self-review is already absent rather than
// rendered-then-refused. A client-side map from state to buttons would be a
// second copy of the rules, and the copy in React is the one the reviewer
// sees, so it is the one that would be wrong.
//
// The only lookups below are of NAMES: which label, which reason list, which
// confirmation sentence. None of them decides whether an action is offered.
//
// This panel is the CASE axis only. Provider-ACCOUNT actions (approve, reject,
// suspend, reactivate on /v1/admin/providers) render in their own panel from
// their own `availableActions`. Approving a case is a judgement about
// documents; suspending an account is a judgement about conduct. A single
// merged action list would have to pick one verb for two decisions, and a
// reviewer would eventually make one meaning the other.

const ACTION_LABEL: Record<VerificationCaseActionCode, string> = {
  assign: 'actionAssign',
  requestAction: 'actionRequestAction',
  approve: 'actionApprove',
  reject: 'actionReject',
  reverify: 'actionReverify',
  revoke: 'actionRevoke',
};

/** Which actions need a reason on the record. Mirrors the server's
 *  `requiresReason`; the server refuses without one regardless, so this only
 *  decides whether to ASK rather than whether to allow. */
const NEEDS_REASON: ReadonlySet<VerificationCaseActionCode> = new Set([
  'requestAction',
  'approve',
  'reject',
  'reverify',
  'revoke',
]);

/** Reason codes worth offering per action. A shortlist for the common case —
 *  never a restriction, because the server owns the enum. */
const REASON_CHOICES: Partial<Record<VerificationCaseActionCode, string[]>> = {
  approve: ['DOCUMENTS_COMPLETE_AND_LEGIBLE'],
  requestAction: ['DOCUMENT_MISSING', 'DOCUMENT_ILLEGIBLE', 'DOCUMENT_EXPIRED', 'OTHER'],
  reject: ['DOCUMENT_MISMATCH', 'SUSPECTED_FORGERY', 'DUPLICATE_IDENTITY', 'OTHER'],
  reverify: ['POLICY_PERIOD_ELAPSED', 'OTHER'],
  revoke: ['TRUST_AND_SAFETY_ACTION', 'PROVIDER_REQUESTED', 'OTHER'],
};

const CONFIRM_COPY: Partial<Record<VerificationCaseActionCode, string>> = {
  approve: 'confirmApprove',
  reject: 'confirmReject',
  revoke: 'confirmRevoke',
};

export interface CaseActionsPanelProps {
  verificationCase: AdminVerificationCase;
  /** Resolves when the command has been sent. Rejects with the axios error so
   *  this panel can tell a 409 from a 403 — two very different things to show
   *  a reviewer. */
  onRun: (input: {
    action: VerificationCaseActionCode;
    reasonCode?: string;
    note?: string;
    expectedState: string;
  }) => Promise<unknown>;
  pending?: boolean;
  /** HTTP status of the last failure, if any. */
  errorStatus?: number | null;
  onReload?: () => void;
}

export function CaseActionsPanel({
  verificationCase: kase,
  onRun,
  pending = false,
  errorStatus = null,
  onReload,
}: CaseActionsPanelProps) {
  const { lang, dir } = useLang();
  const t = UI[lang];

  const [chosen, setChosen] = useState<VerificationCaseActionCode | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  // Focus moves INTO the dialog when it opens and BACK to the button that
  // opened it when it closes. Without the return, a keyboard reviewer who
  // cancels is dropped at the top of the document and has to tab back through
  // the whole case.
  useEffect(() => {
    if (chosen) dialogRef.current?.focus();
    else openerRef.current?.focus();
  }, [chosen]);

  function close() {
    setChosen(null);
    setReasonCode('');
    setNote('');
    setValidationError(null);
  }

  async function confirm() {
    if (!chosen) return;
    if (NEEDS_REASON.has(chosen) && !reasonCode) {
      setValidationError(t.reasonRequired);
      return;
    }
    try {
      await onRun({
        action: chosen,
        reasonCode: reasonCode || undefined,
        note: note || undefined,
        // The state the reviewer was LOOKING at. The server refuses with 409
        // if the case has moved on, which is what stops two reviewers with the
        // same case open from both deciding it.
        expectedState: kase.state,
      });
      close();
    } catch {
      // The failure is rendered from `errorStatus` by the parent, which owns
      // the request. Swallowing here keeps the dialog open so the reviewer can
      // see what happened next to what they were doing.
    }
  }

  // ── failures that replace the actions entirely ──────────────────────────

  if (errorStatus === 403) {
    return (
      <section aria-label={t.caseActions} dir={dir} data-testid="case-actions-forbidden">
        <h4 className="text-sm font-semibold">{t.forbiddenTitle}</h4>
        <p role="alert" className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t.forbiddenBody}
        </p>
      </section>
    );
  }

  const actions = kase.availableActions ?? [];

  return (
    <section aria-label={t.caseActions} dir={dir} data-testid="case-actions" className="space-y-2">
      <h4 className="text-sm font-semibold">{t.caseActions}</h4>
      {/* Says out loud that these are not the account actions. A reviewer who
          conflates them suspends someone for a blurry passport. */}
      <p className="text-xs text-slate-500 dark:text-slate-400">{t.axisNote}</p>

      {errorStatus === 409 && (
        <div role="alert" data-testid="case-actions-conflict" className="rounded-lg border p-2">
          <p className="text-sm font-semibold">{t.conflictTitle}</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t.conflictBody}</p>
          {onReload && (
            <button
              type="button"
              onClick={onReload}
              className="mt-1 text-sm font-semibold underline"
            >
              {t.reload}
            </button>
          )}
        </div>
      )}

      {actions.length === 0 ? (
        <p data-testid="case-actions-none" className="text-sm text-slate-600 dark:text-slate-300">
          {/* The server said WHY, in a stable code. Rendering the reason beats
              an empty panel that looks broken. */}
          {kase.blockedReason === 'SELF_REVIEW'
            ? t.selfReview
            : kase.blockedReason === 'TERMINAL_STATE'
              ? t.terminalState
              : kase.blockedReason === 'NOT_SUBMITTED'
                ? t.notSubmitted
                : t.noActions}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              data-testid={`case-action-${action}`}
              disabled={pending}
              onClick={(e) => {
                openerRef.current = e.currentTarget;
                setChosen(action);
              }}
              className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {t[ACTION_LABEL[action]]}
            </button>
          ))}
        </div>
      )}

      {/* ── confirmation, with the reason captured before anything is sent ── */}
      {chosen && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t.confirmTitle}
          tabIndex={-1}
          dir={dir}
          data-testid="case-action-dialog"
          className="rounded-lg border p-3 space-y-2"
          onKeyDown={(e) => {
            // Escape closes. A modal a keyboard user cannot dismiss is a trap.
            if (e.key === 'Escape') close();
          }}
        >
          <h5 className="text-sm font-semibold">{t.confirmTitle}</h5>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t[CONFIRM_COPY[chosen] ?? 'confirmGeneric']}
          </p>

          {NEEDS_REASON.has(chosen) && (
            <>
              <label className="block text-sm" htmlFor="case-action-reason">
                {t.reasonLabel}
              </label>
              <select
                id="case-action-reason"
                data-testid="case-action-reason"
                value={reasonCode}
                onChange={(e) => {
                  setReasonCode(e.target.value);
                  setValidationError(null);
                }}
                className="w-full rounded-lg border px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {(REASON_CHOICES[chosen] ?? ['OTHER']).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>

              <label className="block text-sm" htmlFor="case-action-note">
                {t.noteLabel}
              </label>
              <textarea
                id="case-action-note"
                data-testid="case-action-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border px-2 py-1.5 text-sm"
              />
              {/* Says plainly that the provider never sees this. A reviewer who
                  believed otherwise would either write nothing useful or write
                  something they would not want read back to them. */}
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.noteHint}</p>
            </>
          )}

          {validationError && (
            <p role="alert" data-testid="case-action-validation" className="text-sm text-red-600">
              {validationError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              data-testid="case-action-confirm"
              disabled={pending}
              onClick={() => void confirm()}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t.confirm}
            </button>
            <button
              type="button"
              data-testid="case-action-cancel"
              onClick={close}
              className="rounded-lg border px-3 py-1.5 text-sm font-semibold"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
