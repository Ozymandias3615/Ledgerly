import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";

// Matches the old generateSW config's registerType: "autoUpdate" behavior -
// a newly installed worker takes over immediately instead of waiting for
// every open tab to close first.
self.skipWaiting();
clientsClaim();

// App-shell caching only, same scope as before (js/css/html) - injected at
// build time by vite-plugin-pwa's injectManifest strategy.
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "LedgerlyPulse", message: event.data.text() };
  }
  const { title, message, link } = payload;
  event.waitUntil(
    self.registration.showNotification(title || "LedgerlyPulse", {
      body: message || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link: link || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      return clients.openWindow(link);
    })
  );
});
