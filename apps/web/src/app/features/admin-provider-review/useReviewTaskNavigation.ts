import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { AdminProviderReviewTaskId } from '@homeservicemarketplace/contracts';
import {
  reviewTaskFromHash,
  reviewTaskSearch,
  selectedReviewTask,
} from './review-task-navigation';

/** Preserve the directory return state and support historical blocker deep links. */
export function useReviewTaskNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const task = selectedReviewTask(location.search, location.hash);
  const hashTask = reviewTaskFromHash(location.hash);

  useEffect(() => {
    if (!hashTask) return;
    const search = reviewTaskSearch(location.search, hashTask);
    if (search !== location.search) {
      void navigate({ pathname: location.pathname, search, hash: location.hash }, {
        replace: true,
        state: location.state,
        preventScrollReset: true,
      });
    }
  }, [hashTask, location.hash, location.pathname, location.search, location.state, navigate]);

  function selectTask(next: AdminProviderReviewTaskId) {
    void navigate({
      pathname: location.pathname,
      search: reviewTaskSearch(location.search, next),
      hash: '',
    }, {
      replace: true,
      state: location.state,
      preventScrollReset: true,
      // Radix Tabs uses automatic activation: moving focus with arrows/Home/End
      // immediately changes the active tab. Keep the controlled URL-derived
      // value in the same turn so a fast follow-up Tab key sees the matching
      // tabpanel as active/focusable instead of the previous panel.
      flushSync: true,
    });
  }

  return { task, selectTask, focusLinkedPanel: !!hashTask };
}
