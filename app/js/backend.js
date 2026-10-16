// Lien avec la base de données en ligne (Supabase) : compte, essai / abonnement,
// paiement, et jeton Agora pour les sessions 4G.
// Même base et mêmes fonctions que l'appli Android (lib/services/backend.dart,
// license_service.dart, profile_store.dart).
import { SUPABASE_URL, SUPABASE_KEY, VERSION } from './config.js';

// ------------------------------------------------------------------ stockage local

/** localStorage peut être bloqué (navigation privée) : jamais d'erreur, valeur par défaut. */
export const LS = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : v;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* stockage indisponible */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* stockage indisponible */
    }
  },
  json(k, d) {
    try {
      return JSON.parse(LS.get(k, '')) ?? d;
    } catch {
      return d;
    }
  },
};

export function randomHex(n) {
  const b = crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2)));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').slice(0, n);
}

/** Adresse de la web-app (retour après Google, lien « mot de passe oublié »). */
export const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');

/** Identifiant du téléphone pour la base (préfixe « web- » : repérable dans l'administration). */
export const deviceId = (() => {
  let id = LS.get('bt_appareil');
  if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
    id = 'web-' + randomHex(16);
    LS.set('bt_appareil', id);
  }
  return id;
})();

export function deviceModel() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad (web)';
  if (/iPhone/.test(ua)) return 'iPhone (web)';
  if (/Android/.test(ua)) return 'Android (web)';
  return 'Navigateur (web)';
}

function osVersion() {
  const ua = navigator.userAgent;
  const ios = ua.match(/OS (\d+)_(\d+)/);
  if (ios) return `iOS ${ios[1]}.${ios[2]}`;
  const android = ua.match(/Android (\d+(\.\d+)?)/);
  if (android) return `Android ${android[1]}`;
  return '';
}

// ------------------------------------------------------------------ client Supabase

export const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // « implicit » : le retour de Google fonctionne même s'il s'ouvre dans un autre onglet.
    flowType: 'implicit',
    storageKey: 'bt-auth',
  },
});

export class BackendError extends Error {
  constructor(message, { offline = false, code = null } = {}) {
    super(message);
    this.offline = offline;
    this.code = code;
  }
}

function isOffline(msg) {
  const m = String(msg ?? '').toLowerCase();
  return m.includes('failed to fetch') || m.includes('load failed') || m.includes('network') || !navigator.onLine;
}

function timeout(promise, ms, message) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new BackendError(message, { offline: true })), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/** Appelle une fonction de la base. Lève [BackendError] avec un message en français. */
export async function rpc(fn, params) {
  let res;
  try {
    res = await timeout(db.rpc(fn, params), 10000, 'Pas de réponse du serveur. Vérifiez votre connexion Internet.');
  } catch (e) {
    if (e instanceof BackendError) throw e;
    throw new BackendError(isOffline(e?.message) ? 'Pas de connexion Internet.' : String(e?.message ?? e), {
      offline: isOffline(e?.message),
    });
  }
  if (res.error) {
    const offline = isOffline(res.error.message);
    throw new BackendError(offline ? 'Pas de connexion Internet.' : res.error.message, { offline });
  }
  return res.data;
}

/** Appelle une fonction serveur (Edge Function). Erreurs traduites en [BackendError]. */
async function invoke(name, body) {
  let res;
  try {
    res = await timeout(db.functions.invoke(name, { body }), 25000, 'Pas de réponse du serveur. Vérifiez votre connexion Internet.');
  } catch (e) {
    if (e instanceof BackendError) throw e;
    throw new BackendError('Pas de connexion Internet.', { offline: true });
  }
  if (!res.error) return res.data;
  const ctx = res.error.context;
  let detail = null;
  let status = 0;
  if (ctx && typeof ctx.json === 'function') {
    status = ctx.status;
    detail = await ctx.json().catch(() => null);
  }
  if (status === 404) throw new BackendError('Fonction serveur absente.', { code: 'absente' });
  if (!status) throw new BackendError('Pas de connexion Internet.', { offline: true });
  throw new BackendError(detail?.message ?? `Erreur du serveur (${status}).`, { code: detail?.code ?? null });
}

// ------------------------------------------------------------------ profil local

export const profile = {
  id: '', // identifiant dans les sessions (comme profile.id dans l'appli Android)
  name: '',
  role: 'musicien',
  section: 'Rythme',
  phone: '',
  email: '',
  load() {
    this.id = LS.get('bt_uid');
    if (!this.id || !/^[0-9a-f]{16}$/.test(this.id)) {
      this.id = randomHex(16);
      LS.set('bt_uid', this.id);
    }
    this.name = LS.get('bt_nom', '');
    this.role = LS.get('bt_role', 'musicien');
    this.section = LS.get('bt_section', 'Rythme');
    this.phone = LS.get('bt_tel', '');
  },
  save() {
    LS.set('bt_nom', this.name);
    LS.set('bt_role', this.role);
    LS.set('bt_section', this.section);
    LS.set('bt_tel', this.phone);
  },
  fromUser(user) {
    if (!user) return;
    const meta = user.user_metadata ?? {};
    const pick = (...keys) => keys.map((k) => String(meta[k] ?? '').trim()).find((v) => v) ?? '';
    this.email = user.email ?? '';
    const n = pick('nom', 'full_name', 'name');
    if (!this.name) this.name = n || this.email.split('@')[0];
    const t = pick('telephone');
    if (t) this.phone = t;
    this.save();
  },
};

// ------------------------------------------------------------------ compte

export const currentUser = async () => (await db.auth.getSession()).data.session?.user ?? null;

function authMessage(e) {
  const raw = String(e?.message ?? e ?? '');
  const m = raw.toLowerCase();
  if (isOffline(m) || m.includes('fetch')) return 'Pas de connexion Internet. Connectez-vous à Internet (4G ou Wi-Fi).';
  if (m.includes('invalid login')) return 'Email ou mot de passe incorrect.';
  if (m.includes('already registered') || m.includes('already exists')) {
    return 'Un compte existe déjà avec cet email : choisissez « Connexion ».';
  }
  if (m.includes('not confirmed')) return 'Confirmez d’abord votre email (lien reçu par email).';
  if (m.includes('rate limit')) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) {
    return 'La connexion Google n’est pas encore activée. Utilisez l’email pour le moment.';
  }
  if (m.includes('password')) return 'Mot de passe trop faible : 6 caractères minimum.';
  if (m.includes('email')) return 'Adresse email refusée. Vérifiez-la.';
  return 'Connexion impossible : ' + raw;
}

/** Inscription. Renvoie { error } ou { info } (email de confirmation envoyé) ou {}. */
export async function register({ name, phone, email, password }) {
  if (!name.trim()) return { error: 'Indiquez votre nom de scène.' };
  if (phone.replace(/\D/g, '').length < 8) return { error: 'Indiquez votre numéro de téléphone (celui de votre compte Wave).' };
  if (!email.includes('@')) return { error: 'Adresse email invalide.' };
  if (password.length < 6) return { error: 'Mot de passe : 6 caractères minimum.' };
  try {
    const { data, error } = await db.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { nom: name.trim(), telephone: phone.trim() }, emailRedirectTo: APP_URL },
    });
    if (error) return { error: authMessage(error) };
    profile.name = name.trim();
    profile.phone = phone.trim();
    profile.email = email.trim();
    profile.save();
    if (!data.session) return { info: 'Compte créé. Ouvrez le lien reçu par email, puis connectez-vous.' };
    return {};
  } catch (e) {
    return { error: authMessage(e) };
  }
}

export async function login(email, password) {
  if (!email.includes('@')) return 'Adresse email invalide.';
  try {
    const { data, error } = await db.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return authMessage(error);
    profile.fromUser(data.user);
    return null;
  } catch (e) {
    return authMessage(e);
  }
}

/** Connexion Google : la page Google s'ouvre, puis revient sur la web-app. */
export async function loginWithGoogle() {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    const s = await r.json();
    if (!s?.external?.google) return 'La connexion Google n’est pas encore activée. Utilisez l’email pour le moment.';
    const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: APP_URL } });
    return error ? authMessage(error) : null;
  } catch (e) {
    return authMessage(e);
  }
}

export async function resetPassword(email) {
  if (!email.includes('@')) return 'Indiquez d’abord votre adresse email.';
  try {
    const { error } = await db.auth.resetPasswordForEmail(email.trim(), { redirectTo: APP_URL });
    if (error) return authMessage(error);
    return `Si un compte existe pour ${email.trim()}, un email de réinitialisation vient d’être envoyé.`;
  } catch (e) {
    return authMessage(e);
  }
}

export async function setNewPassword(password) {
  if (password.length < 6) return 'Mot de passe : 6 caractères minimum.';
  const { error } = await db.auth.updateUser({ password });
  return error ? authMessage(error) : null;
}

export async function savePhone(tel) {
  if (tel.replace(/\D/g, '').length < 8) return 'Numéro de téléphone invalide.';
  try {
    await rpc('definir_telephone', { p_telephone: tel.trim(), p_appareil: deviceId });
    profile.phone = tel.trim();
    profile.save();
    return null;
  } catch (e) {
    return e.message;
  }
}

export async function logout() {
  try {
    await timeout(db.auth.signOut(), 8000, '');
  } catch {
    /* hors-ligne : la session locale est quand même effacée */
  }
  LS.del('bt_acces');
  acces.reset();
}

// ------------------------------------------------------------------ essai et abonnement

const listeners = new Set();
export const onAccessChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

export const acces = {
  verified: false,
  proUntil: null,
  essaisUtilises: 0,
  essaisMax: 2,
  essaisOfferts: 0,
  prix: 2000,
  duree: 30,
  numeroWave: '+2250797361516',
  lienPaiement: '',
  message: '',
  messagePerso: '',
  moyens: [],
  bloque: false,
  motif: '',
  paiementEnAttente: false,
  telephoneConnu: null,
  syncing: false,
  lastSync: null,

  get subscribed() {
    return this.proUntil != null && this.proUntil > new Date();
  },
  get trialLeft() {
    return Math.max(0, this.essaisMax - this.essaisUtilises);
  },
  get canStart() {
    return !this.bloque && (this.subscribed || (this.verified && this.trialLeft > 0));
  },
  get daysLeft() {
    return this.subscribed ? Math.max(1, Math.ceil((this.proUntil - new Date()) / 86400000)) : null;
  },
  get paymentNames() {
    const names = ['Wave', ...this.moyens.map((m) => m.nom)];
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}`;
  },

  reset() {
    this.verified = false;
    this.proUntil = null;
    this.essaisUtilises = 0;
    this.paiementEnAttente = false;
    this.messagePerso = '';
    this.bloque = false;
    notify();
  },

  load() {
    const e = LS.json('bt_acces', null);
    if (e) this.apply(e, false);
  },

  apply(e, save = true) {
    const n = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
    this.verified = true;
    if ('telephone_connu' in e) this.telephoneConnu = e.telephone_connu === true;
    this.proUntil = e.pro_jusqu_au ? new Date(e.pro_jusqu_au) : null;
    this.essaisUtilises = n(e.essais_utilises, this.essaisUtilises);
    this.essaisMax = n(e.essais_max, this.essaisMax);
    this.essaisOfferts = n(e.essais_offerts, this.essaisOfferts);
    this.prix = n(e.prix_fcfa, this.prix);
    this.duree = n(e.duree_jours, this.duree);
    if (String(e.numero_wave ?? '').trim()) this.numeroWave = String(e.numero_wave).trim();
    this.lienPaiement = String(e.lien_paiement ?? '').trim();
    this.message = String(e.message ?? '').trim();
    if ('message_perso' in e) this.messagePerso = String(e.message_perso ?? '').trim();
    if (Array.isArray(e.moyens_paiement)) {
      this.moyens = e.moyens_paiement.filter((m) => m && String(m.id ?? '') && String(m.numero ?? '').trim());
    }
    if ('bloque' in e) {
      this.bloque = e.bloque === true;
      this.motif = String(e.motif_blocage ?? '').trim();
    }
    this.paiementEnAttente = e.paiement_en_attente === true;
    if (save) {
      LS.set('bt_acces', JSON.stringify({
        pro_jusqu_au: this.proUntil?.toISOString() ?? null,
        essais_utilises: this.essaisUtilises,
        essais_max: this.essaisMax,
        essais_offerts: this.essaisOfferts,
        prix_fcfa: this.prix,
        duree_jours: this.duree,
        numero_wave: this.numeroWave,
        lien_paiement: this.lienPaiement,
        message: this.message,
        message_perso: this.messagePerso,
        moyens_paiement: this.moyens,
        bloque: this.bloque,
        motif_blocage: this.motif,
        paiement_en_attente: this.paiementEnAttente,
        telephone_connu: this.telephoneConnu,
      }));
    }
    notify();
  },
};

/** Signale le téléphone et récupère l'état d'accès (sans effet hors-ligne). */
export async function syncAccess() {
  if (acces.syncing) return;
  acces.syncing = true;
  notify();
  try {
    let etat = null;
    try {
      etat = await rpc('signaler_appareil', {
        p_appareil: deviceId,
        p_modele: deviceModel(),
        p_android: osVersion() || null,
        p_version: `web ${VERSION}`,
      });
    } catch (e) {
      if (e.offline) return;
      etat = await rpc('etat_acces', { p_appareil: deviceId }).catch(() => null);
    }
    if (etat && typeof etat === 'object') {
      acces.lastSync = new Date();
      acces.apply(etat);
    }
  } finally {
    acces.syncing = false;
    notify();
  }
}

export async function refreshAccess() {
  try {
    const etat = await rpc('etat_acces', { p_appareil: deviceId });
    if (etat && typeof etat === 'object') {
      acces.lastSync = new Date();
      acces.apply(etat);
    }
  } catch {
    /* hors-ligne : on garde le dernier état connu */
  }
}

// --- alertes instantanées du serveur (canal Realtime « bandtalk », événement « maj »)

async function cible(id) {
  const data = new TextEncoder().encode('bandtalk-cible:' + id);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(hash, (x) => x.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

let channel = null;
let pushTimer = null;
let lastPush = 0;

export async function listenServer() {
  if (channel) return;
  const user = await currentUser();
  const moi = new Set([await cible(deviceId), ...(user ? [await cible(user.id)] : [])]);
  const schedule = (delay) => {
    if (pushTimer) return;
    const wait = Date.now() - lastPush < 5000 ? 5000 : delay;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      lastPush = Date.now();
      refreshAccess();
    }, wait);
  };
  try {
    channel = db
      .channel('bandtalk')
      .on('broadcast', { event: 'maj' }, (msg) => {
        const inner = msg?.payload && typeof msg.payload === 'object' ? msg.payload : msg;
        const c = String(inner?.cible ?? 'tous');
        if (c === 'tous') schedule(Math.random() * 15000);
        else if (moi.has(c)) schedule(0);
      })
      .subscribe();
  } catch {
    channel = null; // pas de temps réel : la vérification toutes les 5 minutes suffit
  }
}

// --- fréquence d'utilisation (statistiques de l'administrateur)

let usageId = null;
let usageTimer = null;

function uuidV4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function trackUsage(keepAlive) {
  const beat = () => {
    if (!usageId) return;
    rpc('signaler_utilisation', { p_id: usageId, p_appareil: deviceId, p_version: `web ${VERSION}` }).catch(() => {});
  };
  const begin = () => {
    if (usageId) return;
    usageId = uuidV4();
    beat();
    usageTimer = setInterval(beat, 60000);
  };
  const end = () => {
    beat();
    clearInterval(usageTimer);
    usageTimer = null;
    usageId = null;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') begin();
    else if (!keepAlive()) end();
  });
  begin();
}

// ------------------------------------------------------------------ paiement

/** Paiement Wave automatique : renvoie le lien qui ouvre Wave (montant déjà rempli). */
export async function startWavePayment() {
  try {
    const data = await invoke('wave-paiement', { action: 'creer', appareil: deviceId });
    const lien = data?.lien;
    if (typeof lien !== 'string' || !lien.startsWith('https://')) return { error: 'Réponse inattendue du serveur de paiement.' };
    LS.set('bt_paiement_lance', String(Date.now()));
    return { lien };
  } catch (e) {
    if (e.code === 'absente' || e.code === 'non_configure') return { unavailable: true };
    return { error: e.message };
  }
}

/** Vérifie le paiement auprès de Wave, puis relit l'état. Vrai si l'abonnement est actif. */
export async function confirmWavePayment() {
  try {
    await invoke('wave-paiement', { action: 'verifier' });
  } catch {
    /* la notification de Wave fera le travail ; on relit simplement l'état */
  }
  await syncAccess();
  if (acces.subscribed) LS.del('bt_paiement_lance');
  return acces.subscribed;
}

/** Déclare un paiement par transfert. Renvoie null si c'est enregistré, sinon le message d'erreur. */
export async function declarePayment({ reference, phone, method = 'wave' }) {
  try {
    const r = await rpc('declarer_paiement', {
      p_reference: reference,
      p_telephone: phone,
      p_appareil: deviceId,
      ...(method !== 'wave' ? { p_moyen: method } : {}),
    });
    if (r && typeof r === 'object') acces.apply(r);
    return null;
  } catch (e) {
    return e.message;
  }
}

// ------------------------------------------------------------------ jeton Agora (session 4G)

/** Demande au serveur le jeton Agora d'une session. Compte la session pour l'essai. */
export async function agoraToken({ pin, session, role }) {
  try {
    const data = await invoke('agora-jeton', { pin, appareil: deviceId, session, role });
    if (!data?.jeton || !data?.app_id) throw new BackendError('Réponse inattendue du serveur.');
    return { appId: data.app_id, token: data.jeton, expire: data.expire ?? 86400 };
  } catch (e) {
    if (e.code === 'absente' || e.code === 'non_configure') {
      throw new BackendError('Le mode iPhone n’est pas encore activé sur le serveur BandTalk. Prévenez l’administrateur.', {
        code: 'non_configure',
      });
    }
    if (e.code === 'essai_termine') refreshAccess();
    throw e;
  }
}
