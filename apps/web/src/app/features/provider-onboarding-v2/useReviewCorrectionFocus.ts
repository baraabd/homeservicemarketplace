import { useEffect, useRef, useState } from 'react';
import {
  PROVIDER_REVIEW_TASK_IDS,
  isProviderReviewCorrectionField,
  type ProviderReviewTaskId,
} from '@homeservicemarketplace/contracts';

/** The URL carries domain values only. It can never supply a CSS selector. */
export function readReviewCorrectionTarget(taskId: string | undefined, search: string) {
  if (!PROVIDER_REVIEW_TASK_IDS.some((task) => task === taskId)) return null;
  const params = new URLSearchParams(search);
  const field = params.get('reviewField');
  if (!field || !isProviderReviewCorrectionField(taskId as ProviderReviewTaskId, field))
    return null;
  const itemId = params.get('reviewItem');
  if (itemId && (itemId.length > 64 || !['portfolio', 'specialties'].includes(field))) return null;
  return { field: field === 'professionSince' ? 'yearsOfExperience' : field, itemId };
}

/** One explicit correction navigation, one focus. The observer is scoped to the
 * task body and stops as soon as the target mounts or the provider interacts.
 * Draft refreshes, typing, language changes and ordinary task visits never
 * repeatedly move focus or write application data. */
export function useReviewCorrectionFocus({
  taskId,
  search,
  navigationKey,
  enabled,
}: {
  taskId: string | undefined;
  search: string;
  navigationKey: string;
  enabled: boolean;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const attemptedNavigation = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !root) return;
    const target = readReviewCorrectionTarget(taskId, search);
    if (!target) return;
    const intent = `${navigationKey}:${taskId}:${search}`;
    if (attemptedNavigation.current === intent) return;
    const stop = () => {
      attemptedNavigation.current = intent;
      observer.disconnect();
      root.removeEventListener('pointerdown', stop, true);
      root.removeEventListener('keydown', stop, true);
    };
    const focus = () => {
      if (attemptedNavigation.current === intent) return;
      const anchor = [...root.querySelectorAll<HTMLElement>('[data-review-field]')].find(
        (node) =>
          node.dataset.reviewField === target.field &&
          (target.itemId ? node.dataset.reviewItem === target.itemId : !node.dataset.reviewItem),
      );
      if (!anchor || anchor.closest('[hidden], [aria-hidden="true"]')) return;
      const controls =
        'button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([type="file"]), textarea:not([disabled]), select:not([disabled])';
      const control = anchor.matches(controls)
        ? anchor
        : anchor.querySelector<HTMLElement>(controls);
      if (!control) return;
      stop();
      control.focus({ preventScroll: true });
      anchor.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' });
    };
    root.addEventListener('pointerdown', stop, true);
    root.addEventListener('keydown', stop, true);
    const observer = new MutationObserver(focus);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden'],
    });
    focus();
    return () => {
      observer.disconnect();
      root.removeEventListener('pointerdown', stop, true);
      root.removeEventListener('keydown', stop, true);
    };
  }, [root, taskId, search, navigationKey, enabled]);
  return setRoot;
}
