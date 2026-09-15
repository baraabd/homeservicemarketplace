import { useLocation, useSearchParams } from 'react-router';

/** Filters/current cursor are shareable URLs; the trail uses native history to keep URLs bounded. */
export function useDirectoryLocation() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const cursor = params.get('cursor') || undefined;
  const stored: unknown = location.state?.adminDirectoryCursorTrail;
  const trail: string[] =
    Array.isArray(stored) && stored.every((value) => typeof value === 'string')
      ? stored
      : params.getAll('previousCursor');

  function filter(patch: Record<string, string | undefined>) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('cursor');
        next.delete('previousCursor');
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { state: { adminDirectoryCursorTrail: [] } },
    );
  }

  function nextPage(nextCursor: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('previousCursor');
        next.set('cursor', nextCursor);
        return next;
      },
      { state: { adminDirectoryCursorTrail: [...trail, cursor ?? ''] } },
    );
  }

  function previousPage() {
    const history = [...trail];
    const prior = history.pop();
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('previousCursor');
        if (prior) next.set('cursor', prior);
        else next.delete('cursor');
        return next;
      },
      { state: { adminDirectoryCursorTrail: history } },
    );
  }

  return {
    params,
    cursor,
    filter,
    nextPage,
    previousPage,
    hasPrevious: Boolean(cursor),
    previousIsFirst: trail.length === 0,
  };
}
