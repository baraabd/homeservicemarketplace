import { useEffect, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useNavigate } from 'react-router';
import type { DisputeIntakeContext, DisputeIssueCode, DisputeRequestedOutcome } from '@homeservicemarketplace/contracts';
import { useCreateCase, caseErrorStatus } from './api';
import { DISPUTE_COPY, type CaseLanguage } from './copy';
import { CaseNotice } from '../case-ui/CasePrimitives';
import { CaseLeaveDialog } from '../case-ui/CaseLeaveDialog';

/** No browser persistence for private narrative. Writes are acknowledged, never optimistic. */
export function IntakeForm({ context, lang, readOnly, refresh }: {
  context: DisputeIntakeContext; lang: CaseLanguage; readOnly: boolean; refresh: () => void;
}) {
  const t = DISPUTE_COPY[lang];
  const [step, setStep] = useState(0);
  const [issue, setIssue] = useState<DisputeIssueCode | ''>('');
  const [outcome, setOutcome] = useState<DisputeRequestedOutcome | ''>('');
  const [statement, setStatement] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [existingCaseId, setExistingCaseId] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmed = useRef(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const sending = useRef(false);
  const mutation = useCreateCase();
  const navigate = useNavigate();
  const dirty = !!(issue || outcome || statement);
  const blocker = useBlocker(() => !confirmed.current && (dirty || sending.current));
  useBeforeUnload((event) => {
    if (!confirmed.current && (dirty || sending.current)) { event.preventDefault(); event.returnValue = ''; }
  });
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);
  function advance() {
    if (!issue || (step > 0 && (!outcome || statement.trim().length < 20 || statement.trim().length > 4000))) {
      setInvalid(true); return;
    }
    setInvalid(false); setStep((value) => Math.min(2, value + 1));
  }
  async function submit() {
    if (sending.current || readOnly || !context.canOpen || !context.policyVersion || !issue || !outcome) return;
    if (statement.trim().length < 20 || statement.trim().length > 4000) { setInvalid(true); return; }
    const input = { bookingId: context.booking.id, policyVersion: context.policyVersion, issueCode: issue, requestedOutcome: outcome, statement: statement.trim() };
    const signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    sending.current = true;
    try {
      const result = await mutation.mutateAsync({ ...input, idempotencyKey: attempt.current.key });
      if (!result.created && !result.replayed) {
        setExistingCaseId(result.dispute.id);
        return;
      }
      confirmed.current = true;
      navigate(`/disputes/${encodeURIComponent(result.dispute.id)}`, { replace: true });
    } catch { /* The inline error retains all entered fields and the retry intent. */ }
    finally { sending.current = false; }
  }
  return (
    <>
      <form className="case-stack" onSubmit={(event) => { event.preventDefault(); if (step === 2) void submit(); else advance(); }} aria-busy={mutation.isPending}>
        <ol className="case-steps" aria-label={lang === 'ar' ? 'خطوات الإرسال' : 'Submission steps'}>
          {t.steps.map((label, index) => <li key={index} aria-current={index === step ? 'step' : undefined}>{(index + 1).toLocaleString(lang)}. {label}</li>)}
        </ol>
        <section className="case-card case-stack">
          <h2 ref={heading} tabIndex={-1}>{step === 0 ? t.issueTitle : step === 1 ? t.detailsTitle : t.reviewTitle}</h2>
          {step === 0 && <><p className="case-muted">{t.issueHint}</p><fieldset disabled={readOnly || mutation.isPending || !context.canOpen} className="case-options two-columns"><legend className="sr-only">{t.issueTitle}</legend>{context.issueCodes.map((code) => <label className="case-option" key={code}><input type="radio" name="issue" value={code} checked={issue === code} onChange={() => { setIssue(code); setInvalid(false); }} required /><span>{t.issues[code]}</span></label>)}</fieldset></>}
          {step === 1 && <>
            <label className="case-field" htmlFor="case-statement">{t.statement}<textarea id="case-statement" disabled={readOnly || mutation.isPending || !context.canOpen} data-testid="case-statement" value={statement} maxLength={4000} required aria-describedby="case-statement-hint" aria-invalid={invalid && statement.trim().length < 20} onChange={(event) => { setStatement(event.target.value); setInvalid(false); }} /><small id="case-statement-hint">{t.statementHint}</small></label>
            <fieldset disabled={readOnly || mutation.isPending || !context.canOpen} className="case-options"><legend>{t.outcome}</legend>{context.requestedOutcomes.map((code) => <label className="case-option" key={code}><input type="radio" name="outcome" value={code} checked={outcome === code} onChange={() => { setOutcome(code); setInvalid(false); }} required /><span>{t.outcomes[code]}</span></label>)}</fieldset>
            <p className="case-muted">{t.outcomeHint}</p><CaseNotice>{t.evidence}</CaseNotice>
          </>}
          {step === 2 && <><dl className="case-definition"><div><dt>{t.issueTitle}</dt><dd>{issue && t.issues[issue]}</dd></div><div><dt>{t.statement}</dt><dd className="case-statement">{statement}</dd></div><div><dt>{t.outcome}</dt><dd>{outcome && t.outcomes[outcome]}</dd></div></dl><CaseNotice>{t.privacy}</CaseNotice></>}
          {existingCaseId && <CaseNotice>{t.blocked.ALREADY_OPEN}<p>{t.unsaved}</p><Link className="case-button" to={`/disputes/${encodeURIComponent(existingCaseId)}`}>{t.open}</Link></CaseNotice>}
          {invalid && <CaseNotice alert>{t.invalid}</CaseNotice>}
          {mutation.isError && <CaseNotice alert>{caseErrorStatus(mutation.error) === 409 ? t.conflict : t.submissionFailed}{caseErrorStatus(mutation.error) === 409 && <div><button type="button" className="case-button" onClick={refresh}>{t.refresh}</button></div>}</CaseNotice>}
          {!context.canOpen && context.blocker && <CaseNotice alert>{t.blocked[context.blocker]}</CaseNotice>}
          <div className="case-actions">{step > 0 && <button type="button" className="case-button" disabled={mutation.isPending} onClick={() => { setInvalid(false); setStep((value) => value - 1); }}>{t.previous}</button>}<button type="submit" className="case-button case-button-primary" disabled={readOnly || mutation.isPending || !context.canOpen}>{mutation.isPending ? t.sending : step === 2 ? t.submit : t.next}</button></div>
          <p className="case-muted" role="status">{mutation.isPending ? t.sending : t.unsaved}</p>
        </section>
      </form>
      <CaseLeaveDialog open={blocker.state === 'blocked'} title={t.leaveTitle}
        description={mutation.isPending ? t.pendingLeave : t.leaveHint}
        stayLabel={t.stay} leaveLabel={t.leave} pending={mutation.isPending}
        onStay={() => { if (blocker.state === 'blocked') blocker.reset(); }}
        onLeave={() => { if (blocker.state === 'blocked') blocker.proceed(); }} />
    </>
  );
}
