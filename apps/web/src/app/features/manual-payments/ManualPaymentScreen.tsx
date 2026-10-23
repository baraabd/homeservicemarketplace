import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type {
  ManualPaymentDetailV1,
  ManualReceiptVersionV1,
  ManualReviewHistoryV1,
} from '@homeservicemarketplace/contracts';
import { useLang } from '../../i18n/LanguageContext';
import { ProviderButton, ProviderCard, ProviderField } from '../provider-ui';
import {
  getManualPayment,
  manualCommandKey,
  manualFailureMessage,
  submitManualReceipt,
  uploadManualReceipt,
} from './manual-payments.api';
import {
  formatManualAmount,
  MANUAL_PAYMENT_COPY,
  manualDate,
  manualMethodLabel,
  manualStatusLabel,
} from './manual-payments.copy';
import { ReceiptPreview } from './ReceiptPreview';
import { useManualPaymentResource } from './useManualPaymentResource';
import './manual-payments.css';

export function ManualPaymentPage() {
  const { paymentIntentId } = useParams();
  const { lang } = useLang();
  return paymentIntentId ? (
    <ManualPaymentScreen paymentIntentId={paymentIntentId} />
  ) : (
    <p role="alert">{MANUAL_PAYMENT_COPY[lang].unavailable}</p>
  );
}
export function ManualPaymentScreen({ paymentIntentId }: { paymentIntentId: string }) {
  // Navigating to another obligation must not reuse an earlier receipt or command draft.
  return <ManualPaymentBody key={paymentIntentId} paymentIntentId={paymentIntentId} />;
}
function ManualPaymentBody({ paymentIntentId }: { paymentIntentId: string }) {
  const { lang, dir, darkMode, toggleLang } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const load = useCallback(
    (signal: AbortSignal) => getManualPayment(paymentIntentId, signal),
    [paymentIntentId],
  );
  const resource = useManualPaymentResource(paymentIntentId, load);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'upload' | 'submit' | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [notice, setNotice] = useState<'uploadDone' | 'submitted' | null>(null);
  const [invalidFile, setInvalidFile] = useState(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const data = resource.data;
  const upload = async () => {
    if (!data || busy) return;
    const policy = data.uploadPolicy;
    if (
      !file ||
      !policy ||
      !policy.allowedContentTypes.includes(file.type) ||
      file.size === 0 ||
      file.size > policy.maxBytes
    ) {
      setInvalidFile(true);
      input.current?.focus();
      return;
    }
    setInvalidFile(false);
    setFailure(null);
    setNotice(null);
    setBusy('upload');
    try {
      const key = manualCommandKey(attempt, {
        operation: 'upload',
        paymentIntentId,
        version: data.version,
        name: file.name,
        size: file.size,
        modified: file.lastModified,
      });
      resource.accept(await uploadManualReceipt(paymentIntentId, file, data.version, key));
      setFile(null);
      if (input.current) input.current.value = '';
      attempt.current = null;
      setNotice('uploadDone');
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  };
  const submit = async () => {
    if (!data || busy) return;
    setFailure(null);
    setNotice(null);
    setBusy('submit');
    try {
      const key = manualCommandKey(attempt, {
        operation: 'submit',
        paymentIntentId,
        version: data.version,
      });
      resource.accept(await submitManualReceipt(paymentIntentId, data.version, key));
      attempt.current = null;
      setNotice('submitted');
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className={`manual-payments${darkMode ? ' dark' : ''}`} lang={lang} dir={dir}>
      <div className="mp-shell mp-shell--focused mp-stack">
        <Link className="mp-link" to="/provider">
          {t.back}
        </Link>
        <header className="mp-header">
          <div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
          <div className="mp-actions">
            <ProviderButton tone="secondary" onClick={toggleLang}>
              {t.language}
            </ProviderButton>
            <ProviderButton
              tone="secondary"
              onClick={resource.refresh}
              disabled={Boolean(busy) || resource.loading}
            >
              {t.refresh}
            </ProviderButton>
          </div>
        </header>
        {Boolean(resource.error || failure) && (
          <div role="alert" className="mp-notice">
            {manualFailureMessage(resource.error || failure, lang)}
          </div>
        )}
        {notice && (
          <p role="status" className="mp-notice">
            {t[notice]}
          </p>
        )}
        {invalidFile && (
          <p role="alert" className="mp-notice">
            {t.invalidFile}
          </p>
        )}
        {resource.loading && <p role="status">{t.loading}</p>}
        {!resource.loading && !data && (
          <ProviderButton tone="secondary" onClick={resource.refresh}>
            {t.retry}
          </ProviderButton>
        )}
        {data && (
          <>
            <PaymentSummary payment={data} />
            {data.history.some((entry) => entry.providerMessage) && (
              <ProviderCard className="mp-card mp-stack">
                <h2>{t.changes}</h2>
                <p className="mp-message">
                  {data.history.find((entry) => entry.providerMessage)?.providerMessage}
                </p>
              </ProviderCard>
            )}
            {data.availability === 'ENABLED' &&
              data.availableActions.includes('UPLOAD_RECEIPT') &&
              data.uploadPolicy && (
                <ProviderCard className="mp-card mp-stack">
                  <h2>{data.receipts.length ? t.replace : t.upload}</h2>
                  <p className="mp-muted">{t.uploadHint}</p>
                  <p>
                    {t.maxFile}:{' '}
                    {new Intl.NumberFormat(lang).format(data.uploadPolicy.maxBytes / (1024 * 1024))}{' '}
                    MiB · {t.formats}: {data.uploadPolicy.allowedContentTypes.join(', ')}
                  </p>
                  <ProviderField
                    label={t.chooseFile}
                    error={invalidFile ? t.invalidFile : undefined}
                  >
                    {({ id, describedBy, invalid }) => (
                      <input
                        ref={input}
                        id={id}
                        className="mp-control"
                        type="file"
                        accept={data.uploadPolicy?.allowedContentTypes.join(',')}
                        aria-describedby={describedBy}
                        aria-invalid={invalid || undefined}
                        disabled={Boolean(busy)}
                        onChange={(event) => {
                          setFile(event.target.files?.[0] ?? null);
                          setInvalidFile(false);
                          attempt.current = null;
                        }}
                      />
                    )}
                  </ProviderField>
                  <div>
                    <ProviderButton onClick={() => void upload()} disabled={!file || Boolean(busy)}>
                      {busy === 'upload'
                        ? t.uploading
                        : data.receipts.length
                          ? t.replace
                          : t.upload}
                    </ProviderButton>
                  </div>
                </ProviderCard>
              )}
            <ReceiptHistory
              receipts={data.receipts}
              currentReceiptVersionId={data.currentReceiptVersionId}
            />
            {data.availableActions.includes('SUBMIT') && (
              <div>
                <ProviderButton onClick={() => void submit()} disabled={Boolean(busy)}>
                  {busy === 'submit' ? t.submitting : t.submit}
                </ProviderButton>
              </div>
            )}
            <ReviewHistory history={data.history} />
          </>
        )}
      </div>
    </main>
  );
}

export function PaymentSummary({ payment }: { payment: ManualPaymentDetailV1 }) {
  const { lang } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  return (
    <ProviderCard className="mp-card mp-stack">
      <h2>{manualStatusLabel(payment.status, lang)}</h2>
      {payment.mode === 'SANDBOX' && (
        <div className="mp-notice">
          <strong>{t.simulation}</strong>
          <p>{t.simulationHint}</p>
        </div>
      )}
      <dl className="mp-facts">
        <div>
          <dt>{t.amount}</dt>
          <dd>
            <bdi>{formatManualAmount(payment.amount, payment.minorUnitScale, lang)}</bdi>
          </dd>
        </div>
        <div>
          <dt>{t.method}</dt>
          <dd>{manualMethodLabel(payment.method, lang)}</dd>
        </div>
        <div>
          <dt>{t.expires}</dt>
          <dd>{manualDate(payment.expiresAt, lang)}</dd>
        </div>
        <div className="mp-reference">
          <dt>{t.paymentReference}</dt>
          <dd className="mp-mono">
            <bdi>{payment.paymentIntentId}</bdi>
          </dd>
        </div>
      </dl>
      {payment.availability === 'METHOD_DISABLED' ? (
        <div className="mp-notice" role="status">
          <strong>{t.disabled}</strong>
          <p>{t.disabledHint}</p>
        </div>
      ) : (
        payment.instructions && (
          <section className="mp-stack">
            <h3>{t.instructions}</h3>
            <p className="mp-instructions">{payment.instructions.text[lang]}</p>
            <p className="mp-muted">
              {t.instructionVersion}: <bdi>{payment.instructions.version}</bdi>
            </p>
          </section>
        )
      )}
      <p className="mp-muted">{t.receiptWarning}</p>
      {payment.status === 'CONFIRMING' && (
        <p role="status" className="mp-notice">
          {t.awaitingActivation}
        </p>
      )}
      {payment.status === 'APPROVED' && (
        <p role="status" className="mp-notice">
          {t.approvedNotice}
        </p>
      )}
      {payment.status === 'RECONCILIATION_REQUIRED' && (
        <p role="status" className="mp-notice">
          {t.reconciliation}
        </p>
      )}
    </ProviderCard>
  );
}

export function ReceiptHistory({
  receipts,
  currentReceiptVersionId,
  onInspected,
  onInvalidated,
}: {
  receipts: ManualReceiptVersionV1[];
  currentReceiptVersionId: string | null;
  onInspected?: (inspectionId: string, receiptVersionId: string) => void;
  onInvalidated?: () => void;
}) {
  const { lang } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const selected = receipts.find((receipt) => receipt.id === selectedId && receipt.canRead) ?? null;
  return (
    <ProviderCard className="mp-card mp-stack">
      <h2>{t.history}</h2>
      {receipts.length === 0 ? (
        <p>{t.emptyReceipts}</p>
      ) : (
        <ol className="mp-list">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="mp-stack">
              <div className="mp-header">
                <h3>
                  {t.revision} {receipt.revision}
                  {receipt.id === currentReceiptVersionId ? ` · ${t.current}` : ''}
                </h3>
                {receipt.canRead && (
                  <ProviderButton
                    tone="secondary"
                    onClick={(event) => {
                      returnFocus.current = event.currentTarget;
                      setSelectedId(receipt.id);
                    }}
                  >
                    {t.open} {receipt.revision}
                  </ProviderButton>
                )}
              </div>
              <p>
                {t.scan}: {manualStatusLabel(receipt.scanStatus, lang)}
              </p>
              <p className="mp-muted">{manualDate(receipt.createdAt, lang)}</p>
            </li>
          ))}
        </ol>
      )}
      {selected && (
        <ReceiptPreview
          key={selected.id}
          receipt={selected}
          onClose={() => {
            setSelectedId(null);
            returnFocus.current?.focus();
          }}
          onInspected={selected.id === currentReceiptVersionId ? onInspected : undefined}
          onInvalidated={onInvalidated}
        />
      )}
    </ProviderCard>
  );
}
export function ReviewHistory({ history }: { history: ManualReviewHistoryV1[] }) {
  const { lang } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  return (
    <ProviderCard className="mp-card mp-stack">
      <h2>{t.decisions}</h2>
      {!history.length ? (
        <p>{t.emptyHistory}</p>
      ) : (
        <ol className="mp-list">
          {history.map((entry) => (
            <li key={entry.id} className="mp-stack">
              <h3>{manualStatusLabel(entry.action, lang)}</h3>
              <p className="mp-message">{entry.providerMessage}</p>
              <p className="mp-muted">{manualDate(entry.createdAt, lang)}</p>
            </li>
          ))}
        </ol>
      )}
    </ProviderCard>
  );
}
