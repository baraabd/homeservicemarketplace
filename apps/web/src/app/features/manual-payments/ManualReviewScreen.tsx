import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  toMinorAmountString,
  type ManualReviewDecisionRequestV1,
  type ManualReviewDetailV1,
} from '@homeservicemarketplace/contracts';
import { useLang } from '../../i18n/LanguageContext';
import {
  ProviderButton,
  ProviderCard,
  ProviderConfirmDialog,
  ProviderField,
  ProviderTextArea,
  ProviderTextInput,
} from '../provider-ui';
import {
  decideManualPayment,
  getManualReview,
  listManualReviews,
  manualCommandKey,
  manualFailureMessage,
  recordManualSettlement,
  retryManualConfirmation,
} from './manual-payments.api';
import {
  formatManualAmount,
  MANUAL_PAYMENT_COPY,
  manualDate,
  manualMethodLabel,
  manualStatusLabel,
  parseManualAmount,
} from './manual-payments.copy';
import { PaymentSummary, ReceiptHistory, ReviewHistory } from './ManualPaymentScreen';
import { useManualPaymentResource } from './useManualPaymentResource';
import './manual-payments.css';

export function ManualReviewScreen({ paymentIntentId }: { paymentIntentId?: string }) {
  return paymentIntentId ? (
    <ManualReviewDetail key={paymentIntentId} paymentIntentId={paymentIntentId} />
  ) : (
    <ManualReviewQueue />
  );
}

function ManualReviewQueue() {
  const { lang, dir, darkMode } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const cursor = cursors[page];
  const load = useCallback((signal: AbortSignal) => listManualReviews(cursor, signal), [cursor]);
  const resource = useManualPaymentResource(`queue:${cursor ?? 'first'}`, load);
  return (
    <section className={`manual-payments${darkMode ? ' dark' : ''}`} lang={lang} dir={dir}>
      <div className="mp-shell mp-stack">
        <header className="mp-header">
          <h1>{t.queueTitle}</h1>
          <ProviderButton tone="secondary" onClick={resource.refresh} disabled={resource.loading}>
            {t.refresh}
          </ProviderButton>
        </header>
        {resource.loading && <p role="status">{t.loading}</p>}
        {Boolean(resource.error) && (
          <p role="alert" className="mp-notice">
            {manualFailureMessage(resource.error, lang)}
          </p>
        )}
        {resource.data && (
          <ProviderCard className="mp-card">
            {resource.data.items.length === 0 ? (
              <p>{t.emptyQueue}</p>
            ) : (
              <ul className="mp-list">
                {resource.data.items.map((item) => (
                  <li key={item.paymentIntentId} className="mp-stack">
                    <h2>
                      {manualMethodLabel(item.method, lang)} ·{' '}
                      <bdi>{formatManualAmount(item.amount, item.minorUnitScale, lang)}</bdi>
                    </h2>
                    <p>{manualStatusLabel(item.status, lang)}</p>
                    <p className="mp-muted">{manualDate(item.updatedAt, lang)}</p>
                    <Link
                      className="mp-link"
                      to={`/admin/manual-payments/${encodeURIComponent(item.paymentIntentId)}`}
                    >
                      {t.openReview}
                      <span className="mp-mono"> · {item.paymentIntentId}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ProviderCard>
        )}
        <nav className="mp-actions" aria-label={t.queueTitle}>
          {page > 0 && (
            <ProviderButton
              tone="secondary"
              disabled={resource.loading}
              onClick={() => setPage((value) => value - 1)}
            >
              {t.previousPage}
            </ProviderButton>
          )}
          {resource.data?.nextCursor && (
            <ProviderButton
              tone="secondary"
              onClick={() => {
                const next = resource.data?.nextCursor;
                if (next) {
                  setCursors((values) => [...values.slice(0, page + 1), next]);
                  setPage((value) => value + 1);
                }
              }}
            >
              {t.nextPage}
            </ProviderButton>
          )}
        </nav>
      </div>
    </section>
  );
}

function ManualReviewDetail({ paymentIntentId }: { paymentIntentId: string }) {
  const { lang, dir, darkMode } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const load = useCallback(
    (signal: AbortSignal) => getManualReview(paymentIntentId, signal),
    [paymentIntentId],
  );
  const resource = useManualPaymentResource(`review:${paymentIntentId}`, load);
  return (
    <section className={`manual-payments${darkMode ? ' dark' : ''}`} lang={lang} dir={dir}>
      <div className="mp-shell mp-stack">
        <Link className="mp-link" to="/admin/manual-payments">
          {t.backQueue}
        </Link>
        <header className="mp-header">
          <div>
            <h1>{t.reviewTitle}</h1>
            <p>{t.reviewSubtitle}</p>
          </div>
          <ProviderButton tone="secondary" onClick={resource.refresh} disabled={resource.loading}>
            {t.refresh}
          </ProviderButton>
        </header>
        {resource.loading && <p role="status">{t.loading}</p>}
        {Boolean(resource.error) && (
          <p role="alert" className="mp-notice">
            {manualFailureMessage(resource.error, lang)}
          </p>
        )}
        {resource.data && (
          <ReviewWorkspace
            key={`${paymentIntentId}:${resource.data.version}`}
            detail={resource.data}
            onChanged={resource.accept}
          />
        )}
      </div>
    </section>
  );
}

function ReviewWorkspace({
  detail,
  onChanged,
}: {
  detail: ManualReviewDetailV1;
  onChanged: (value: ManualReviewDetailV1) => void;
}) {
  const { lang } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const [inspection, setInspection] = useState<{ id: string; receiptVersionId: string } | null>(
    null,
  );
  const [notice, setNotice] = useState<
    'decisionSaved' | 'settlementSaved' | 'changedRefresh' | null
  >(null);
  const inspect = useCallback(
    (id: string, receiptVersionId: string) => setInspection({ id, receiptVersionId }),
    [],
  );
  const invalidate = useCallback(() => setInspection(null), []);
  const change = (
    next: ManualReviewDetailV1,
    message: 'decisionSaved' | 'settlementSaved' | 'changedRefresh' = 'decisionSaved',
  ) => {
    setInspection(null);
    setNotice(message);
    onChanged(next);
  };
  const canDecide = detail.availableActions.some((action) =>
    ['APPROVE', 'REJECT', 'REQUEST_REPLACEMENT'].includes(action),
  );
  return (
    <div className="mp-stack">
      {notice && (
        <p role="status" className="mp-notice">
          {t[notice]}
        </p>
      )}
      <PaymentSummary payment={detail} />
      {detail.availableActions.includes('RETRY_CONFIRMATION') && detail.processing?.canRetry && (
        <RetryConfirmation detail={detail} onChanged={(next) => change(next, 'changedRefresh')} />
      )}
      <div className="mp-grid mp-grid--review">
        <div className="mp-stack">
          <ReceiptHistory
            receipts={detail.receipts}
            currentReceiptVersionId={detail.currentReceiptVersionId}
            onInspected={inspect}
            onInvalidated={invalidate}
          />
          <ReviewHistory history={detail.history} />
          {detail.reviewHistory.some((entry) => entry.internalNote) && (
            <ProviderCard className="mp-card mp-stack">
              <h2>{t.internalNote}</h2>
              <p className="mp-muted">{t.internalHint}</p>
              <ol className="mp-list">
                {detail.reviewHistory
                  .filter((entry) => entry.internalNote)
                  .map((entry) => (
                    <li key={entry.id}>
                      <p className="mp-private-note mp-instructions">{entry.internalNote}</p>
                      <p className="mp-muted">{manualDate(entry.createdAt, lang)}</p>
                    </li>
                  ))}
              </ol>
            </ProviderCard>
          )}
        </div>
        <div className="mp-stack">
          <ProviderCard className="mp-card mp-stack">
            <h2>{t.settlements}</h2>
            {!detail.settlements.length ? (
              <p>{t.noSettlements}</p>
            ) : (
              <ul className="mp-list">
                {detail.settlements.map((settlement) => (
                  <li key={settlement.id} className="mp-stack">
                    <h3>
                      <bdi>{settlement.reference}</bdi>
                    </h3>
                    <p>
                      <bdi>
                        {formatManualAmount(settlement.amount, detail.minorUnitScale, lang)}
                      </bdi>
                    </p>
                    <p>{manualDate(settlement.occurredAt, lang)}</p>
                    <p className="mp-muted">
                      {settlement.evidenceSource === 'SANDBOX_OPERATOR_SIMULATION'
                        ? t.simulation
                        : t.unknown}
                      {!settlement.canApprove ? ` · ${t.separateReviewer}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ProviderCard>
          {canDecide && <DecisionForm detail={detail} inspection={inspection} onChanged={change} />}
          {detail.mode === 'SANDBOX' && detail.availableActions.includes('RECORD_SETTLEMENT') && (
            <SettlementForm detail={detail} onChanged={(next) => change(next, 'settlementSaved')} />
          )}
        </div>
      </div>
    </div>
  );
}

function RetryConfirmation({
  detail,
  onChanged,
}: {
  detail: ManualReviewDetailV1;
  onChanged: (value: ManualReviewDetailV1) => void;
}) {
  const { lang } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const key = manualCommandKey(attempt, {
        paymentIntentId: detail.paymentIntentId,
        expectedVersion: detail.version,
        action: 'RETRY_CONFIRMATION',
      });
      onChanged(await retryManualConfirmation(detail.paymentIntentId, detail.version, key));
      attempt.current = null;
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProviderCard className="mp-card mp-stack">
      <h2>{t.retryConfirmation}</h2>
      <p>{t.retryConfirmationHint}</p>
      {Boolean(failure) && (
        <p role="alert" className="mp-notice">
          {manualFailureMessage(failure, lang)}
        </p>
      )}
      <div>
        <ProviderButton tone="secondary" disabled={busy} onClick={() => void retry()}>
          {busy ? t.saving : t.retryConfirmation}
        </ProviderButton>
      </div>
    </ProviderCard>
  );
}

function DecisionForm({
  detail,
  inspection,
  onChanged,
}: {
  detail: ManualReviewDetailV1;
  inspection: { id: string; receiptVersionId: string } | null;
  onChanged: (value: ManualReviewDetailV1) => void;
}) {
  const { lang, dir } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [settlementId, setSettlementId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const approvalButton = useRef<HTMLButtonElement>(null);
  const validInspection = inspection?.receiptVersionId === detail.currentReceiptVersionId;
  const eligible = detail.settlements.filter((settlement) => settlement.canApprove);
  const decide = async (action: ManualReviewDecisionRequestV1['action']) => {
    if (busy) return;
    if (
      !validInspection ||
      !inspection ||
      !message.trim() ||
      (action === 'APPROVE' && !eligible.some((settlement) => settlement.id === settlementId))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setFailure(null);
    setBusy(true);
    const request: ManualReviewDecisionRequestV1 = {
      action,
      expectedVersion: detail.version,
      receiptVersionId: inspection.receiptVersionId,
      inspectionId: inspection.id,
      providerMessage: message.trim(),
      ...(note.trim() ? { internalNote: note.trim() } : {}),
      ...(action === 'APPROVE' ? { settlementId } : {}),
    };
    try {
      const key = manualCommandKey(attempt, {
        paymentIntentId: detail.paymentIntentId,
        ...request,
      });
      const next = await decideManualPayment(detail.paymentIntentId, request, key);
      attempt.current = null;
      onChanged(next);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProviderCard className="mp-card mp-stack">
      <h2>{t.decision}</h2>
      <p role="status" className="mp-notice">
        {validInspection ? t.inspectionRecorded : t.inspectionNeeded}
      </p>
      {invalid && (
        <p role="alert" className="mp-notice">
          {t.decisionInvalid}
        </p>
      )}
      {Boolean(failure) && (
        <p role="alert" className="mp-notice">
          {manualFailureMessage(failure, lang)}
        </p>
      )}
      {detail.availableActions.includes('APPROVE') && (
        <ProviderField label={t.selectSettlement}>
          {({ id }) => (
            <select
              id={id}
              className="mp-control"
              value={settlementId}
              onChange={(event) => setSettlementId(event.target.value)}
              disabled={busy}
            >
              <option value="">{t.selectPlaceholder}</option>
              {eligible.map((settlement) => (
                <option value={settlement.id} key={settlement.id}>
                  {settlement.reference} ·{' '}
                  {formatManualAmount(settlement.amount, detail.minorUnitScale, lang)}
                </option>
              ))}
            </select>
          )}
        </ProviderField>
      )}
      <ProviderTextArea
        label={t.message}
        hint={t.messageHint}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={2000}
        disabled={busy}
        required
      />
      <ProviderTextArea
        label={t.internalNote}
        hint={t.internalHint}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        disabled={busy}
      />
      <div className="mp-actions">
        {detail.availableActions.includes('APPROVE') && (
          <ProviderButton
            ref={approvalButton}
            disabled={busy || !validInspection || !settlementId || !message.trim()}
            onClick={() => setConfirm(true)}
          >
            {busy ? t.saving : t.approve}
          </ProviderButton>
        )}
        {detail.availableActions.includes('REQUEST_REPLACEMENT') && (
          <ProviderButton
            tone="secondary"
            disabled={busy || !validInspection || !message.trim()}
            onClick={() => void decide('REQUEST_REPLACEMENT')}
          >
            {t.replacement}
          </ProviderButton>
        )}
        {detail.availableActions.includes('REJECT') && (
          <ProviderButton
            tone="danger"
            disabled={busy || !validInspection || !message.trim()}
            onClick={() => void decide('REJECT')}
          >
            {t.reject}
          </ProviderButton>
        )}
      </div>
      <ProviderConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t.confirmTitle}
        description={
          <>
            {t.confirmHint}
            <br />
            <bdi>{formatManualAmount(detail.amount, detail.minorUnitScale, lang)}</bdi>
          </>
        }
        keepLabel={t.cancel}
        confirmLabel={t.confirm}
        onConfirm={() => {
          setConfirm(false);
          void decide('APPROVE');
        }}
        dir={dir}
        returnFocusRef={approvalButton}
      />
    </ProviderCard>
  );
}

function SettlementForm({
  detail,
  onChanged,
}: {
  detail: ManualReviewDetailV1;
  onChanged: (value: ManualReviewDetailV1) => void;
}) {
  const { lang } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = parseManualAmount(amount, detail.minorUnitScale);
    const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(time)
      ? new Date(`${time}${time.length === 16 ? ':00' : ''}.000Z`)
      : new Date(NaN);
    if (!reference.trim() || !parsed || Number.isNaN(date.getTime())) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setFailure(null);
    setBusy(true);
    const request = {
      reference: reference.trim(),
      amount: {
        amountMinor: toMinorAmountString(BigInt(parsed)),
        currency: detail.amount.currency,
      },
      occurredAt: date.toISOString(),
      evidenceSource: 'SANDBOX_OPERATOR_SIMULATION' as const,
    };
    try {
      const key = manualCommandKey(attempt, {
        paymentIntentId: detail.paymentIntentId,
        ...request,
      });
      const next = await recordManualSettlement(detail.paymentIntentId, request, key);
      attempt.current = null;
      onChanged(next);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProviderCard className="mp-card mp-stack">
      <h2>{t.settlementTitle}</h2>
      <p>{t.settlementHint}</p>
      <div className="mp-notice">
        <strong>{t.simulation}</strong>
        <p>{t.simulationHint}</p>
      </div>
      {invalid && (
        <p role="alert" className="mp-notice">
          {t.settlementInvalid}
        </p>
      )}
      {Boolean(failure) && (
        <p role="alert" className="mp-notice">
          {manualFailureMessage(failure, lang)}
        </p>
      )}
      <form onSubmit={(event) => void submit(event)} className="mp-form">
        <ProviderTextInput
          label={t.settlementReference}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          required
          maxLength={200}
          disabled={busy}
          autoComplete="off"
        />
        <ProviderTextInput
          label={`${t.settlementAmount} (${detail.amount.currency})`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          required
          disabled={busy}
          autoComplete="off"
        />
        <ProviderTextInput
          label={t.settlementTime}
          type="datetime-local"
          step={1}
          value={time}
          onChange={(event) => setTime(event.target.value)}
          required
          disabled={busy}
        />
        <div>
          <ProviderButton type="submit" disabled={busy}>
            {busy ? t.saving : t.recordSettlement}
          </ProviderButton>
        </div>
      </form>
    </ProviderCard>
  );
}
