import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminVerificationQueueItem } from '@homeservicemarketplace/contracts';

import { useLang } from '../../../i18n/LanguageContext';
import { CASE_STATE_LABELS, UI } from '../copy/verification-copy';
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

export function AdminVerificationCaseWorkspace() {
  const { lang, dir } = useLang();
  const t = UI[lang];
  const qc = useQueryClient();

  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const evidence = useEvidenceDownload();

  const caseQuery = useQuery({
    queryKey: openCaseId ? caseKey(openCaseId) : ['admin', 'verification', 'case', 'none'],
    queryFn: () => getVerificationCase(openCaseId as string),
    enabled: openCaseId !== null,
  });

  const auditQuery = useQuery({
    queryKey: openCaseId ? auditKey(openCaseId) : ['admin', 'verification', 'audit', 'none'],
    queryFn: () => getCaseAudit(openCaseId as string),
    enabled: openCaseId !== null,
  });

  const commandMut = useMutation({
    mutationFn: (input: Omit<CaseCommandInput, 'caseId'>) =>
      runCaseCommand({ ...input, caseId: openCaseId as string }),
    onSuccess: () => {
      setErrorStatus(null);
      // Refetch rather than patch: a command can move the case somewhere the
      // client did not predict — a reject from IN_REVIEW, an approve that also
      // opened a grant — and the reviewer must see where it actually landed.
      if (openCaseId) {
        void qc.invalidateQueries({ queryKey: caseKey(openCaseId) });
        void qc.invalidateQueries({ queryKey: auditKey(openCaseId) });
      }
      void qc.invalidateQueries({ queryKey: ['admin', 'verification', 'queue'] });
    },
    onError: (err) => {
      // 409 (someone else decided first) and 403 (you may not) are different
      // things to tell a reviewer, and only the status distinguishes them.
      setErrorStatus((err as { response?: { status?: number } })?.response?.status ?? 500);
    },
  });

  function openCase(item: AdminVerificationQueueItem) {
    setErrorStatus(null);
    setOpenCaseId(item.id);
  }

  const kase = caseQuery.data ?? null;

  return (
    <div dir={dir} data-testid="admin-verification-workspace" className="space-y-6">
      <VerificationQueuePanel onOpenCase={openCase} selectedCaseId={openCaseId} />

      {openCaseId && (
        <section
          aria-label={t.caseActions}
          data-testid="admin-case-detail"
          className="space-y-4 rounded-xl border p-4"
        >
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

          {kase && (
            <>
              <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{CASE_STATE_LABELS[lang][kase.state]}</h3>
                <span className="text-xs text-slate-500" data-testid="case-policy-version">
                  {t.policyVersion}: {kase.policyVersion}
                </span>
              </header>

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
                onView={evidence.open}
              />

              {evidence.failed && (
                <p role="alert" data-testid="evidence-open-error" className="text-sm text-red-600">
                  {t.evidenceOpenFailed}
                </p>
              )}

              <CaseActionsPanel
                verificationCase={kase}
                pending={commandMut.isPending}
                errorStatus={errorStatus}
                onReload={() => {
                  setErrorStatus(null);
                  void caseQuery.refetch();
                }}
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
                        {d.outcome} — {d.reasonCode} ({d.policyVersion})
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
                        {a.type} — {new Date(a.createdAt).toLocaleString(lang)}
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
