import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches, kept in sync when the window changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Screens wide enough for dialogs over the page (Tailwind's md breakpoint). */
export const WIDE = '(min-width: 768px)';
