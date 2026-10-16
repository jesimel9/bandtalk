// BandTalk pour iPhone — service worker : l'appli s'ouvre vite, même avec une connexion faible.
// Le code est relu sur le réseau à chaque ouverture ; changer VERSION à chaque nouvelle version
// recharge en plus les applis déjà ouvertes sur tous les iPhone.
const VERSION = 'bandtalk-web-1.0.2';

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
      // « reload » : jamais la copie gardée par le navigateur ou par GitHub (jusqu'à 10 min).
      .then((cache) => cache.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
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

  // Bibliothèques, sons, polices, icônes : leur nom ne change jamais pour un même contenu,
  // la copie en cache suffit (ouverture rapide, même en 4G faible).
  if (/\/(vendor|sons|polices|icones)\//.test(url.pathname)) {
    event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? fetch(req)));
    return;
  }

  // Page, code et style de l'appli : TOUJOURS la dernière version publiée quand il y a du réseau
  // (les iPhone sont à jour dès l'ouverture, sans rien faire). Sans réseau, ou si le réseau met
  // plus de 3 s à répondre, la copie en cache prend le relais.
  event.respondWith(reseauDabord(req, req.mode === 'navigate' ? 'index.html' : req));
});

async function reseauDabord(req, cle) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([
      // Revalidation : réponse « inchangé » très légère. Une requête de page ne peut pas être
      // modifiée telle quelle : on repart de son adresse.
      fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }),
      new Promise((_, refus) => setTimeout(() => refus(new Error('réseau lent')), 3000)),
    ]);
    if (res.ok) cache.put(cle, res.clone());
    return res;
  } catch {
    const copie = await cache.match(cle, { ignoreSearch: true });
    return copie ?? fetch(req);
  }
}
