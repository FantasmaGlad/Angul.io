// Service worker (Lot 7.2) — JS brut, pas TypeScript : fichier autonome sans import, chargé tel
// quel par le navigateur (contrairement à src/, qui passe par tsc+esbuild), donc aucun besoin de
// la chaîne de build du reste du client.
//
// Portée volontairement limitée à la "coquille" statique de l'app (menu/lobby) — jamais à l'API
// (`/api/*`) ni au WebSocket du jeu : un salon list périmé ou une partie qui semble tourner hors
// ligne serait pire qu'une absence de cache. Seuls les fichiers listés ci-dessous sont
// interceptés ; tout le reste passe directement au réseau, comme sans service worker.
const CACHE_NAME = 'angulio-shell-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/bundle.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !PRECACHE_URLS.includes(url.pathname)) return;

  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
