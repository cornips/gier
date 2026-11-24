/** Version of this build, e.g. "0.1.0 · 67fa275" (commit only in builds from CI). */
export const VERSION = __GIER_VERSION__;
export const COMMIT = __GIER_COMMIT__;
export const BUILD_LABEL = COMMIT ? `${VERSION} · ${COMMIT}` : VERSION;

/**
 * Hard refresh: drop the service worker and every cached file, then load the page fresh from the
 * server. Used when someone wants to be sure they run the latest version.
 */
export async function hardRefresh() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* not available: carry on */
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* not available: carry on */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('refresh', Date.now().toString(36));
  window.location.replace(url.toString());
}
