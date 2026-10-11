import { createElement, lazy, type ComponentType } from 'react';
import { AsyncBoundary } from './AsyncBoundary';

/** Declare once beside the route table; guards decide when the import starts. */
export function lazyPage(
  load: () => Promise<{ default: ComponentType }>,
  options: { standalone?: boolean } = {},
) {
  const Page = lazy(load);
  return function DeferredPage() {
    return createElement(AsyncBoundary, { ...options, children: createElement(Page) });
  };
}
