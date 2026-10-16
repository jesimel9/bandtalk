// Réglages de la version iPhone (web-app) de BandTalk.
// Mêmes valeurs que lib/config/backend_config.dart dans l'appli Android.

export const VERSION = '1.0.2';

export const SUPABASE_URL = 'https://uoarafoznwtoxjkftngf.supabase.co';
// Clé « publishable » : publique par nature (jamais la clé secrète ici).
export const SUPABASE_KEY = 'sb_publishable_FYQsUUsnaQZ2ArtudLsQUg_pb5rHeS6';

export const SITE_URL = 'https://jesimel9.github.io/bandtalk/';
export const WHATSAPP = '2250797361516';

/** Rôles (lib/models/models.dart). */
export const ROLES = [
  { id: 'chef', label: 'Chef de groupe' },
  { id: 'musicien', label: 'Musicien' },
  { id: 'inge', label: 'Ingé son' },
];

/** Sections auxquelles on peut parler séparément. */
export const SECTIONS = ['Rythme', 'Voix', 'Cuivres', 'Claviers', 'Régie'];

/** Signaux rapides : mêmes identifiants que l'appli Android. */
export const CUES = [
  { id: 'solo', label: 'Solo', icon: '♪' },
  { id: 'refrain', label: 'Refrain', icon: '↻' },
  { id: 'break', label: 'Break', icon: '❚❚' },
  { id: 'reprise', label: 'Reprise', icon: '▶' },
  { id: 'louder', label: '+ Fort', icon: '🔊' },
  { id: 'softer', label: '− Fort', icon: '🔉' },
  { id: 'alert', label: 'Alerte Son', icon: '⚠', tone: 'amber' },
  { id: 'stop', label: 'Stop', icon: '✋', tone: 'red' },
];

export const cueById = (id) => CUES.find((c) => c.id === id) ?? CUES[0];

export const roleLabel = (id) => (ROLES.find((r) => r.id === id) ?? ROLES[1]).label;
