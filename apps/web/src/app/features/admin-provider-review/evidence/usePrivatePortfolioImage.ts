import { useEffect, useState } from 'react';
import type { AdminPortfolioItem } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { requestStatus } from '../api';

type Preview = {
  providerId: string;
  itemId: string;
  revision: number;
  openId: number;
  url?: string;
  failed?: boolean;
  failedStatus?: number;
};
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

/** Explicit authenticated reads only. Bytes never enter query caches or browser storage. */
export function usePrivatePortfolioImage(
  providerId: string,
  item: AdminPortfolioItem | null,
  openId: number,
) {
  const [state, setState] = useState<Preview | null>(null);
  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    const identity = { providerId, itemId: item.id, revision: item.revision, openId };
    let objectUrl: string | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    function release() {
      controller.abort();
      if (expiry) clearTimeout(expiry);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    }
    function expire() {
      release();
      setState({ ...identity, failed: true });
    }
    function sessionExpired() {
      release();
      setState({ ...identity, failed: true, failedStatus: 401 });
    }
    window.addEventListener('auth:session-expired', sessionExpired);
    const path = `/v1/admin/providers/${encodeURIComponent(providerId)}/portfolio/${encodeURIComponent(item.id)}/media`;
    void api
      .get<Blob>(path, { responseType: 'blob', signal: controller.signal, timeout: 30000 })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const mime = data.type.split(';')[0].trim().toLowerCase();
        if (!IMAGE_TYPES.has(mime) || data.size === 0 || data.size > 20 * 1024 * 1024) {
          throw new Error('Unsupported image response');
        }
        objectUrl = URL.createObjectURL(data);
        setState({ ...identity, url: objectUrl });
        // Like identity previews, retained bytes expire; reopening requires a new authorized read.
        expiry = setTimeout(expire, 5 * 60 * 1000);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setState({ ...identity, failed: true, failedStatus: requestStatus(failure) });
      });
    return () => {
      window.removeEventListener('auth:session-expired', sessionExpired);
      release();
    };
  }, [providerId, item, openId]);
  return item &&
    state?.providerId === providerId &&
    state.itemId === item.id &&
    state.revision === item.revision &&
    state.openId === openId
    ? state
    : null;
}
