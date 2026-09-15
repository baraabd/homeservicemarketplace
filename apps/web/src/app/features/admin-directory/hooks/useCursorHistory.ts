import { useState } from 'react';

/** Local cursor history for embedded legacy lists; full directories use URL state. */
export function useCursorHistory() {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  return {
    cursor: cursors[cursors.length - 1],
    hasPrevious: cursors.length > 1,
    nextPage: (cursor: string) => setCursors((history) => [...history, cursor]),
    previousPage: () =>
      setCursors((history) => (history.length > 1 ? history.slice(0, -1) : history)),
    reset: () => setCursors([undefined]),
  };
}
