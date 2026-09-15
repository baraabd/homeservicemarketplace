import { useLayoutEffect, useRef } from 'react';

/** Keep in-page links and the decision rail below the actual wrapped Admin header. */
export function useAdminHeaderOffset() {
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    if (!shell || !header) return;
    const measure = () => {
      const height = header.getBoundingClientRect().height;
      if (height > 0)
        shell.style.setProperty('--admin-header-offset', `${Math.ceil(height) + 16}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(header);
    if (!observer) window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', measure);
      shell.style.removeProperty('--admin-header-offset');
    };
  }, []);

  return { shellRef, headerRef };
}
