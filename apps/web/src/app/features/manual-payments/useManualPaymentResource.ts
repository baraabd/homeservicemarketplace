import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AUTH_BOUNDARY_KEY, authRequestScope } from '../../../lib/auth-session-boundary';

/** Private metadata is scoped to the current view/session and never persisted in browser storage. */
export function useManualPaymentResource<T>(
  resourceKey: string,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const key = `${authRequestScope()}:${resourceKey}`;
  const [refreshId, setRefreshId] = useState(0);
  const requestKey = `${key}:${refreshId}`;
  const activeKey = useRef<string | null>(requestKey);
  useLayoutEffect(() => {
    activeKey.current = requestKey;
  }, [requestKey]);
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: unknown;
  } | null>(null);
  const [sessionEnded, setSessionEnded] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const clear = () => {
      controller.abort();
      current = false;
      activeKey.current = null;
      setState(null);
      setSessionEnded(key);
    };
    const boundaryChanged = (event: StorageEvent) => {
      if (event.key === AUTH_BOUNDARY_KEY) clear();
    };
    window.addEventListener('auth:session-expired', clear);
    window.addEventListener('storage', boundaryChanged);
    void load(controller.signal).then(
      (data) => {
        if (current && !controller.signal.aborted && activeKey.current === requestKey)
          setState({ key: requestKey, data, error: null });
      },
      (error: unknown) => {
        if (current && !controller.signal.aborted && activeKey.current === requestKey)
          setState({ key: requestKey, data: null, error });
      },
    );
    return () => {
      current = false;
      controller.abort();
      window.removeEventListener('auth:session-expired', clear);
      window.removeEventListener('storage', boundaryChanged);
    };
  }, [key, load, requestKey]);
  const refresh = useCallback(() => {
    setSessionEnded(null);
    setRefreshId((value) => value + 1);
  }, []);
  const accept = useCallback(
    (data: T) => {
      if (activeKey.current === requestKey) setState({ key: requestKey, data, error: null });
    },
    [requestKey],
  );
  const visible = state?.key === requestKey ? state : null;
  return {
    data: sessionEnded === key ? null : (visible?.data ?? null),
    error: sessionEnded === key ? { response: { status: 401 } } : (visible?.error ?? null),
    loading: sessionEnded !== key && visible === null,
    refresh,
    accept,
  };
}
