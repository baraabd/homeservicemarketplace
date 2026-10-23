import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import type {
  FinancialIntegrationAvailabilityV1,
  FinancialOperationsCapabilitiesV1,
  FinancialOperationsSummaryV1,
  FinancialRecordKind,
  FinancialRecordV1,
  FinancialReconciliationStatusV1,
} from '@homeservicemarketplace/contracts';
import { useAuth } from '../../../lib/auth-provider';
import { useIdentityState } from '../../../lib/use-identity-state';
import { useLang } from '../../i18n/LanguageContext';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  exportFinancialPage,
  financialErrorStatus,
  financialOperationsKeys,
  useFinancialDetail,
  useFinancialException,
  useFinancialReconciliation,
  useFinancialRecords,
  useFinancialSummary,
  type FinancialAudience,
} from './financial-operations.api';
import {
  AMOUNT_LABELS,
  CONFIRMATION_LABELS,
  EXCEPTION_LABELS,
  FINANCIAL_OPERATIONS_COPY,
  RECORD_KINDS,
  RECORD_LABELS,
  financialStatusLabel,
} from './financial-operations.copy';
import { formatFinancialDate, formatMoneyMinor, type FinancialLanguage } from './money-format';

type Selection = { kind: FinancialRecordKind; id: string };
type ViewState = {
  kind: FinancialRecordKind;
  currency: string;
  cursors: Array<string | undefined>;
  exceptionCursors: Array<string | undefined>;
  selected: Selection | null;
  exceptionId: string | null;
  exportOpen: boolean;
  exporting: boolean;
  exportResult: 'downloaded' | 'partial' | 'failed' | null;
};
const initialView: ViewState = {
  kind: 'PAYMENT',
  currency: '',
  cursors: [undefined],
  exceptionCursors: [undefined],
  selected: null,
  exceptionId: null,
  exportOpen: false,
  exporting: false,
  exportResult: null,
};
const actionClass = 'min-h-11 min-w-11 whitespace-normal text-start';
const mutedClass = 'text-sm leading-relaxed text-muted-foreground';

function Notice({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <div
      role={alert ? 'alert' : 'status'}
      className="rounded-xl border border-border bg-muted p-4 text-sm leading-relaxed"
    >
      {children}
    </div>
  );
}

function ReadTime({
  label,
  value,
  lang,
}: {
  label: string;
  value: string | null;
  lang: FinancialLanguage;
}) {
  return (
    <p className={mutedClass}>
      {label}: <time dateTime={value ?? undefined}>{formatFinancialDate(value, lang)}</time>
    </p>
  );
}

export function FinancialOperationsView({ audience }: { audience: FinancialAudience }) {
  const { user } = useAuth();
  const { lang, dir, toggleLang, darkMode, toggleDarkMode } = useLang();
  const t = FINANCIAL_OPERATIONS_COPY[lang];
  const admin = audience === 'admin';
  const userId = user?.id ?? '';
  const identity = userId + ':' + audience;
  const [view, setView] = useIdentityState<ViewState>(identity, initialView);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const exportController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      exportController.current?.abort();
      exportController.current = null;
    },
    [identity],
  );
  const queryClient = useQueryClient();
  const opener = useRef<HTMLButtonElement>(null);
  const query = {
    kind: view.kind,
    limit: 20,
    ...(view.currency ? { currency: view.currency } : {}),
    ...(view.cursors[view.cursors.length - 1]
      ? { cursor: view.cursors[view.cursors.length - 1] }
      : {}),
  };
  const summary = useFinancialSummary(audience, userId);
  const records = useFinancialRecords(audience, userId, query);
  const detail = useFinancialDetail(audience, userId, view.selected);
  const reconciliation = useFinancialReconciliation(
    userId,
    admin,
    view.exceptionCursors[view.exceptionCursors.length - 1],
  );
  const exception = useFinancialException(userId, view.exceptionId);
  const forbidden = [summary.error, records.error, admin ? reconciliation.error : null].some(
    (error) => [401, 403].includes(financialErrorStatus(error) ?? 0),
  );
  const busy = summary.isFetching || records.isFetching || (admin && reconciliation.isFetching);
  const currencies = [
    ...new Set([
      ...(summary.data?.ledger.totals.map((total) => total.currency) ?? []),
      ...(summary.data?.pendingTotals.map((total) => total.currency) ?? []),
      ...(records.data?.items.flatMap((record) =>
        record.amount ? [record.amount.currency] : [],
      ) ?? []),
      ...(view.currency ? [view.currency] : []),
    ]),
  ].sort();
  const stale =
    (summary.isError && Boolean(summary.data)) || (records.isError && Boolean(records.data));
  const paused = records.isPaused || (admin && (summary.isPaused || reconciliation.isPaused));

  function refresh() {
    setView((state) => ({
      ...state,
      cursors: [undefined],
      exceptionCursors: [undefined],
      exportResult: null,
    }));
    void queryClient.invalidateQueries({
      queryKey: financialOperationsKeys.actor(audience, userId),
    });
  }
  async function downloadPage() {
    if (view.exporting || !admin || forbidden) return;
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    const stillCurrent = () => !controller.signal.aborted && currentIdentity.current === identity;
    setView((state) => ({ ...state, exporting: true, exportResult: null }));
    try {
      const result = await exportFinancialPage(query, controller.signal);
      if (!stillCurrent()) return;
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'financial-operations.csv';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      setView((state) => ({
        ...state,
        exportOpen: false,
        exporting: false,
        exportResult: result.hasMore ? 'partial' : 'downloaded',
      }));
    } catch {
      if (stillCurrent())
        setView((state) => ({ ...state, exporting: false, exportResult: 'failed' }));
    } finally {
      if (exportController.current === controller) exportController.current = null;
    }
  }
  function openRecord(record: FinancialRecordV1, button: HTMLButtonElement) {
    (opener as { current: HTMLButtonElement | null }).current = button;
    setView((state) => ({ ...state, selected: { kind: record.kind, id: record.id } }));
  }
  function closeDialogs() {
    setView((state) => ({ ...state, selected: null, exceptionId: null, exportOpen: false }));
  }
  const page = records.data;
  const deniedDetail = [401, 403, 404].includes(financialErrorStatus(detail.error) ?? 0);
  const deniedException = [401, 403, 404].includes(financialErrorStatus(exception.error) ?? 0);

  return (
    <div
      className={(darkMode ? 'dark ' : '') + 'min-h-screen bg-background text-foreground'}
      dir={dir}
      lang={lang}
    >
      <main
        className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6 p-4 sm:p-6 lg:p-8"
        data-testid="financial-operations"
      >
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline" className={actionClass}>
            <Link to={admin ? '/admin/financials' : '/provider'}>
              {admin ? t.backAdmin : t.backProvider}
            </Link>
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className={actionClass}
              onClick={toggleLang}
              aria-label={t.changeLanguage}
            >
              {t.language}
            </Button>
            <Button variant="outline" className={actionClass} onClick={toggleDarkMode}>
              {t.theme}
            </Button>
          </div>
        </header>
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{t.scope}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {admin ? t.adminTitle : t.providerTitle}
          </h1>
          <p className={mutedClass}>{t.scopeNote}</p>
          <p className={mutedClass}>{t.accessNote}</p>
        </div>
        {!userId ? (
          <Notice>{t.signIn}</Notice>
        ) : forbidden ? (
          <Notice alert>{t.forbidden}</Notice>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button className={actionClass} onClick={refresh} disabled={busy}>
                {busy ? t.refreshing : t.refresh}
              </Button>
              {(summary.data || records.data) && (
                <ReadTime
                  label={t.readAt}
                  value={(summary.data ?? records.data)?.provenance.readAt ?? null}
                  lang={lang}
                />
              )}
            </div>
            {stale && <Notice alert>{t.stale}</Notice>}
            {paused && <Notice alert>{t.offline}</Notice>}
            {admin &&
              (summary.isPending ? (
                <Notice>{t.loading}</Notice>
              ) : summary.isError && !summary.data ? (
                <Notice alert>
                  {t.loadFailed}{' '}
                  <Button variant="outline" className={actionClass} onClick={refresh}>
                    {t.retry}
                  </Button>
                </Notice>
              ) : summary.data ? (
                <FinancialSummary summary={summary.data} lang={lang} />
              ) : null)}
            <Notice>{t.scaleNote}</Notice>
            {!admin && <Notice>{t.planUnavailable}</Notice>}
            {summary.data && (
              <IntegrationLinks
                capabilities={summary.data.capabilities}
                admin={admin}
                lang={lang}
              />
            )}
            <section className="min-w-0 space-y-4" aria-labelledby="financial-records-title">
              <h2 id="financial-records-title" className="text-xl font-semibold">
                {t.recordsTitle}
              </h2>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                  {t.type}
                  <select
                    className="min-h-11 max-w-full rounded-lg border border-border bg-background p-2 text-base"
                    value={view.kind}
                    onChange={(event) =>
                      setView((state) => ({
                        ...state,
                        kind: event.target.value as FinancialRecordKind,
                        cursors: [undefined],
                        selected: null,
                        exportResult: null,
                      }))
                    }
                  >
                    {RECORD_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {RECORD_LABELS[lang][kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                  {t.currency}
                  <select
                    className="min-h-11 max-w-full rounded-lg border border-border bg-background p-2 text-base"
                    value={view.currency}
                    onChange={(event) =>
                      setView((state) => ({
                        ...state,
                        currency: event.target.value,
                        cursors: [undefined],
                        selected: null,
                        exportResult: null,
                      }))
                    }
                  >
                    <option value="">{t.allCurrencies}</option>
                    {currencies.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </label>
                {admin && (
                  <Button
                    variant="outline"
                    className={actionClass}
                    disabled={
                      !page ||
                      records.isError ||
                      records.isPaused ||
                      page.availability.state !== 'AVAILABLE'
                    }
                    onClick={(event) => {
                      (opener as { current: HTMLButtonElement | null }).current =
                        event.currentTarget;
                      setView((state) => ({ ...state, exportOpen: true, exportResult: null }));
                    }}
                  >
                    {t.export}
                  </Button>
                )}
              </div>
              {view.exportResult && (
                <Notice alert={view.exportResult === 'failed'}>
                  {view.exportResult === 'partial'
                    ? t.exportPartial
                    : view.exportResult === 'failed'
                      ? t.exportFailed
                      : t.exportDownloaded}
                </Notice>
              )}
              {records.isPending ? (
                <Notice>{t.loading}</Notice>
              ) : records.isError && !page ? (
                <Notice alert>
                  {t.loadFailed}{' '}
                  <Button className={actionClass} variant="outline" onClick={refresh}>
                    {t.retry}
                  </Button>
                </Notice>
              ) : page?.availability.state === 'UNAVAILABLE' ? (
                <Notice>
                  {view.kind === 'SETTLEMENT' ? t.settlementsUnavailable : t.unavailable}
                </Notice>
              ) : page ? (
                <>
                  <FinancialRecords items={page.items} lang={lang} onOpen={openRecord} />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      className={actionClass}
                      disabled={view.cursors.length < 2 || records.isFetching}
                      onClick={() =>
                        setView((state) => ({
                          ...state,
                          cursors: state.cursors.slice(0, -1),
                          exportResult: null,
                        }))
                      }
                    >
                      {t.previous}
                    </Button>
                    <span className="text-sm">
                      {t.page} {new Intl.NumberFormat(lang).format(view.cursors.length)}
                    </span>
                    <Button
                      variant="outline"
                      className={actionClass}
                      disabled={!page.nextCursor || records.isFetching}
                      onClick={() =>
                        setView((state) => ({
                          ...state,
                          cursors: [...state.cursors, page.nextCursor ?? undefined],
                          exportResult: null,
                        }))
                      }
                    >
                      {t.next}
                    </Button>
                  </div>
                  <ReadTime label={t.readAt} value={page.provenance.readAt} lang={lang} />
                </>
              ) : null}
            </section>
            {admin && (
              <section className="min-w-0 space-y-4" aria-labelledby="reconciliation-title">
                <h2 id="reconciliation-title" className="text-xl font-semibold">
                  {t.reconciliation}
                </h2>
                {reconciliation.isPending ? (
                  <Notice>{t.loading}</Notice>
                ) : reconciliation.isError ? (
                  <Notice alert>{t.loadFailed}</Notice>
                ) : reconciliation.data ? (
                  <>
                    <ReconciliationStatus status={reconciliation.data.status} lang={lang} />
                    {reconciliation.data.items.length ? (
                      <ul className="grid gap-3 sm:grid-cols-2">
                        {reconciliation.data.items.map((item) => (
                          <li key={item.id}>
                            <Button
                              variant="outline"
                              className={actionClass + ' h-auto w-full flex-col items-start p-4'}
                              onClick={(event) => {
                                (opener as { current: HTMLButtonElement | null }).current =
                                  event.currentTarget;
                                setView((state) => ({ ...state, exceptionId: item.id }));
                              }}
                            >
                              <span>{EXCEPTION_LABELS[lang][item.kind]}</span>
                              <span className="max-w-full break-all font-mono text-xs">
                                {item.id}
                              </span>
                              <span className="text-xs">
                                {item.resolvedAt
                                  ? formatFinancialDate(item.resolvedAt, lang)
                                  : t.open}
                              </span>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : reconciliation.data.status.state === 'AVAILABLE' ? (
                      <Notice>{t.exceptionEmpty}</Notice>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        className={actionClass}
                        disabled={view.exceptionCursors.length < 2 || reconciliation.isFetching}
                        onClick={() =>
                          setView((state) => ({
                            ...state,
                            exceptionCursors: state.exceptionCursors.slice(0, -1),
                          }))
                        }
                      >
                        {t.previousExceptions}
                      </Button>
                      <Button
                        variant="outline"
                        className={actionClass}
                        disabled={!reconciliation.data.nextCursor || reconciliation.isFetching}
                        onClick={() =>
                          setView((state) => ({
                            ...state,
                            exceptionCursors: [
                              ...state.exceptionCursors,
                              reconciliation.data?.nextCursor ?? undefined,
                            ],
                          }))
                        }
                      >
                        {t.moreExceptions}
                      </Button>
                    </div>
                    <p className={mutedClass}>{t.reconciliationActionsUnavailable}</p>
                  </>
                ) : null}
              </section>
            )}
            <p className={mutedClass}>{t.privateNotes}</p>
          </>
        )}
      </main>
      {!forbidden && userId && view.selected && (
        <FinancialModal
          title={t.detailTitle}
          description={t.detailDescription}
          onClose={closeDialogs}
          opener={opener}
        >
          {deniedDetail ? (
            <Notice alert>{t.detailUnavailable}</Notice>
          ) : detail.isPending ? (
            <Notice>{t.loading}</Notice>
          ) : detail.isError ? (
            <Notice alert>
              {t.loadFailed}{' '}
              <Button
                variant="outline"
                className={actionClass}
                onClick={() => void detail.refetch()}
              >
                {t.retry}
              </Button>
            </Notice>
          ) : detail.data ? (
            <>
              <RecordDetails record={detail.data.record} lang={lang} />
              <IntegrationLinks capabilities={detail.data.capabilities} admin={admin} lang={lang} />
              <ReadTime label={t.readAt} value={detail.data.provenance.readAt} lang={lang} />
            </>
          ) : null}
        </FinancialModal>
      )}
      {!forbidden && admin && userId && view.exceptionId && (
        <FinancialModal
          title={t.exceptionDetail}
          description={t.reconciliationActionsUnavailable}
          onClose={closeDialogs}
          opener={opener}
        >
          {deniedException ? (
            <Notice alert>{t.detailUnavailable}</Notice>
          ) : exception.isPending ? (
            <Notice>{t.loading}</Notice>
          ) : exception.isError ? (
            <Notice alert>{t.loadFailed}</Notice>
          ) : exception.data ? (
            <dl className="grid min-w-0 gap-3">
              <Detail
                label={t.exception}
                value={EXCEPTION_LABELS[lang][exception.data.exception.kind]}
              />
              <Detail label={t.record} value={exception.data.exception.id} />
              <Detail
                label={t.subject}
                value={
                  exception.data.exception.subjectType + ': ' + exception.data.exception.subjectId
                }
              />
              <Detail
                label={t.detected}
                value={formatFinancialDate(exception.data.exception.detectedAt, lang)}
              />
              <Detail
                label={t.resolved}
                value={
                  exception.data.exception.resolvedAt
                    ? formatFinancialDate(exception.data.exception.resolvedAt, lang)
                    : t.open
                }
              />
            </dl>
          ) : null}
        </FinancialModal>
      )}
      {!forbidden && admin && userId && view.exportOpen && (
        <FinancialModal
          title={t.exportTitle}
          description={t.exportDescription}
          onClose={() => {
            if (!view.exporting) closeDialogs();
          }}
          opener={opener}
        >
          <p>
            {t.type}: {RECORD_LABELS[lang][view.kind]}
          </p>
          <p>
            {t.currency}: {view.currency || t.allCurrencies}
          </p>
          <p>
            {t.page}: {new Intl.NumberFormat(lang).format(view.cursors.length)}
          </p>
          {view.exportResult === 'failed' && <Notice alert>{t.exportFailed}</Notice>}
          <div className="flex flex-wrap gap-3">
            <Button
              className={actionClass}
              onClick={() => void downloadPage()}
              disabled={view.exporting}
            >
              {view.exporting ? t.exporting : t.confirmExport}
            </Button>
            <Button
              variant="outline"
              className={actionClass}
              onClick={closeDialogs}
              disabled={view.exporting}
            >
              {t.cancel}
            </Button>
          </div>
        </FinancialModal>
      )}
    </div>
  );
}

function FinancialSummary({
  summary,
  lang,
}: {
  summary: FinancialOperationsSummaryV1;
  lang: FinancialLanguage;
}) {
  const t = FINANCIAL_OPERATIONS_COPY[lang];
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="ledger-totals-title">
        <h2 id="ledger-totals-title" className="text-xl font-semibold">
          {t.ledgerTitle}
        </h2>
        <ReadTime label={t.ledgerAsOf} value={summary.ledger.asOf} lang={lang} />
        {summary.ledger.totals.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {summary.ledger.totals.map((total) => (
              <Card
                key={total.currency}
                className="min-w-0 gap-3 p-4"
                data-testid={`ledger-total-${total.currency}`}
              >
                <h3 className="font-semibold">
                  <bdi>{total.currency}</bdi>
                </h3>
                <dl className="grid gap-3">
                  <Detail label={t.collected} value={formatMoneyMinor(total.captured, lang)} />
                  <Detail label={t.refunded} value={formatMoneyMinor(total.refunded, lang)} />
                </dl>
              </Card>
            ))}
          </div>
        ) : (
          <Notice>{t.noTotals}</Notice>
        )}
      </section>
      <section className="space-y-3" aria-labelledby="pending-totals-title">
        <h2 id="pending-totals-title" className="text-xl font-semibold">
          {t.pendingTitle}
        </h2>
        <ReadTime label={t.pendingAsOf} value={summary.pendingAsOf} lang={lang} />
        {summary.pendingTotals.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {summary.pendingTotals.map((total) => (
              <Card
                key={total.currency}
                className="min-w-0 gap-3 p-4"
                data-testid={`pending-total-${total.currency}`}
              >
                <h3 className="font-semibold">
                  <bdi>{total.currency}</bdi>
                </h3>
                <dl className="grid gap-3">
                  <Detail label={t.pending} value={formatMoneyMinor(total.pending, lang)} />
                  <Detail label={t.unknown} value={formatMoneyMinor(total.unknown, lang)} />
                  <Detail
                    label={t.requested}
                    value={formatMoneyMinor(total.refundsRequested, lang)}
                  />
                </dl>
              </Card>
            ))}
          </div>
        ) : (
          <Notice>{t.noPending}</Notice>
        )}
      </section>
      <p className={mutedClass}>{t.separateSnapshots}</p>
      <ReconciliationStatus status={summary.reconciliation} lang={lang} />
    </div>
  );
}

function FinancialRecords({
  items,
  lang,
  onOpen,
}: {
  items: FinancialRecordV1[];
  lang: FinancialLanguage;
  onOpen: (record: FinancialRecordV1, button: HTMLButtonElement) => void;
}) {
  const t = FINANCIAL_OPERATIONS_COPY[lang];
  if (!items.length) return <Notice>{t.empty}</Notice>;
  const open = (record: FinancialRecordV1) => (
    <Button
      variant="outline"
      className={actionClass}
      onClick={(event) => onOpen(record, event.currentTarget)}
      aria-label={t.details + ': ' + record.id}
    >
      {t.details}
    </Button>
  );
  return (
    <>
      <div
        className="hidden overflow-x-auto rounded-xl border border-border md:block"
        data-testid="financial-records-table"
      >
        <table className="w-full text-start text-sm">
          <caption className="sr-only">{t.recordsTitle}</caption>
          <thead className="bg-muted">
            <tr>
              {[t.record, t.amount, t.status, t.confirmation, t.created, t.details].map(
                (heading) => (
                  <th key={heading} scope="col" className="p-3 text-start font-medium">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((record) => (
              <tr key={record.id} className="border-t border-border">
                <th scope="row" className="max-w-48 break-all p-3 text-start font-mono text-xs">
                  {record.id}
                </th>
                <td className="p-3">
                  <bdi>{formatMoneyMinor(record.amount, lang)}</bdi>
                  <p className={mutedClass}>{AMOUNT_LABELS[lang][record.amountMeaning]}</p>
                </td>
                <td className="p-3">
                  {financialStatusLabel(record.status, lang)}
                  {record.dispatchStatus && (
                    <p className={mutedClass}>
                      {t.dispatch}: {financialStatusLabel(record.dispatchStatus, lang)}
                    </p>
                  )}
                </td>
                <td className="p-3">{CONFIRMATION_LABELS[lang][record.confirmationState]}</td>
                <td className="p-3">{formatFinancialDate(record.createdAt, lang)}</td>
                <td className="p-3">{open(record)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 md:hidden" data-testid="financial-records-cards">
        {items.map((record) => (
          <li key={record.id}>
            <Card className="min-w-0 gap-3 p-4">
              <h3 className="break-all font-mono text-xs">{record.id}</h3>
              <dl className="grid gap-2">
                <Detail label={t.amount} value={formatMoneyMinor(record.amount, lang)} />
                <Detail label={t.amountMeaning} value={AMOUNT_LABELS[lang][record.amountMeaning]} />
                <Detail label={t.status} value={financialStatusLabel(record.status, lang)} />
                <Detail
                  label={t.confirmation}
                  value={CONFIRMATION_LABELS[lang][record.confirmationState]}
                />
                {record.dispatchStatus && (
                  <Detail
                    label={t.dispatch}
                    value={financialStatusLabel(record.dispatchStatus, lang)}
                  />
                )}
                <Detail label={t.created} value={formatFinancialDate(record.createdAt, lang)} />
              </dl>
              {open(record)}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={mutedClass}>{label}</dt>
      <dd className="break-words font-medium [overflow-wrap:anywhere]">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function RecordDetails({ record, lang }: { record: FinancialRecordV1; lang: FinancialLanguage }) {
  const t = FINANCIAL_OPERATIONS_COPY[lang];
  return (
    <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
      <Detail label={t.record} value={record.id} />
      <Detail label={t.provider} value={record.providerProfileId} />
      <Detail label={t.amount} value={formatMoneyMinor(record.amount, lang)} />
      <Detail label={t.amountMeaning} value={AMOUNT_LABELS[lang][record.amountMeaning]} />
      <Detail label={t.status} value={financialStatusLabel(record.status, lang)} />
      <Detail label={t.confirmation} value={CONFIRMATION_LABELS[lang][record.confirmationState]} />
      {record.dispatchStatus && (
        <Detail label={t.dispatch} value={financialStatusLabel(record.dispatchStatus, lang)} />
      )}
      {record.paymentIntentId && <Detail label={t.paymentIntent} value={record.paymentIntentId} />}
      {record.paymentConfirmationId && (
        <Detail label={t.confirmationId} value={record.paymentConfirmationId} />
      )}
      {record.ledgerTransactionId && (
        <Detail label={t.posting} value={record.ledgerTransactionId} />
      )}
      {record.period && (
        <>
          <Detail label={t.periodStart} value={formatFinancialDate(record.period.startsAt, lang)} />
          <Detail label={t.periodEnd} value={formatFinancialDate(record.period.endsAt, lang)} />
        </>
      )}
      {record.publicReasonCode && <Detail label={t.publicReason} value={record.publicReasonCode} />}
      <Detail label={t.created} value={formatFinancialDate(record.createdAt, lang)} />
    </dl>
  );
}

function ReconciliationStatus({
  status,
  lang,
}: {
  status: FinancialReconciliationStatusV1;
  lang: FinancialLanguage;
}) {
  const t = FINANCIAL_OPERATIONS_COPY[lang];
  const labels = {
    NOT_RUN: t.reconciliationNotRun,
    AVAILABLE: t.reconciliationAvailable,
    UNAVAILABLE: t.reconciliationUnavailable,
    FAILED: t.reconciliationFailed,
  };
  return (
    <Notice alert={status.state === 'FAILED'}>
      <p>{labels[status.state]}</p>
      {status.lastSuccessAt ? (
        <ReadTime label={t.lastSuccess} value={status.lastSuccessAt} lang={lang} />
      ) : (
        <p className="mt-2">{t.noSuccessfulRun}</p>
      )}
    </Notice>
  );
}

function integrationHref(availability: FinancialIntegrationAvailabilityV1) {
  const path = availability.href;
  return availability.available &&
    path &&
    /^\/(?!\/)/u.test(path) &&
    [...path].every((character) => character.charCodeAt(0) > 32 && character !== '\\')
    ? path
    : null;
}
function IntegrationLinks({
  capabilities,
  admin,
  lang,
}: {
  capabilities: FinancialOperationsCapabilitiesV1;
  admin: boolean;
  lang: FinancialLanguage;
}) {
  const t = FINANCIAL_OPERATIONS_COPY[lang];
  const links = admin
    ? [
        {
          capability: capabilities.receiptReview,
          label: t.receiptReview,
          unavailable: t.receiptUnavailable,
        },
        {
          capability: capabilities.refund,
          label: t.refundWorkspace,
          unavailable: t.refundUnavailable,
        },
      ]
    : [
        { capability: capabilities.myPlan, label: t.myPlan, unavailable: t.planUnavailable },
        {
          capability: capabilities.refund,
          label: t.refundWorkspace,
          unavailable: t.refundUnavailable,
        },
      ];
  return (
    <aside className="space-y-2 rounded-xl border border-border p-4">
      {links.map((entry) => {
        const href = integrationHref(entry.capability);
        return href ? (
          <Button asChild variant="outline" className={actionClass} key={entry.label}>
            <Link to={href}>{entry.label}</Link>
          </Button>
        ) : (
          <p key={entry.label} className={mutedClass}>
            {entry.unavailable}
          </p>
        );
      })}
    </aside>
  );
}

function FinancialModal({
  title,
  description,
  onClose,
  opener,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  opener: RefObject<HTMLButtonElement>;
  children: ReactNode;
}) {
  const { lang, dir, darkMode } = useLang();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          lang={lang}
          dir={dir}
          className={
            (darkMode ? 'dark ' : '') +
            'fixed inset-x-4 top-1/2 z-50 mx-auto grid max-h-[90dvh] max-w-2xl -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border border-border bg-background p-4 text-foreground shadow-lg sm:p-6'
          }
          onCloseAutoFocus={(event) => {
            if (opener.current) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
        >
          <Dialog.Title className="pe-12 text-xl font-semibold">{title}</Dialog.Title>
          <Dialog.Description className={mutedClass}>{description}</Dialog.Description>
          {children}
          <Dialog.Close asChild>
            <Button variant="outline" className={actionClass}>
              {FINANCIAL_OPERATIONS_COPY[lang].close}
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
