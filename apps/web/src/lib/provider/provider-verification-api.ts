import type {
  CreateVerificationCaseResponse,
  CurrentVerificationCaseResponse,
  FinalizeEvidenceUploadResponse,
  PrepareEvidenceUploadResponse,
  ProviderCapabilitiesResponse,
  VerificationDocumentKindCode,
} from '@homeservicemarketplace/contracts';

import { api, getCsrfToken } from '../api';

// Sprint 9B.11 — typed wrappers around the provider's own verification surface.
//
// Same shape as the sibling provider-*-api modules: `api` carries credentials,
// the request interceptor attaches CSRF on mutations, and the 401-refresh
// interceptor handles token rotation. Nothing here re-implements any of that.
//
// EVIDENCE UPLOAD IS NOT THE PUBLIC MEDIA PIPELINE. Portfolio photos go through
// /v1/media/presigned-url and land in public storage; identity documents go
// through these three calls and land in RESTRICTED storage, are malware
// scanned, and are readable only by their owner and an authorised reviewer.
// The two must never be collapsed into one helper — see Sprint 9B.10's doc for
// what depends on the separation.

export async function getProviderCapabilities(): Promise<ProviderCapabilitiesResponse> {
  const { data } = await api.get<ProviderCapabilitiesResponse>('/v1/me/provider/capabilities');
  return data;
}

export async function getVerificationCase(): Promise<CurrentVerificationCaseResponse> {
  const { data } = await api.get<CurrentVerificationCaseResponse>(
    '/v1/me/provider/verification/case',
  );
  return data;
}

export async function startVerificationCase(): Promise<CreateVerificationCaseResponse> {
  // No body. Creating resumes the open case when there is one, so a retry
  // after a timeout returns what already exists rather than a second attempt.
  const { data } = await api.post<CreateVerificationCaseResponse>(
    '/v1/me/provider/verification/case',
  );
  return data;
}

export async function submitVerificationCase(): Promise<unknown> {
  const { data } = await api.post('/v1/me/provider/verification/case/submit');
  return data;
}

export interface EvidenceUploadInput {
  file: File;
  kind: VerificationDocumentKindCode;
  serviceCategoryId?: string | null;
  onProgress?: (percent: number) => void;
}

/**
 * The whole three-step evidence upload, as one call.
 *
 * prepare → PUT the bytes → finalize. Kept together because a caller that ran
 * only the first two would leave a prepared asset with no document attached —
 * an orphan the cleanup sweep eventually reaps, and in the meantime a provider
 * who believes they uploaded something that is not there.
 */
export async function uploadEvidence(
  input: EvidenceUploadInput,
): Promise<FinalizeEvidenceUploadResponse> {
  const { data: prepared } = await api.post<PrepareEvidenceUploadResponse>(
    '/v1/me/provider/verification/evidence/prepare',
    {
      kind: input.kind,
      serviceCategoryId: input.serviceCategoryId ?? null,
      declaredMimeType: input.file.type,
      sizeBytes: input.file.size,
    },
  );

  await putBytes(
    `/v1/me/provider/verification/evidence/${prepared.assetId}/content`,
    input.file,
    input.onProgress,
  );

  const { data: finalized } = await api.post<FinalizeEvidenceUploadResponse>(
    `/v1/me/provider/verification/evidence/${prepared.assetId}/finalize`,
    {},
  );
  return finalized;
}

/**
 * XMLHttpRequest rather than fetch, for one reason: `upload.onprogress`.
 *
 * fetch has no upload progress event, and a provider photographing a passport
 * on a phone over a slow connection needs to see movement or they will tap
 * again — which is how two documents get uploaded for one requirement.
 *
 * Goes through the same axios baseURL and credentials as everything else by
 * reusing `api.defaults`, so this is not a second HTTP client with its own
 * idea of auth.
 */
function putBytes(path: string, file: File, onProgress?: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const base = (api.defaults.baseURL ?? '').replace(/\/$/, '');
    xhr.open('PUT', `${base}${path}`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type);

    // The CSRF header the axios interceptor would have added. This route is a
    // mutation on the same session, so it needs the same protection — and the
    // token is read by the SAME helper the interceptor uses, because a second
    // copy of "which cookie holds the token" is a rule that drifts. It already
    // had: this file first shipped reading `csrf_token`, and the cookie is
    // `hsm_csrf`, so every upload would have been refused.
    const csrf = getCsrfToken();
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.onabort = () => reject(new Error('upload aborted'));
    xhr.send(file);
  });
}
