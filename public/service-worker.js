// Elestio fork: PWA service worker neutralized.
// The upstream SW cached index.html / app.js / styles.css, which made baked
// UI customizations invisible without a hard refresh. This stub takes over,
// purges every cache, and unregisters itself — including SWs already installed
// on clients from a previous version, on their next page load.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', async () => {
  try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch (e) {}
  try { await self.clients.claim(); } catch (e) {}
  try { await self.registration.unregister(); } catch (e) {}
});
