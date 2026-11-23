import { useSyncExternalStore } from 'react';
import { isIos, isStandalone } from './push';

/** Chrome on Android offers installation through this event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export type InstallPlatform = 'ios' | 'prompt' | 'manual' | 'installed';

const isMobile = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches || /android|mobile/i.test(navigator.userAgent));

/** How Gier can be put on the home screen from where it is opened now. */
export function installPlatform(): InstallPlatform {
  if (installed || isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  if (isIos()) return 'ios';
  return 'manual';
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  emit();
  return outcome === 'accepted';
}

export function useInstall() {
  const platform = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    installPlatform,
    () => 'manual' as InstallPlatform,
  );
  return { platform, mobile: isMobile() };
}
