import { Plus, Trash2 } from 'lucide-react';
import type { DisputeRemedy, DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { DISPUTE_REMEDY_TYPES } from '@homeservicemarketplace/contracts';
import { CaseDate, CaseNotice } from '../../case-ui/CasePrimitives';
import { EVENT_LABELS, WORKSPACE_COPY } from './copy';
import { blankRemedy, type CommandFields, type CommandSelection } from './command-model';
export function RemedyFields({
  value,
  onChange,
  lang,
}: {
  value: DisputeRemedy[];
  onChange: (next: DisputeRemedy[]) => void;
  lang: 'en' | 'ar';
}) {
  const t = WORKSPACE_COPY[lang];
  const edit = (i: number, patch: Partial<DisputeRemedy>) =>
    onChange(value.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  return (
    <fieldset className="cw-fieldset case-stack">
      <legend>{t.remedies}</legend>
      {value.map((r, i) => (
        <section
          className="cw-box case-stack"
          key={i}
          aria-label={`${t.description} ${(i + 1).toLocaleString(lang)}`}
        >
          <label className="case-field">
            {t.type}
            <select
              value={r.type}
              onChange={(e) => edit(i, { type: e.target.value as DisputeRemedy['type'] })}
            >
              {DISPUTE_REMEDY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t.remedyTypes[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="case-field">
            {t.description}
            <textarea
              value={r.description}
              minLength={10}
              maxLength={4000}
              required
              onChange={(e) => edit(i, { description: e.target.value })}
            />
          </label>
          <label className="case-field">
            {t.conditions}
            <textarea
              value={r.conditions}
              maxLength={2000}
              onChange={(e) => edit(i, { conditions: e.target.value })}
            />
          </label>
          <label className="case-field">
            {t.date}
            <input
              type="datetime-local"
              value={r.dueAt ?? ''}
              onChange={(e) => edit(i, { dueAt: e.target.value || null })}
            />
            <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
          </label>
          {value.length > 1 && (
            <button
              type="button"
              className="case-button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 size={16} aria-hidden="true" />
              {t.remove}
            </button>
          )}
        </section>
      ))}
      <button
        type="button"
        className="case-button"
        disabled={value.length >= 6}
        onClick={() => onChange([...value, blankRemedy()])}
      >
        <Plus size={17} aria-hidden="true" />
        {t.addRemedy}
      </button>
    </fieldset>
  );
}
export function DecisionFields({
  fields: f,
  set,
  view,
  lang,
}: {
  fields: CommandFields;
  set: (patch: Partial<CommandFields>) => void;
  view: DisputeWorkspaceView;
  lang: 'en' | 'ar';
}) {
  const t = WORKSPACE_COPY[lang];
  const toggle = (key: 'basisEventIds' | 'evidenceIds', id: string, checked: boolean) =>
    set({ [key]: checked ? [...f[key], id] : f[key].filter((x) => x !== id) });
  return (
    <>
      <label className="case-field">
        {t.proposal}
        <select value={f.proposalId} onChange={(e) => set({ proposalId: e.target.value })}>
          <option value="">{t.noProposal}</option>
          {view.proposals
            .filter((p) => ['OPEN', 'DECIDED'].includes(p.status))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.summary.slice(0, 100)} — {p.acceptedCount.toLocaleString(lang)}/2
              </option>
            ))}
        </select>
        <small>{t.noProposalHint}</small>
      </label>
      <label className="case-field">
        {t.reason}
        <select value={f.reasonCode} onChange={(e) => set({ reasonCode: e.target.value })}>
          {Object.entries(t.decisionReasons).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="case-field">
        {t.rationale}
        <textarea
          required
          minLength={10}
          maxLength={4000}
          value={f.text}
          onChange={(e) => set({ text: e.target.value })}
        />
        <small>{t.rationaleHint}</small>
      </label>
      <fieldset className="cw-fieldset">
        <legend>{t.basis}</legend>
        <p className="cw-meta">{t.basisHint}</p>
        {view.events.map((e) => (
          <label key={e.id} className="cw-check">
            <input
              type="checkbox"
              checked={f.basisEventIds.includes(e.id)}
              onChange={(event) => toggle('basisEventIds', e.id, event.target.checked)}
            />
            <span>
              {EVENT_LABELS[lang][e.kind] ?? t.event} ·{' '}
              <CaseDate value={e.occurredAt} lang={lang} />
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="cw-fieldset">
        <legend>{t.evidenceUsed}</legend>
        {view.evidence
          .filter((e) => e.viewable)
          .map((e, i) => (
            <label key={e.id} className="cw-check">
              <input
                type="checkbox"
                checked={f.evidenceIds.includes(e.id)}
                onChange={(event) => toggle('evidenceIds', e.id, event.target.checked)}
              />
              <span>
                {(i + 1).toLocaleString(lang)}. {e.mimeType} ·{' '}
                <CaseDate value={e.createdAt} lang={lang} />
              </span>
            </label>
          ))}
        {!view.evidence.some((e) => e.viewable) && <p className="cw-meta">{t.none}</p>}
      </fieldset>
      <CaseNotice>
        {t.policy}:{' '}
        <bdi dir="ltr" className="case-reference">
          {view.policy.version}
        </bdi>
      </CaseNotice>
    </>
  );
}
export function SimpleCommandFields({
  selection,
  fields: f,
  set,
  view,
  lang,
}: {
  selection: CommandSelection;
  fields: CommandFields;
  set: (patch: Partial<CommandFields>) => void;
  view: DisputeWorkspaceView;
  lang: 'en' | 'ar';
}) {
  const t = WORKSPACE_COPY[lang];
  const a = selection.action;
  const request = view.requests.find((r) => r.id === selection.entityId);
  return (
    <>
      {a === 'ASSIGN' && (
        <label className="case-field">
          {t.chooseReviewer}
          <select
            required
            value={f.reviewerId}
            onChange={(e) => set({ reviewerId: e.target.value })}
          >
            <option value="">{t.chooseReviewer}</option>
            {view.reviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          {!view.reviewers.length && <small>{t.noReviewers}</small>}
        </label>
      )}
      {a === 'REQUEST_INFORMATION' && (
        <label className="case-field">
          {t.recipient}
          <select
            required
            value={f.recipient}
            onChange={(e) => set({ recipient: e.target.value as CommandFields['recipient'] })}
          >
            <option value="">{t.recipient}</option>
            <option value="SEEKER">{t.roles.SEEKER}</option>
            <option value="PROVIDER">{t.roles.PROVIDER}</option>
          </select>
        </label>
      )}
      {request && a === 'RESPOND' && (
        <CaseNotice>
          <p>{request.question}</p>
          <p>
            {t.deadline}: <CaseDate value={request.dueAt} lang={lang} />
          </p>
        </CaseNotice>
      )}
      {['REQUEST_INFORMATION', 'RESPOND', 'APPEAL'].includes(a) && (
        <label className="case-field">
          {a === 'REQUEST_INFORMATION' ? t.question : a === 'APPEAL' ? t.appealGrounds : t.text}
          <textarea
            required
            minLength={10}
            maxLength={4000}
            value={f.text}
            onChange={(e) => set({ text: e.target.value })}
          />
          <small>{a === 'APPEAL' ? t.appealHint : t.minText}</small>
        </label>
      )}
      {a === 'PROPOSE' && (
        <>
          <label className="case-field">
            {t.summary}
            <textarea
              required
              minLength={10}
              maxLength={4000}
              value={f.summary}
              onChange={(e) => set({ summary: e.target.value })}
            />
          </label>
          <RemedyFields value={f.remedies} onChange={(remedies) => set({ remedies })} lang={lang} />
          <CaseNotice>{t.proposalHint}</CaseNotice>
        </>
      )}
      {a === 'CONSENT' && (
        <CaseNotice>
          {f.accepted ? t.accept : t.decline}
          <p>{view.proposals.find((p) => p.id === selection.entityId)?.summary}</p>
        </CaseNotice>
      )}
      {(a === 'HOLD_EVIDENCE' || a === 'HOLD_PRIVATE_TEXT') && (
        <>
          <CaseNotice>{t.holdHint}</CaseNotice>
          <label className="cw-check">
            <input
              type="checkbox"
              checked={f.releaseHold}
              onChange={(e) => set({ releaseHold: e.target.checked })}
            />
            <span>{t.releaseHold}</span>
          </label>
          {!f.releaseHold && (
            <>
              <label className="case-field">
                {t.hold}
                <input
                  type="datetime-local"
                  required
                  value={f.holdUntil}
                  onChange={(e) => set({ holdUntil: e.target.value })}
                />
              </label>
              <label className="case-field">
                {t.reason}
                <select
                  value={f.reasonCode === 'LEGAL_HOLD' ? 'LEGAL_HOLD' : 'ACTIVE_REVIEW'}
                  onChange={(e) => set({ reasonCode: e.target.value })}
                >
                  <option value="ACTIVE_REVIEW">
                    {lang === 'ar' ? 'مراجعة جارية' : 'Active review'}
                  </option>
                  <option value="LEGAL_HOLD">
                    {lang === 'ar' ? 'تعليق قانوني معتمد' : 'Authorized legal hold'}
                  </option>
                </select>
              </label>
            </>
          )}
        </>
      )}
      {a === 'APPEAL' && <p className="cw-meta">{t.appealPrivate}</p>}
      {a === 'SHARE_REDACTED_EVIDENCE' && <CaseNotice>{t.redactedHint}</CaseNotice>}
      {a === 'REQUEUE_EVIDENCE' && (
        <CaseNotice>
          {lang === 'ar'
            ? 'أكد استعادة خدمة الفحص أو التخزين قبل إعادة المحاولة. لا يُزال سياج المحو.'
            : 'Confirm the scan or storage dependency is restored before retrying. The erasure fence is retained.'}
        </CaseNotice>
      )}
    </>
  );
}
