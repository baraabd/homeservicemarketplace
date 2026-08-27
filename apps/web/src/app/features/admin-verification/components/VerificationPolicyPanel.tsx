import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListVerificationPoliciesResponse,
  VerificationDocumentKindCode,
  VerificationPolicySummary,
} from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import { useLang } from '../../../i18n/LanguageContext';
import { DOCUMENT_KIND_LABELS, UI } from '../copy/verification-copy';

// Sprint 9B.12 — publishing, inspecting and retiring verification policies.
//
// docs/sprint-09b12/ADMIN_VERIFICATION_UX.md
//
// POLICIES ARE APPEND-ONLY, and the UI has to make that obvious rather than
// merely enforce it. There is no edit control anywhere on this panel — not
// disabled, absent — because editing a published version would change what a
// provider was judged against AFTER they were judged. An operator who wants
// different rules publishes a new version; the old one is retired, and every
// case decided under it still points at what it actually said.
//
// The server owns the lifecycle (ADR 0010): overlap rules, version format, and
// what may be retired. This panel renders `isLive` and offers retire on what
// the server says is live — it derives neither.

const POLICY_KEY = ['admin', 'verification', 'policies'] as const;

const DOCUMENT_KINDS: VerificationDocumentKindCode[] = [
  'INDIVIDUAL_IDENTITY',
  'BUSINESS_REGISTRATION',
  'AUTHORIZED_REPRESENTATIVE_IDENTITY',
  'CATEGORY_LICENSE',
];

async function listPolicies(): Promise<ListVerificationPoliciesResponse> {
  const { data } = await api.get<ListVerificationPoliciesResponse>(
    '/v1/admin/verification/policies',
  );
  return data;
}

export function VerificationPolicyPanel() {
  const { lang, dir } = useLang();
  const t = UI[lang];
  const qc = useQueryClient();

  const query = useQuery({ queryKey: POLICY_KEY, queryFn: listPolicies });
  const invalidate = () => void qc.invalidateQueries({ queryKey: POLICY_KEY });

  const publishMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post('/v1/admin/verification/policies', body),
    onSuccess: invalidate,
  });
  const retireMut = useMutation({
    mutationFn: (version: string) =>
      api.post(`/v1/admin/verification/policies/${encodeURIComponent(version)}/retire`),
    onSuccess: invalidate,
  });

  const [version, setVersion] = useState('');
  const [country, setCountry] = useState('');
  const [kinds, setKinds] = useState<VerificationDocumentKindCode[]>(['INDIVIDUAL_IDENTITY']);
  const [error, setError] = useState<string | null>(null);

  const failureStatus = (query.error as { response?: { status?: number } } | null)?.response
    ?.status;

  if (query.isError && failureStatus === 403) {
    return (
      <section aria-label={t.policyTitle} dir={dir} data-testid="policy-forbidden">
        <h3 className="text-base font-semibold">{t.forbiddenTitle}</h3>
        <p role="alert" className="text-sm">
          {t.forbiddenBody}
        </p>
      </section>
    );
  }

  const policies: VerificationPolicySummary[] = query.data?.policies ?? [];

  return (
    <section aria-label={t.policyTitle} dir={dir} data-testid="policy-panel" className="space-y-3">
      <h3 className="text-base font-semibold">{t.policyTitle}</h3>
      {/* Stated, not just enforced: an operator hunting for an edit button
          should find out why there isn't one. */}
      <p className="text-xs text-slate-500 dark:text-slate-400">{t.policyAppendOnly}</p>

      {query.isLoading && (
        <p aria-busy="true" data-testid="policy-loading" className="text-sm">
          {t.loading}
        </p>
      )}

      {!query.isLoading && policies.length === 0 && (
        <p data-testid="policy-empty" className="text-sm">
          {t.policyEmpty}
        </p>
      )}

      {policies.length > 0 && (
        <table className="w-full text-sm" data-testid="policy-table">
          <thead>
            <tr>
              <th scope="col" className="p-2 text-start">
                {t.policyVersionLabel}
              </th>
              <th scope="col" className="p-2 text-start">
                {t.policyCountry}
              </th>
              <th scope="col" className="p-2 text-start">
                {t.policyDocuments}
              </th>
              <th scope="col" className="p-2 text-start">
                {t.policyPublishedAt}
              </th>
              <th scope="col" className="p-2 text-start">
                {t.filterState}
              </th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.version} data-testid={`policy-row-${p.version}`}>
                <td className="p-2 font-semibold">{p.version}</td>
                <td className="p-2">{p.country ?? '—'}</td>
                <td className="p-2">
                  {p.requirements.documents.map((d) => DOCUMENT_KIND_LABELS[lang][d]).join('، ')}
                </td>
                <td className="p-2">{new Date(p.publishedAt).toLocaleDateString(lang)}</td>
                <td className="p-2">
                  <span
                    data-testid={`policy-live-${p.version}`}
                    data-live={p.isLive ? 'true' : 'false'}
                  >
                    {p.isLive ? t.policyLive : t.policyRetired}
                  </span>
                  {p.isLive && (
                    <button
                      type="button"
                      data-testid={`policy-retire-${p.version}`}
                      onClick={() => retireMut.mutate(p.version)}
                      className="ms-2 rounded-lg border px-2 py-1 text-xs font-semibold"
                    >
                      {t.policyRetire}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── publish a new version ────────────────────────────────────────── */}
      <form
        data-testid="policy-publish-form"
        className="space-y-2 rounded-lg border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!version.trim()) {
            setError(t.reasonRequired);
            return;
          }
          publishMut.mutate(
            {
              version: version.trim(),
              country: country.trim() || null,
              requirements: { documents: kinds, verificationRequired: true },
            },
            {
              onSuccess: () => {
                setVersion('');
                setCountry('');
              },
              // The server owns version format and overlap. Its refusal is
              // shown rather than pre-empted by a rule copied into React.
              onError: (err) =>
                setError(
                  (err as { response?: { data?: { error?: { message?: string } } } })?.response
                    ?.data?.error?.message ?? t.failed,
                ),
            },
          );
        }}
      >
        <h4 className="text-sm font-semibold">{t.policyPublish}</h4>

        <label className="block text-xs" htmlFor="policy-version">
          {t.policyVersionLabel}
        </label>
        <input
          id="policy-version"
          data-testid="policy-version"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="w-full rounded-lg border px-2 py-1.5 text-sm"
        />

        <label className="block text-xs" htmlFor="policy-country">
          {t.policyCountry}
        </label>
        <input
          id="policy-country"
          data-testid="policy-country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="w-full rounded-lg border px-2 py-1.5 text-sm"
        />

        <fieldset>
          <legend className="text-xs">{t.policyDocuments}</legend>
          {DOCUMENT_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid={`policy-kind-${kind}`}
                checked={kinds.includes(kind)}
                onChange={(e) =>
                  setKinds((k) => (e.target.checked ? [...k, kind] : k.filter((x) => x !== kind)))
                }
              />
              {DOCUMENT_KIND_LABELS[lang][kind]}
            </label>
          ))}
        </fieldset>

        {error && (
          <p role="alert" data-testid="policy-error" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          data-testid="policy-publish"
          disabled={publishMut.isPending}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t.policyPublish}
        </button>
      </form>
    </section>
  );
}
