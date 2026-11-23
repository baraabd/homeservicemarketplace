import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminVerificationQueueItem } from '@homeservicemarketplace/contracts';

import { useLang } from '../../../i18n/LanguageContext';
import { CASE_STATE_LABELS, UI, caseAuditLabel } from '../copy/verification-copy';
import {
  getCaseAudit,
  getVerificationCase,
  runCaseCommand,
  type CaseCommandInput,
} from '../queue/verification-queue-api';
import { useEvidenceDownload } from '../evidence/useEvidenceDownload';
import { CaseActionsPanel } from './CaseActionsPanel';
import { VerificationEvidencePanel } from './VerificationEvidencePanel';
import { VerificationQueuePanel } from './VerificationQueuePanel';
import { WorkAccessPanel } from './WorkAccessPanel';
import { verificationReasonLabel } from '../../admin-provider-review/evidence/verification-reason-labels';
import { statusLabel } from '../../admin-provider-review/copy';
import {
  hasPendingIdentityScan,
  IDENTITY_SCAN_REFRESH_MS,
} from '../../admin-provider-review/identity-review-guidance';

// Sprint 9B.12 — the reviewer's workspace: queue on one side, the open case on
// the other.
//
// docs/sprint-09b12/ADMIN_VERIFICATION_UX.md
//
// This component owns the REQUESTS and nothing else. It does not decide which
// actions exist (the server does), what a state means (the copy module does),
// or whether a document may be opened (`viewable`, server-computed). Its whole
// job is to fetch, to pass the failure status down so the panels can tell a
// 409 from a 403, and to refetch after a command so the reviewer sees where the
// case actually landed rather than where they assumed it would.

const caseKey = (id: string) => ['admin', 'verification', 'case', id] as const;
const auditKey = (id: string) => ['admin', 'verification', 'case', id, 'audit'] as const;

export function AdminVerificationCaseWorkspace({
  selectedCaseId,
  onSelectCase,
  onOpenProvider,
  queueLocationState,
}: {
  selectedCaseId?: string | null;
  onSelectCase?: (id: string | null) => void;
  onOpenProvider?: (id: string) => void;
  queueLocationState?: import('./VerificationQueuePanel').VerificationQueuePanelProps['locationState'];
} = {}) {
  const { lang, dir } = useLang();
  const t = UI[lang];
  const qc = useQueryClient();

  const [localCaseId, setLocalCaseId] = useState<string | null>(null);
  const openCaseId = selectedCaseId === undefined ? localCaseId : selectedCaseId;
  const setOpenCaseId = onSelectCase ?? setLocalCaseId;
  const [commandError, setCommandError] = useState<{ caseId: string; status: number } | null>(null);
  const [reviewVersions, setReviewVersions] = useState<Record<string, number>>({});
  const errorStatus = commandError?.caseId === openCaseId ? commandError.status : null;
  const evidence = useEvidenceDownload();

  const caseQuery = useQuery({
    queryKey: openCaseId ? caseKey(openCaseId) : ['admin', 'verification', 'case', 'none'],
    queryFn: () => getVerificationCase(openCaseId as string),
    enabled: openCaseId !== null,
    // The application cache keeps ordinary reads for five minutes; review
    // permissions must be revalidated whenever a cached case is reopened.
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.status !== 'error' && hasPendingIdentityScan(query.state.data)
        ? IDENTITY_SCAN_REFRESH_MS
        : false,
  });

  const auditQuery = useQuery({
    queryKey: openCaseId ? auditKey(openCaseId) : ['admin', 'verification', 'audit', 'none'],
    queryFn: () => getCaseAudit(openCaseId as string),
    enabled: openCaseId !== null,
  });

  const commandMut = useMutation({
    mutationFn: (input: CaseCommandInput) => runCaseCommand(input),
    onSuccess: (_result, input) => {
      setCommandError((current) => (current?.caseId === input.caseId ? null : current));
      // Refetch rather than patch: a command can move the case somewhere the
      // client did not predict — a reject from IN_REVIEW, an approve that also
      // opened a grant — and the reviewer must see where it actually landed.
      void qc.invalidateQueries({ queryKey: caseKey(input.caseId) });
      void qc.invalidateQueries({ queryKey: auditKey(input.caseId) });
      void qc.invalidateQueries({ queryKey: ['admin', 'verification', 'queue'] });
    },
    onError: (err, input) => {
      // 409 (someone else decided first) and 403 (you may not) are different
      // things to tell a reviewer, and only the status distinguishes them.
      setCommandError({
        caseId: input.caseId,
        status: (err as { response?: { status?: number } })?.response?.status ?? 500,
      });
    },
  });

  function openCase(item: AdminVerificationQueueItem) {
    setOpenCaseId(item.id);
  }

  const kase = caseQuery.data ?? null;
  const readOnly = caseQuery.isFetching || caseQuery.isError;
  const readDenied =
    caseQuery.isError &&
    [401, 403, 404].includes(
      (caseQuery.error as { response?: { status?: number } })?.response?.status ?? 0,
    );
  async function refreshCase() {
    const refreshedCaseId = openCaseId;
    const response = await caseQuery.refetch();
    if (response.isError) throw response.error;
    if (refreshedCaseId) {
      setReviewVersions((current) => ({
        ...current,
        [refreshedCaseId]: (current[refreshedCaseId] ?? 0) + 1,
      }));
    }
    setCommandError((current) => (current?.caseId === refreshedCaseId ? null : current));
    return response.data;
  }

  return (
    <div dir={dir} data-testid="admin-verification-workspace" className="space-y-6">
      {(!onSelectCase || !openCaseId) && (
        <VerificationQueuePanel
          onOpenCase={openCase}
          selectedCaseId={openCaseId}
          locationState={queueLocationState}
        />
      )}
      {onSelectCase && openCaseId && (
        <div>
          <button type="button" className="ar-button" onClick={() => setOpenCaseId(null)}>
            {lang === 'ar' ? 'العودة إلى قضايا الهوية' : 'Back to identity cases'}
          </button>
        </div>
      )}

      {openCaseId && (
        <section
          aria-label={t.caseActions}
          data-testid="admin-case-detail"
          className="ar-card ar-stack"
        >
          <div>
            <button
              type="button"
              className="ar-button"
              data-testid="case-refresh"
              disabled={caseQuery.isFetching || commandMut.isPending}
              onClick={() => void refreshCase().catch(() => undefined)}
            >
              {t.reload}
            </button>
          </div>
          {caseQuery.isLoading && (
            <p aria-busy="true" data-testid="case-loading" className="text-sm">
              {t.loading}
            </p>
          )}

          {caseQuery.isError && (
            <p role="alert" data-testid="case-error" className="text-sm">
              {(caseQuery.error as { response?: { status?: number } })?.response?.status === 403
                ? t.forbiddenBody
                : t.failed}
            </p>
          )}

          {kase && !readDenied && (
            <>
              <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{CASE_STATE_LABELS[lang][kase.state]}</h3>
                <span className="text-xs text-slate-500" data-testid="case-policy-version">
                  {t.policyVersion}: {kase.policyVersion}
                </span>
              </header>

              {onOpenProvider && (
                <div>
                  <button
                    type="button"
                    className="ar-button ar-button-primary"
                    onClick={() => onOpenProvider(kase.providerProfileId)}
                  >
                    {lang === 'ar' ? 'فتح ملف المهني الكامل' : 'Open full provider profile'}
                  </button>
                </div>
              )}

              {/* Whether they can work RIGHT NOW — a different fact from the
                  case state, and the one a revoke decision turns on. */}
              <WorkAccessPanel workAccess={kase.workAccess} />

              {/* Requirements checklist and restricted evidence — reused
                  verbatim from the existing panel. Opening a document is a
                  separate audited call; `onView` is what makes the panel's
                  view button do anything at all. */}
              <VerificationEvidencePanel
                verificationCase={kase}
                lang={lang}
                isLoading={caseQuery.isLoading}
                isError={caseQuery.isError}
                readOnly={readOnly}
                onView={readOnly ? undefined : evidence.open}
              />

              {evidence.failed && (
                <p role="alert" data-testid="evidence-open-error" className="text-sm text-red-600">
                  {t.evidenceOpenFailed}
                </p>
              )}

              <CaseActionsPanel
                key={kase.id}
                verificationCase={kase}
                pending={commandMut.isPending}
                readOnly={readOnly}
                reviewVersion={reviewVersions[kase.id] ?? 0}
                errorStatus={errorStatus}
                onReload={refreshCase}
                onRun={(input) => commandMut.mutateAsync(input)}
              />

              {/* Decision history: what was decided, under which policy. */}
              <section aria-label={t.decisions} data-testid="case-decisions" className="space-y-1">
                <h4 className="text-sm font-semibold">{t.decisions}</h4>
                {kase.decisions.length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">{t.noDecisions}</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {kase.decisions.map((d) => (
                      <li key={d.id} data-testid={`case-decision-${d.id}`}>
                        {statusLabel(d.outcome, lang)} —{' '}
                        {verificationReasonLabel(d.reasonCode, lang)} (<bdi>{d.policyVersion}</bdi>)
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Audit history: everything that happened, not only decisions. */}
              <section aria-label={t.auditTitle} data-testid="case-audit" className="space-y-1">
                <h4 className="text-sm font-semibold">{t.auditTitle}</h4>
                {(auditQuery.data?.items ?? []).length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">{t.auditEmpty}</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {(auditQuery.data?.items ?? []).map((a) => (
                      <li key={a.id} data-testid={`case-audit-${a.id}`}>
                        {caseAuditLabel(a.type, lang)} —{' '}
                        {new Date(a.createdAt).toLocaleString(lang)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </section>
      )}
    </div>
  );
}
