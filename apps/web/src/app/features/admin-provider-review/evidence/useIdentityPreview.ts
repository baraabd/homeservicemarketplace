import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { requestStatus } from '../api';

export const IDENTITY_PREVIEW_LIFETIME_MS = 5 * 60 * 1000;
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
export type IdentityPreviewState =
  | { status: 'loading' }
  | { status: 'image'; url: string }
  | { status: 'pdf'; blob: Blob }
  | { status: 'unavailable' | 'unsupported' | 'expired' | 'sessionExpired' };

/** Only mounted after an explicit click. Restricted bytes never enter query/storage caches. */
export function useIdentityPreview(documentId: string, allowed: boolean, attempt: number) {
  const request = useMemo(() => ({ documentId, allowed, attempt }), [documentId, allowed, attempt]);
  const [state, setState] = useState<{
    request: typeof request;
    value: IdentityPreviewState;
  } | null>(null);
  useEffect(() => {
    if (!request.allowed) return;
    const publish = (value: IdentityPreviewState) => setState({ request, value });
    const controller = new AbortController();
    let url: string | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      controller.abort();
      if (timeout) clearTimeout(timeout);
      if (url) URL.revokeObjectURL(url);
      url = undefined;
    };
    const expired = () => {
      release();
      publish({ status: 'sessionExpired' });
    };
    window.addEventListener('auth:session-expired', expired);
    void api
      .get<Blob>(`/v1/verification/documents/${encodeURIComponent(request.documentId)}/content`, {
        responseType: 'blob',
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!(data instanceof Blob) || data.size === 0 || data.size > MAX_PREVIEW_BYTES) {
          publish({ status: 'unsupported' });
          return;
        }
        // The API sends detected MIME and nosniff; still refuse HTML/SVG/proxy error bodies.
        if (['image/jpeg', 'image/png'].includes(data.type)) {
          url = URL.createObjectURL(data);
          publish({ status: 'image', url });
        } else if (data.type === 'application/pdf') {
          publish({ status: 'pdf', blob: data });
        } else {
          publish({ status: 'unsupported' });
          return;
        }
        timeout = setTimeout(() => {
          release();
          publish({ status: 'expired' });
        }, IDENTITY_PREVIEW_LIFETIME_MS);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        publish({ status: requestStatus(failure) === 401 ? 'sessionExpired' : 'unavailable' });
      });
    return () => {
      window.removeEventListener('auth:session-expired', expired);
      release();
      // Drop PDF Blob references as well as revoking image URLs when access changes.
      setState(null);
    };
  }, [request]);
  // Fresh metadata revocation hides bytes immediately, before effect cleanup revokes the URL.
  if (!allowed) return { status: 'unavailable' as const };
  return state?.request === request ? state.value : { status: 'loading' as const };
}
