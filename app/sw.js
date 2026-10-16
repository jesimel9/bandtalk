// BandTalk pour iPhone — service worker : l'appli s'ouvre vite, même avec une connexion faible.
// Les fichiers sont mis à jour en arrière-plan ; changer VERSION à chaque nouvelle version
// force tous les iPhone à tout recharger d'un coup.
const VERSION = 'bandtalk-web-1.0.1';

const FICHIERS = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/audio.js',
  'js/backend.js',
  'js/config.js',
  'js/reglages.js',
  'js/session.js',
  'vendor/supabase-2.117.2.js',
  'vendor/qrcode-1.4.4.js',
  'vendor/jsqr-1.4.0.js',
  'vendor/agora-rtc-4.24.8.js',
  'sons/beep.wav',
  'sons/click_hi.wav',
  'sons/click_lo.wav',
  'sons/count_one.wav',
  'sons/count_two.wav',
  'sons/count_three.wav',
  'sons/count_four.wav',
  'sons/count_go.wav',
  'polices/Figtree-Regular.ttf',
  'polices/Figtree-Medium.ttf',
  'polices/Figtree-SemiBold.ttf',
  'polices/Figtree-Bold.ttf',
  'polices/Figtree-ExtraBold.ttf',
  'polices/SpaceGrotesk-SemiBold.ttf',
  'polices/SpaceGrotesk-Bold.ttf',
  'icones/icone-180.png',
  'icones/icone-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(FICHIERS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Base de données, Agora, Wave… : jamais mis en cache.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Page d'accueil : réseau d'abord (nouvelle version), copie en cache si pas de réseau.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html')),
    );
    return;
  }

  // Fichiers de l'appli : la copie en cache tout de suite (rapide), mise à jour en arrière-plan
  // pour la prochaine ouverture.
  const reseau = caches.open(VERSION).then((cache) =>
    fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }),
  );
  event.waitUntil(reseau.catch(() => {}));
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? reseau));
});
