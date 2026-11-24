/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const scope = new URL(self.registration.scope).pathname;
/*
 * Pages always come from the network first. A proxy in front of Gier (such as Cloudflare Access) must
 * see every page load: when the session ended it answers with a redirect to its login, which the
 * browser then follows. Serving a cached page instead would show an app whose every request fails.
 * The last good page is kept only for when there is no network at all. The API is never cached.
 */
registerRoute(
  new NavigationRoute(new NetworkFirst({ cacheName: 'gier-pages', networkTimeoutSeconds: 6 }), {
    denylist: [new RegExp(`^${scope}api/`)],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  const data: PushPayload = (() => {
    try {
      return event.data?.json() as PushPayload;
    } catch {
      return { title: 'Gier', body: event.data?.text() ?? '' };
    }
  })();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: `${scope}icon-192.png`,
      badge: `${scope}icon-64.png`,
      tag: data.tag,
      data: { url: data.url ?? scope },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data as { url?: string })?.url ?? scope,
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => w.url.startsWith(self.location.origin + scope));
      if (existing) {
        await existing.focus();
        await existing.navigate(url);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
