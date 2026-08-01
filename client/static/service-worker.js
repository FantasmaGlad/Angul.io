// Service worker (Lot 7.2) — JS brut, pas TypeScript : fichier autonome sans import, chargé tel
// quel par le navigateur (contrairement à src/, qui passe par tsc+esbuild), donc aucun besoin de
// la chaîne de build du reste du client.
//
// Portée volontairement limitée à des assets qui ne changent JAMAIS entre deux déploiements
// (icônes/manifeste PWA) — jamais à l'API (`/api/*`), au WebSocket du jeu, ni à `/`/`index.html`/
// `bundle.js` : ces trois derniers changent à CHAQUE déploiement, et une stratégie cache-first
// (voir le handler `fetch` plus bas) les aurait servis indéfiniment périmés à tout appareil ayant
// déjà installé le service worker — un déploiement serveur n'aurait alors plus aucun effet
// visible côté client tant que ce service worker particulier reste installé (aucune raison pour
// le navigateur de le ré-installer : le fichier service-worker.js lui-même ne change pas à chaque
// déploiement). Même logique que l'exclusion de `/api`/WS ci-dessus, appliquée jusqu'au bout :
// une coquille figée est pire qu'une absence de cache.
//
// `CACHE_NAME` a été incrémenté (v1 -> v2) pour cette raison précise : purger, chez tout appareil
// ayant déjà installé l'ancien service worker, le cache `v1` qui contenait encore `/bundle.js`/
// `index.html` (voir le handler `activate` plus bas, qui supprime tout cache dont le nom ne
// correspond plus à `CACHE_NAME` courant). Incrémenté à nouveau (v2 -> v3) pour la même raison :
// nouveau logo/favicon (assets/Logos/LogoIcon.png) — sans ce bump, un appareil ayant déjà installé
// la PWA garderait l'ancien favicon en cache indéfiniment.
const CACHE_NAME = 'angulio-shell-v4';
const PRECACHE_URLS = [
  '/manifest.json',
  '/favicon.ico',
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
