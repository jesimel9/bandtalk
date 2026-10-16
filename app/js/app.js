// BandTalk pour iPhone — interface (écrans, onglets, écran Live).
import { VERSION, ROLES, SECTIONS, CUES, cueById, roleLabel, WHATSAPP, SITE_URL } from './config.js';
import {
  db, LS, APP_URL, profile, acces, onAccessChange, syncAccess, refreshAccess, listenServer, trackUsage,
  register, login, loginWithGoogle, resetPassword, setNewPassword, savePhone, logout,
  startWavePayment, confirmWavePayment, declarePayment,
} from './backend.js';
import { settings } from './reglages.js';
import { Session, loadAgora } from './session.js';
import { unlockAudio } from './audio.js';

// ------------------------------------------------------------------ outils

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const formatPin = (pin) => (pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin);
const fcfa = (n) => Number(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
const dateFr = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

const session = new Session();
let user = null;
let recovering = false;
let current = 's-boot';
let tab = 'accueil';
let pendingCode = '';
let started = false;

// ------------------------------------------------------------------ écrans

const SCREENS = ['s-boot', 's-install', 's-auth', 's-newpass', 's-main', 's-live', 's-blocked'];

function show(id) {
  for (const s of SCREENS) $('#' + s).hidden = s !== id;
  current = id;
}

const installNeeded = () => isIOS && !isStandalone && LS.get('bt_install_vu') !== '1';

function route() {
  if (recovering) return show('s-newpass');
  if (!user) return show(installNeeded() ? 's-install' : 's-auth');
  if (acces.bloque) {
    $('#blocked-text').textContent = acces.motif || 'L’administrateur de BandTalk a désactivé l’appli pour ce compte.';
    $('#blocked-whatsapp').href = `https://wa.me/${WHATSAPP}`;
    if (session.inSession) session.leave('Compte suspendu.');
    return show('s-blocked');
  }
  if (session.inSession) {
    show('s-live');
    renderLive();
    return;
  }
  show('s-main');
  renderTab();
}

let toastTimer = null;
function toast(message, ms = 4000) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function busy(text) {
  $('#busy').hidden = !text;
  if (text) $('#busy-text').textContent = text;
}

// ------------------------------------------------------------------ feuille du bas

let sheetCleanup = null;

function openSheet(html, mount) {
  closeSheet();
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
  $('#sheet').scrollTop = 0;
  mount?.($('#sheet-body'));
}

function closeSheet() {
  sheetCleanup?.();
  sheetCleanup = null;
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  $('#sheet-body').innerHTML = '';
}

// ------------------------------------------------------------------ installation

function installGuideHtml() {
  return `
    <h2>Installer BandTalk</h2>
    <p class="lead">Sur l’écran d’accueil, BandTalk s’ouvre en plein écran comme une vraie appli.</p>
    <ol class="steps">
      <li><span class="step-n">1</span><div>Ouvrez <b>${esc(APP_URL)}</b> dans <b>Safari</b>.</div></li>
      <li><span class="step-n">2</span><div>Touchez <b>Partager</b> <span class="ico-share"></span> puis <b>Sur l’écran d’accueil</b> <span class="ico-plus">+</span>.</div></li>
      <li><span class="step-n">3</span><div>Touchez <b>Ajouter</b>. Ouvrez ensuite BandTalk depuis son icône.</div></li>
    </ol>
    <p class="soft" style="font-size:14px">L’appli installée garde son propre compte : connectez-vous une fois après l’installation.</p>
    <button class="btn btn-ghost" type="button" data-close>Fermer</button>`;
}

// ------------------------------------------------------------------ connexion

let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  for (const b of $$('#auth-seg button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
  $('.signup-only').hidden = mode !== 'signup';
  $('#auth-submit').textContent = mode === 'signup' ? 'Créer mon compte' : 'Continuer';
  $('#auth-forgot').hidden = mode !== 'login';
  $('#auth-form [name=password]').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  authMsg('');
}

function authMsg(text, info = false) {
  const m = $('#auth-msg');
  m.textContent = text;
  m.classList.toggle('info', info);
}

function wireAuth() {
  for (const b of $$('#auth-seg button')) b.onclick = () => setAuthMode(b.dataset.mode);
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = String(f.get('email') ?? '');
    const password = String(f.get('password') ?? '');
    busy(authMode === 'signup' ? 'Création du compte…' : 'Connexion…');
    if (authMode === 'signup') {
      const r = await register({ name: String(f.get('name') ?? ''), phone: String(f.get('phone') ?? ''), email, password });
      busy(false);
      if (r.error) return authMsg(r.error);
      if (r.info) {
        setAuthMode('login');
        return authMsg(r.info, true);
      }
    } else {
      const err = await login(email, password);
      busy(false);
      if (err) return authMsg(err);
    }
  };
  $('#auth-google').onclick = async () => {
    authMsg('');
    const err = await loginWithGoogle();
    if (err) authMsg(err);
  };
  $('#auth-forgot').onclick = async () => {
    const email = String($('#auth-form [name=email]').value ?? '');
    const r = await resetPassword(email);
    authMsg(r, r.startsWith('Si un compte'));
  };
  $('#newpass-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = await setNewPassword(String(new FormData(e.target).get('password') ?? ''));
    if (err) {
      $('#newpass-msg').textContent = err;
      return;
    }
    recovering = false;
    toast('Mot de passe enregistré.');
    route();
  };
  $('#install-continue').onclick = () => {
    LS.set('bt_install_vu', '1');
    route();
  };
}

/** Compte ouvert : état d'accès, alertes du serveur, statistiques (une seule fois). */
function afterLogin() {
  route();
  syncAccess();
  if (started) return;
  started = true;
  listenServer();
  trackUsage(() => session.inSession);
  setInterval(refreshAccess, 5 * 60 * 1000);
  if (pendingCode) {
    const code = pendingCode;
    pendingCode = '';
    setTimeout(() => openJoin(code), 400);
  }
}

// ------------------------------------------------------------------ onglets

function setTab(t) {
  tab = t;
  for (const b of $$('.tabbar button')) {
    if (b.dataset.tab === t) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const p of ['accueil', 'compte', 'reglages']) $('#tab-' + p).hidden = p !== t;
  renderTab();
  $('#tab-' + t).scrollTop = 0;
}

function renderTab() {
  if (current !== 's-main') return;
  if (tab === 'accueil') renderHome();
  else if (tab === 'compte') renderAccount();
  else renderSettings();
}

function accessSummary() {
  if (!acces.verified) {
    return { title: 'Vérification du compte…', sub: 'Il faut Internet pour activer l’essai gratuit.', badge: '', cta: false };
  }
  if (acces.subscribed) {
    return {
      title: 'BandTalk PRO',
      sub: `Encore ${acces.daysLeft} jour${acces.daysLeft > 1 ? 's' : ''}, jusqu’au ${dateFr(acces.proUntil)}.`,
      badge: '<span class="badge green">PRO</span>',
      cta: false,
    };
  }
  if (acces.trialLeft > 0) {
    return {
      title: 'Essai gratuit',
      sub: `${acces.trialLeft} session${acces.trialLeft > 1 ? 's' : ''} gratuite${acces.trialLeft > 1 ? 's' : ''} restante${acces.trialLeft > 1 ? 's' : ''}.`,
      badge: '<span class="badge blue">ESSAI</span>',
      cta: true,
    };
  }
  return {
    title: 'Essai terminé',
    sub: `Abonnez-vous : ${fcfa(acces.prix)} FCFA pour ${acces.duree} jours.`,
    badge: '<span class="badge amber">À RENOUVELER</span>',
    cta: true,
  };
}

function renderHome() {
  const s = accessSummary();
  const messages = [acces.messagePerso, acces.message].filter(Boolean);
  $('#tab-accueil').innerHTML = `
    <div class="hello">
      <div class="avatar">${esc(initial(profile.name))}</div>
      <div><p class="soft" style="margin:0">Bonjour</p><h1>${esc(profile.name || 'Musicien')}</h1></div>
    </div>
    <div class="card status-card">
      <div class="grow">
        <div>${s.badge} <strong>${esc(s.title)}</strong></div>
        <div class="soft" style="font-size:15px">${esc(s.sub)}</div>
        ${acces.paiementEnAttente ? '<div class="soft" style="font-size:14px;margin-top:4px">Paiement en cours de vérification.</div>' : ''}
      </div>
      ${s.cta ? '<button class="pill" type="button" id="home-sub">S’abonner</button>' : ''}
    </div>
    ${messages.map((m) => `<div class="card message"><p style="margin:0">${esc(m)}</p></div>`).join('')}
    ${acces.telephoneConnu === false ? `
      <div class="card"><strong>Ajoutez votre numéro Wave</strong>
        <p class="soft" style="font-size:15px">Il sert à reconnaître vos paiements.</p>
        <button class="btn btn-ghost" type="button" id="home-phone">Ajouter mon numéro</button></div>` : ''}
    <div class="tiles">
      <button class="tile green" type="button" id="home-create">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
        <div><strong>Créer une session</strong><span>Pour le chef</span></div>
      </button>
      <button class="tile blue" type="button" id="home-join">
        <svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
        <div><strong>Rejoindre</strong><span>Avec le code</span></div>
      </button>
    </div>
    <div class="card">
      <h2>Sur iPhone : mode Internet</h2>
      <p class="soft" style="font-size:15px">Chaque téléphone a besoin d’Internet : 4G, 5G ou un Wi-Fi connecté. Les musiciens sur Android peuvent rejoindre votre session, et vous la leur.</p>
      <p class="soft" style="font-size:15px;margin:0">Le mode Wi-Fi local sans Internet est réservé à l’appli Android.</p>
    </div>
    ${isIOS && !isStandalone ? `
      <div class="card"><strong>Installez BandTalk sur l’écran d’accueil</strong>
        <p class="soft" style="font-size:15px">Plein écran, ouverture plus rapide, comme une vraie appli.</p>
        <button class="btn btn-ghost" type="button" id="home-install">Comment faire ?</button></div>` : ''}`;
  $('#home-create').onclick = openCreate;
  $('#home-join').onclick = () => openJoin();
  $('#home-sub')?.addEventListener('click', () => openSubscription());
  $('#home-phone')?.addEventListener('click', openPhone);
  $('#home-install')?.addEventListener('click', () => openSheet(installGuideHtml()));
}

function renderAccount() {
  const s = accessSummary();
  $('#tab-compte').innerHTML = `
    <h1>Compte</h1>
    <div class="list">
      <div class="row"><div class="grow"><div class="label">Nom de scène</div></div><div class="soft">${esc(profile.name)}</div></div>
      <div class="row"><div class="grow"><div class="label">E-mail</div></div><div class="soft" style="overflow:hidden;text-overflow:ellipsis">${esc(profile.email || user?.email || '')}</div></div>
      <div class="row"><div class="grow"><div class="label">Numéro Wave</div><div class="sub">${esc(profile.phone || 'Non renseigné')}</div></div><button class="pill" type="button" id="acc-phone">Modifier</button></div>
    </div>
    <div class="list-title">Abonnement</div>
    <div class="card">
      <div>${s.badge} <strong>${esc(s.title)}</strong></div>
      <p class="soft" style="font-size:15px">${esc(s.sub)}</p>
      ${acces.paiementEnAttente ? '<p class="soft" style="font-size:14px">Paiement en cours de vérification.</p>' : ''}
      <button class="btn btn-primary" type="button" id="acc-sub">${acces.subscribed ? 'Prolonger mon abonnement' : 'S’abonner'}</button>
      <button class="btn btn-ghost" type="button" id="acc-refresh">Actualiser</button>
    </div>
    <div class="list-title">Aide</div>
    <div class="list">
      <a class="row" style="text-decoration:none;color:inherit" href="https://wa.me/${WHATSAPP}" target="_blank" rel="noopener"><div class="grow"><div class="label">Écrire à BandTalk sur WhatsApp</div></div><span class="soft">›</span></a>
      <a class="row" style="text-decoration:none;color:inherit" href="${SITE_URL}" target="_blank" rel="noopener"><div class="grow"><div class="label">Site et tutoriel</div></div><span class="soft">›</span></a>
    </div>
    <button class="btn btn-danger" type="button" id="acc-logout">Se déconnecter</button>`;
  $('#acc-phone').onclick = openPhone;
  $('#acc-sub').onclick = () => openSubscription();
  $('#acc-refresh').onclick = async () => {
    await syncAccess();
    toast(acces.lastSync ? 'État du compte à jour.' : 'Pas de connexion Internet.');
  };
  $('#acc-logout').onclick = async () => {
    busy('Déconnexion…');
    await logout();
    busy(false);
    user = null;
    route();
  };
}

function switchRow(id, label, sub, checked) {
  return `<label class="row"><div class="grow"><div class="label">${label}</div><div class="sub">${sub}</div></div>
    <span class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><i></i></span></label>`;
}

function renderSettings() {
  const pane = $('#tab-reglages');
  pane.innerHTML = `
    <h1>Réglages</h1>
    <div class="list-title">Mon profil</div>
    <div class="list">
      <label class="row"><div class="grow"><div class="label">Nom de scène</div></div><input type="text" id="set-name" maxlength="40" value="${esc(profile.name)}"></label>
      <label class="row"><div class="grow"><div class="label">Rôle</div></div>
        <select id="set-role">${ROLES.map((r) => `<option value="${r.id}" ${r.id === profile.role ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>
      <label class="row"><div class="grow"><div class="label">Section</div></div>
        <select id="set-section">${SECTIONS.map((s) => `<option ${s === profile.section ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    </div>
    <div class="list-title">Son</div>
    <div class="list">
      ${switchRow('set-noise', 'Anti-bruit', 'Atténue le bruit de la salle', settings.noise)}
      ${switchRow('set-studio', 'Voix haute qualité', 'Plus de débit : pour une 4G solide', settings.studio)}
      ${switchRow('set-count', 'Décompte vocal', '« One, two, three, four » avant un signal', settings.countVoice)}
      ${switchRow('set-larsen', 'Anti-larsen', 'Coupe les autres quand vous parlez sur haut-parleur', settings.antiLarsen)}
    </div>
    <div class="card">
      <label class="slider-line"><span>Volume d’écoute <b id="v-listen"></b></span><input type="range" id="set-listen" min="0" max="2" step="0.05" value="${settings.listen}"></label>
      <label class="slider-line"><span>Les autres quand le chef parle <b id="v-duck"></b></span><input type="range" id="set-duck" min="0" max="1" step="0.05" value="${settings.duck}"></label>
      <label class="slider-line"><span>Mains libres : seuil du micro <b id="v-vox"></b></span><input type="range" id="set-vox" min="-50" max="-10" step="1" value="${settings.voxDb}"></label>
    </div>
    <div class="list-title">Affichage</div>
    <div class="list">
      <label class="row"><div class="grow"><div class="label">Thème</div></div>
        <select id="set-theme">
          <option value="auto" ${settings.theme === 'auto' ? 'selected' : ''}>Automatique</option>
          <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Clair</option>
          <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Sombre</option>
        </select></label>
    </div>
    <div class="list-title">iPhone</div>
    <div class="list">
      <button class="row" type="button" id="set-install" style="width:100%;border:0;background:none;text-align:left"><div class="grow"><div class="label">Installer sur l’écran d’accueil</div><div class="sub">${isStandalone ? 'BandTalk est installé.' : 'Plein écran, comme une vraie appli'}</div></div><span class="soft">›</span></button>
      <div class="row"><div class="grow"><div class="label">Pendant le concert</div><div class="sub">Gardez BandTalk à l’écran. iOS coupe le micro si l’iPhone se verrouille ou si vous changez d’appli. Des écouteurs filaires donnent le meilleur son.</div></div></div>
    </div>
    <p class="soft center-text" style="font-size:13px;margin-top:18px">BandTalk pour iPhone · version ${VERSION}<br>Une appli de Jesimel, faite en Côte d’Ivoire</p>`;

  const labels = () => {
    $('#v-listen').textContent = `${Math.round(settings.listen * 100)} %`;
    $('#v-duck').textContent = `${Math.round(settings.duck * 100)} %`;
    $('#v-vox').textContent = `${settings.voxDb} dB`;
  };
  labels();
  const save = () => {
    settings.save();
    labels();
  };
  $('#set-name').onchange = (e) => {
    profile.name = e.target.value.trim() || profile.name;
    profile.save();
    session.pushProfile();
  };
  $('#set-role').onchange = (e) => {
    profile.role = e.target.value;
    profile.save();
    session.pushProfile();
  };
  $('#set-section').onchange = (e) => {
    profile.section = e.target.value;
    profile.save();
    session.pushProfile();
  };
  $('#set-noise').onchange = (e) => ((settings.noise = e.target.checked), save());
  $('#set-studio').onchange = (e) => ((settings.studio = e.target.checked), save());
  $('#set-count').onchange = (e) => ((settings.countVoice = e.target.checked), save());
  $('#set-larsen').onchange = (e) => ((settings.antiLarsen = e.target.checked), save());
  $('#set-listen').oninput = (e) => ((settings.listen = Number(e.target.value)), save());
  $('#set-duck').oninput = (e) => ((settings.duck = Number(e.target.value)), save());
  $('#set-vox').oninput = (e) => ((settings.voxDb = Number(e.target.value)), save());
  $('#set-theme').onchange = (e) => {
    settings.theme = e.target.value;
    save();
    applyTheme();
  };
  $('#set-install').onclick = () => openSheet(installGuideHtml());
}

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') root.setAttribute('data-theme', settings.theme);
  else root.removeAttribute('data-theme');
}

// ------------------------------------------------------------------ numéro Wave

function openPhone() {
  openSheet(`
    <h2>Numéro Wave</h2>
    <p class="lead">Le numéro de votre compte Wave : il sert à reconnaître vos paiements.</p>
    <label class="field"><span>Numéro</span><input id="phone-input" type="tel" inputmode="tel" value="${esc(profile.phone)}" placeholder="+225 07 00 00 00 00"></label>
    <p class="form-msg" id="phone-msg"></p>
    <button class="btn btn-primary" type="button" id="phone-save">Enregistrer</button>
    <button class="btn btn-ghost" type="button" data-close>Annuler</button>`, (root) => {
    $('#phone-save', root).onclick = async () => {
      busy('Enregistrement…');
      const err = await savePhone($('#phone-input', root).value);
      busy(false);
      if (err) {
        $('#phone-msg', root).textContent = err;
        return;
      }
      closeSheet();
      toast('Numéro enregistré.');
      syncAccess();
      renderTab();
    };
  });
}

// ------------------------------------------------------------------ abonnement

function openSubscription(reason = '') {
  const moyens = acces.moyens;
  openSheet(`
    <h2>BandTalk PRO</h2>
    ${reason ? `<p class="lead">${esc(reason)}</p>` : ''}
    <div class="price">${fcfa(acces.prix)} FCFA <small>/ ${acces.duree} jours</small></div>
    <p class="lead">Sessions Live illimitées, jusqu’à 8 musiciens, sur iPhone comme sur Android.</p>
    ${acces.subscribed ? `<p class="lead">Abonnement actif jusqu’au ${dateFr(acces.proUntil)}. Un paiement ajoute ${acces.duree} jours.</p>` : ''}
    ${acces.paiementEnAttente ? '<p class="note">Un paiement est en cours de vérification.</p>' : ''}
    <div id="pay-auto">
      <button class="btn btn-primary" type="button" id="pay-wave">Payer avec Wave</button>
    </div>
    <div class="or"><span>ou par transfert</span></div>
    <div class="card">
      <p style="font-size:15px">Envoyez <b>${fcfa(acces.prix)} FCFA</b> par <b>Wave</b> au <b>${esc(acces.numeroWave)}</b>.</p>
      ${moyens.map((m) => `<p style="font-size:15px">Ou par <b>${esc(m.nom)}</b> au <b>${esc(m.numero)}</b>${m.instructions ? `<br><span class="soft">${esc(m.instructions)}</span>` : ''}</p>`).join('')}
      <p class="soft" style="font-size:14px">Puis indiquez la référence du transfert : l’abonnement est activé après vérification.</p>
      ${moyens.length ? `<label class="field"><span>Moyen de paiement</span><select id="pay-method"><option value="wave">Wave</option>${moyens.map((m) => `<option value="${esc(m.id)}">${esc(m.nom)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Référence / identifiant de la transaction</span><input id="pay-ref" autocapitalize="characters" autocomplete="off"></label>
      <label class="field"><span>Numéro qui a payé</span><input id="pay-phone" type="tel" inputmode="tel" value="${esc(profile.phone)}"></label>
      <p class="form-msg" id="pay-msg"></p>
      <button class="btn btn-blue" type="button" id="pay-declare">Envoyer pour vérification</button>
    </div>
    <button class="btn btn-ghost" type="button" data-close>Fermer</button>`, (root) => {
    $('#pay-wave', root).onclick = async () => {
      busy('Préparation du paiement…');
      const r = await startWavePayment();
      busy(false);
      const box = $('#pay-auto', root);
      if (r.lien) {
        box.innerHTML = `
          <a class="btn btn-primary" href="${esc(r.lien)}" target="_blank" rel="noopener" id="pay-open">Ouvrir Wave (${fcfa(acces.prix)} FCFA)</a>
          <button class="btn btn-ghost" type="button" id="pay-check">J’ai payé : vérifier</button>`;
        $('#pay-check', root).onclick = checkPayment;
      } else if (r.unavailable) {
        box.innerHTML = '<p class="note">Le paiement automatique n’est pas disponible pour le moment : payez par transfert ci-dessous.</p>';
      } else {
        toast(r.error ?? 'Paiement impossible pour le moment.');
      }
    };
    $('#pay-declare', root).onclick = async () => {
      const msg = $('#pay-msg', root);
      busy('Envoi…');
      const err = await declarePayment({
        reference: $('#pay-ref', root).value,
        phone: $('#pay-phone', root).value,
        method: $('#pay-method', root)?.value ?? 'wave',
      });
      busy(false);
      if (err) {
        msg.classList.remove('info');
        msg.textContent = err;
        return;
      }
      closeSheet();
      toast(acces.subscribed ? 'Abonnement activé !' : 'Paiement envoyé : il sera vérifié rapidement.', 6000);
      renderTab();
    };
  });
}

async function checkPayment() {
  busy('Vérification du paiement…');
  const ok = await confirmWavePayment();
  busy(false);
  if (ok) {
    closeSheet();
    toast('Abonnement activé ! Merci.', 6000);
  } else {
    toast('Paiement pas encore reçu. Réessayez dans un instant.');
  }
  renderTab();
}

// ------------------------------------------------------------------ créer / rejoindre

function blockedByTrial() {
  if (acces.verified && !acces.canStart) {
    openSubscription('Vos sessions d’essai sont terminées : abonnez-vous pour créer ou rejoindre une session.');
    return true;
  }
  return false;
}

function trialNote() {
  if (acces.subscribed || !acces.verified) return '';
  return `Cette session utilise 1 de vos ${acces.trialLeft} session${acces.trialLeft > 1 ? 's' : ''} d’essai.`;
}

function openCreate() {
  if (blockedByTrial()) return;
  loadAgora().catch(() => {}); // préchargé pendant la saisie
  openSheet(`
    <h2>Créer une session</h2>
    <p class="lead">Mode Internet : 4G, 5G ou Wi-Fi connecté</p>
    <label class="field"><span>Nom de la session</span><input id="create-name" maxlength="40" value="${esc(LS.get('bt_dernier_nom', 'Répétition'))}"></label>
    ${trialNote() ? `<p class="soft" style="font-size:14px">${trialNote()}</p>` : ''}
    <button class="btn btn-primary" type="button" id="create-go">Lancer la session</button>
    <button class="btn btn-ghost" type="button" data-close>Annuler</button>`, (root) => {
    $('#create-go', root).onclick = () => {
      const name = $('#create-name', root).value.trim() || 'Session BandTalk';
      LS.set('bt_dernier_nom', name);
      closeSheet();
      startSession(() => session.host(name));
    };
  });
}

function openJoin(prefill = '') {
  if (blockedByTrial()) return;
  loadAgora().catch(() => {});
  openSheet(`
    <h2>Rejoindre une session</h2>
    <p class="lead">Tapez le code à 6 chiffres du chef, ou scannez son QR code.</p>
    <input class="code-input" id="join-code" inputmode="numeric" pattern="[0-9]*" maxlength="7" autocomplete="one-time-code" placeholder="000000" value="${esc(prefill)}" aria-label="Code de la session">
    <p class="form-msg" id="join-msg"></p>
    ${trialNote() ? `<p class="soft center-text" style="font-size:14px">${trialNote()}</p>` : ''}
    <button class="btn btn-primary" type="button" id="join-go">Entrer</button>
    <button class="btn btn-ghost" type="button" id="join-scan">Scanner le QR code</button>`, (root) => {
    const input = $('#join-code', root);
    if (!prefill) setTimeout(() => input.focus(), 250);
    const go = () => {
      const code = input.value.replace(/\D/g, '');
      if (code.length !== 6) {
        $('#join-msg', root).textContent = 'Le code a 6 chiffres.';
        return;
      }
      closeSheet();
      startSession(() => session.join(code));
    };
    $('#join-go', root).onclick = go;
    input.onkeydown = (e) => e.key === 'Enter' && go();
    $('#join-scan', root).onclick = openScanner;
  });
}

/** Invitation : « 123456 », « bandtalk://join?mode=internet&pin=… » ou lien de la web-app. */
function parseInvite(raw) {
  const text = String(raw ?? '').trim();
  if (/^\d{6}$/.test(text)) return { pin: text, internet: true };
  try {
    const url = new URL(text);
    if (url.protocol === 'bandtalk:') {
      const pin = url.searchParams.get('pin') ?? '';
      if (!/^\d{6}$/.test(pin)) return null;
      return { pin, internet: url.searchParams.get('mode') === 'internet' };
    }
    const code = (url.searchParams.get('code') ?? '').replace(/\D/g, '');
    if (/^\d{6}$/.test(code)) return { pin: code, internet: true };
  } catch {
    /* pas une adresse */
  }
  return null;
}

let jsqrLoading = null;
function loadJsQR() {
  jsqrLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/jsqr-1.4.0.js';
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => {
      jsqrLoading = null;
      reject(new Error('Lecteur de QR code indisponible.'));
    };
    document.head.appendChild(s);
  });
  return jsqrLoading;
}

async function openScanner() {
  openSheet(`
    <h2>Scanner le QR code</h2>
    <p class="lead">Visez le QR code affiché par le chef (« Inviter »).</p>
    <div class="scanner"><video playsinline muted autoplay></video></div>
    <p class="form-msg" id="scan-msg"></p>
    <button class="btn btn-ghost" type="button" id="scan-code">Taper le code</button>`);
  const root = $('#sheet-body');
  $('#scan-code', root).onclick = () => openJoin();
  const video = $('video', root);
  const msg = $('#scan-msg', root);
  let stream = null;
  let raf = 0;
  let stopped = false;
  sheetCleanup = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
  };
  try {
    const [jsQR, s] = await Promise.all([
      loadJsQR(),
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
    ]);
    stream = s;
    if (stopped) return sheetCleanup();
    video.srcObject = stream;
    await video.play().catch(() => {});
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    let last = 0;
    const scan = (t) => {
      if (stopped) return;
      raf = requestAnimationFrame(scan);
      if (t - last < 150 || !video.videoWidth) return;
      last = t;
      const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (!found) return;
      const invite = parseInvite(found.data);
      if (!invite) {
        msg.textContent = 'Ce QR code n’est pas une invitation BandTalk.';
        return;
      }
      if (!invite.internet) {
        msg.textContent = 'Cette invitation est pour le Wi-Fi local (Android seulement). Demandez au chef de créer une session 4G / 5G.';
        return;
      }
      openJoin(invite.pin); // l'utilisateur confirme en touchant « Entrer »
    };
    raf = requestAnimationFrame(scan);
  } catch (e) {
    msg.textContent = /denied|not allowed|permission/i.test(String(e?.name) + String(e?.message))
      ? 'BandTalk n’a pas accès à l’appareil photo. Tapez plutôt le code.'
      : 'Appareil photo indisponible. Tapez plutôt le code.';
  }
}

async function startSession(run) {
  unlockAudio(); // pendant le toucher : iOS autorise alors le son
  busy('Connexion à la session…');
  const err = await run();
  busy(false);
  if (err) {
    toast(err, 7000);
    if (/essai/i.test(err)) openSubscription(err);
    return;
  }
  enterLive();
  refreshAccess();
}

// ------------------------------------------------------------------ écran Live

let wakeLock = null;

async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => (wakeLock = null));
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function enterLive() {
  show('s-live');
  requestWakeLock();
  if (!('wakeLock' in navigator)) {
    $('#live-tip').textContent =
      'Gardez BandTalk à l’écran : si l’iPhone se verrouille, iOS coupe le micro. Astuce : Réglages › Luminosité et affichage › Verrouillage auto › Jamais.';
  }
  renderLive();
}

function buildLive() {
  // Signaux
  $('#live-cues').innerHTML = CUES.map(
    (c) => `<button class="cue ${c.tone ?? ''}" type="button" data-cue="${c.id}"><i>${c.icon}</i>${esc(c.label)}</button>`,
  ).join('');
  let cueScope = 'all';
  for (const b of $$('#cue-scope button')) {
    b.onclick = () => {
      cueScope = b.dataset.scope;
      for (const x of $$('#cue-scope button')) x.setAttribute('aria-selected', String(x === b));
    };
  }
  for (const b of $$('#live-cues .cue')) {
    b.onclick = () => {
      unlockAudio();
      session.sendCue(b.dataset.cue, cueScope === 'group');
    };
  }
  $('#live-countin').onclick = () => {
    unlockAudio();
    session.sendCountIn();
  };

  // Métronome
  $('#metro-minus').onclick = () => session.setBpm(session.bpm - 1);
  $('#metro-plus').onclick = () => session.setBpm(session.bpm + 1);
  $('#metro-slider').oninput = (e) => session.setBpm(Number(e.target.value));
  $('#metro-tap').onclick = () => session.tapTempo();
  $('#metro-toggle').onclick = () => session.toggleMetro();
  $('#metro-volume').oninput = (e) => session.setMetroVolume(Number(e.target.value));

  // Parler : appui maintenu
  const ptt = $('#ptt');
  ptt.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    if (session.handsFree) return;
    try {
      ptt.setPointerCapture(e.pointerId);
    } catch {
      /* rien */
    }
    session.setPtt(true);
    renderDock();
  });
  const release = () => {
    if (!session.pttDown) return;
    session.setPtt(false);
    renderDock();
  };
  ptt.addEventListener('pointerup', release);
  ptt.addEventListener('pointercancel', release);
  ptt.addEventListener('lostpointercapture', release);
  ptt.addEventListener('contextmenu', (e) => e.preventDefault());

  $('#dock-handsfree').onclick = () => {
    const warn = session.setHandsFree(!session.handsFree);
    if (warn) toast(warn);
    renderDock();
  };
  $('#dock-mute').onclick = () => {
    session.toggleMute();
    renderDock();
  };
  $('#dock-speaker').onclick = () => {
    session.toggleSpeaker();
    renderDock();
  };

  $('#live-invite').onclick = openInvite;
  $('#live-leave').onclick = () =>
    openSheet(`
      <h2>Quitter la session ?</h2>
      <p class="lead">${session.isHost ? 'Vous êtes l’hôte : la session sera fermée pour tout le monde.' : 'Vous pourrez la rejoindre à nouveau avec le code.'}</p>
      <button class="btn btn-danger" type="button" id="leave-yes">Quitter</button>
      <button class="btn btn-ghost" type="button" data-close>Rester</button>`, (root) => {
      $('#leave-yes', root).onclick = async () => {
        closeSheet();
        busy('Fermeture…');
        await session.leave();
        busy(false);
      };
    });

  $('#cue-overlay').onclick = () => session.dismissOverlay();
  $('#autoplay').onclick = () => {
    unlockAudio();
    session.resume();
    $('#autoplay').hidden = true;
  };
}

function renderLive() {
  if (current !== 's-live') return;
  $('#live-name').textContent = session.sessionName || 'Session';
  const dot = $('#live-status .dot');
  dot.className = 'dot' + (session.link === 'online' ? ' online' : session.link === 'reconnecting' ? ' off' : '');
  const n = session.count;
  const lat = session.diag.latencyMs ? ` · ${session.diag.latencyMs} ms` : '';
  $('#live-status-text').textContent =
    session.link === 'connecting' ? 'Connexion…'
      : session.link === 'reconnecting' ? 'Reconnexion…'
        : `Internet · ${n} musicien${n > 1 ? 's' : ''}${lat}`;
  $('#live-count').textContent = String(session.peers.size + 1);

  // « Parler à »
  const groups = session.sectionsInSession;
  const want = [['', 'Tout le monde'], ...groups.map((g) => [g, g])];
  const chips = $('#live-groups');
  const sig = want.map((w) => w[0]).join('|') + '#' + (session.talkGroup ?? '');
  if (chips.dataset.sig !== sig) {
    chips.dataset.sig = sig;
    chips.innerHTML = want
      .map(([v, l]) => `<button class="chip" type="button" data-group="${esc(v)}" aria-pressed="${(session.talkGroup ?? '') === v}">${esc(l)}</button>`)
      .join('');
    for (const b of $$('.chip', chips)) b.onclick = () => session.setTalkGroup(b.dataset.group || null);
  }

  renderPeers();
  $('#live-empty').hidden = session.peers.size > 0;
  renderMetro();
  renderDock();
  renderOverlay();
}

function renderPeers() {
  const box = $('#live-peers');
  const peers = [...session.peers.values()].sort((a, b) => b.isHost - a.isHost || a.joinedAt - b.joinedAt);
  const ids = new Set(peers.map((p) => p.id));
  for (const el of [...box.children]) if (!ids.has(el.dataset.id)) el.remove();
  peers.forEach((p, i) => {
    let el = [...box.children].find((c) => c.dataset.id === p.id);
    if (!el) el = createPeer(p.id);
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] ?? null);
    el.classList.toggle('speaking', p.speaking && !p.excluded);
    el.classList.toggle('chef', p.isPriority);
    $('.peer-avatar', el).textContent = initial(p.name);
    $('.peer-name', el).textContent = p.name;
    const tags = [roleLabel(p.role), p.section];
    if (p.isHost) tags.push('Hôte');
    if (p.micMuted) tags.push('Micro coupé');
    else if (p.vox) tags.push('Mains libres');
    if (p.whisper) tags.push('Vous chuchote');
    else if (p.speaking && p.excluded) tags.push('Parle à d’autres');
    $('.peer-sub', el).textContent = tags.join(' · ');
    const range = $('input', el);
    if (document.activeElement !== range) range.value = String(p.mix);
    $('.solo', el).setAttribute('aria-pressed', String(p.solo));
    $('.mute', el).setAttribute('aria-pressed', String(p.localMute));
    $('.whisper', el).classList.toggle('on', session.whisperDown && session.whisperTo === p.id);
  });
}

function createPeer(id) {
  const el = document.createElement('div');
  el.className = 'peer';
  el.dataset.id = id;
  el.innerHTML = `
    <div class="peer-head">
      <div class="peer-avatar"></div>
      <div class="grow" style="min-width:0;flex:1"><div class="peer-name"></div><div class="peer-sub"></div></div>
    </div>
    <div class="peer-tools">
      <input type="range" min="0" max="2" step="0.05" aria-label="Volume">
      <button class="mini solo" type="button" aria-pressed="false" title="Solo">S</button>
      <button class="mini mute" type="button" aria-pressed="false" title="Couper chez moi">M</button>
      <button class="mini whisper" type="button" title="Maintenir pour lui parler seul">Chuchoter</button>
    </div>`;
  $('input', el).oninput = (e) => session.setMix(id, Number(e.target.value));
  $('.solo', el).onclick = () => session.toggleSolo(id);
  $('.mute', el).onclick = () => session.toggleLocalMute(id);
  const w = $('.whisper', el);
  w.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlockAudio();
    try {
      w.setPointerCapture(e.pointerId);
    } catch {
      /* rien */
    }
    session.setWhisper(id, true);
  });
  const stop = () => session.setWhisper(id, false);
  w.addEventListener('pointerup', stop);
  w.addEventListener('pointercancel', stop);
  w.addEventListener('lostpointercapture', stop);
  w.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

function renderMetro() {
  $('#metro-bpm').textContent = String(session.bpm);
  $('#metro-tempo').textContent = session.tempoName;
  const slider = $('#metro-slider');
  if (document.activeElement !== slider) slider.value = String(session.bpm);
  const vol = $('#metro-volume');
  if (document.activeElement !== vol) vol.value = String(session.metroVolume);
  const t = $('#metro-toggle');
  t.textContent = session.metroRunning ? 'Arrêter' : 'Démarrer';
  t.className = 'btn btn-half ' + (session.metroRunning ? 'btn-danger' : 'btn-primary');
  renderBeat();
}

function renderBeat() {
  $$('#metro-beats i').forEach((dot, i) => {
    dot.classList.toggle('on', session.metroRunning && session.beat === i);
    dot.classList.toggle('first', i === 0);
  });
}

function renderDock() {
  const ptt = $('#ptt');
  const talking = session.micOpen && (session.pttDown || session.whisperDown || (session.handsFree && session.selfSpeaking));
  ptt.classList.toggle('talking', talking);
  ptt.classList.toggle('vox', session.handsFree && !session.muted);
  ptt.classList.toggle('muted', session.muted);
  const to = session.whisperDown
    ? `à ${session.peers.get(session.whisperTo)?.name ?? 'un musicien'} seul`
    : session.talkGroup ? `à la section ${session.talkGroup}` : 'à tout le monde';
  let label = 'MAINTENIR';
  let sub = `pour parler ${to}`;
  if (session.muted) {
    label = 'MICRO COUPÉ';
    sub = 'Touchez « Couper micro » pour le rouvrir';
  } else if (session.handsFree) {
    label = session.selfSpeaking ? 'VOUS PARLEZ' : 'MAINS LIBRES';
    sub = session.selfSpeaking ? to : 'Parlez : le micro s’ouvre tout seul';
  } else if (talking) {
    label = 'VOUS PARLEZ';
    sub = to;
  }
  $('#ptt-label').textContent = label;
  $('#ptt-sub').textContent = sub;
  $('#live-meter').style.width = `${Math.min(100, Math.round(session.selfLevel * 250))}%`;
  $('#dock-handsfree').setAttribute('aria-pressed', String(session.handsFree));
  $('#dock-mute').setAttribute('aria-pressed', String(session.muted));
  $('#dock-speaker').setAttribute('aria-pressed', String(session.speakerOn));
  $('#dock-speaker').textContent = session.speakerOn ? 'Haut-parleur' : 'Écouteurs';
}

function renderOverlay() {
  const box = $('#cue-overlay');
  const ev = session.overlay;
  const countOnly = !ev && session.countStep > 0 && !session.overlayHidden;
  if ((!ev || session.overlayHidden) && !countOnly) {
    box.hidden = true;
    return;
  }
  const cue = ev?.cue ?? null;
  box.hidden = false;
  box.className = 'cue-overlay' + (cue?.tone ? ' ' + cue.tone : '');
  $('#cue-icon').textContent = cue?.icon ?? '♩';
  $('#cue-label').textContent = cue ? cue.label : 'Décompte';
  $('#cue-from').textContent = ev ? (ev.from === 'Vous' ? 'Envoyé à tout le groupe' : `de ${ev.from}`) : '';
  const step = session.countStep;
  $('#cue-count').textContent = step === 0 ? '' : step === 5 ? 'GO' : String(step);
}

function openInvite() {
  const pin = session.pin;
  const qrText = `bandtalk://join?mode=internet&pin=${pin}${session.appId ? `&app=${session.appId}` : ''}`;
  let svg = '';
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(qrText);
    qr.make();
    svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch {
    svg = '';
  }
  const text = [
    `Rejoins ma session BandTalk « ${session.sessionName} »`,
    `Code : ${formatPin(pin)}`,
    '',
    'Android : BandTalk › Rejoindre › scanne mon QR code, ou Rejoindre › Internet › tape le code.',
    `iPhone : ouvre BandTalk (${APP_URL}) › Rejoindre › tape le code.`,
  ].join('\n');
  openSheet(`
    <h2>Inviter des musiciens</h2>
    <p class="lead">Session Internet : chacun a besoin de la 4G ou du Wi-Fi.</p>
    <div class="invite-code" id="invite-code">${formatPin(pin)}</div>
    ${svg ? `<div class="qr">${svg}</div>` : ''}
    <p class="soft center-text" style="font-size:14px">Android : Rejoindre › scanner ce QR code. iPhone : Rejoindre › taper le code ou scanner.</p>
    <button class="btn btn-primary" type="button" id="invite-share">Partager l’invitation</button>
    <button class="btn btn-ghost" type="button" id="invite-copy">Copier le code</button>`, (root) => {
    $('#invite-share', root).onclick = async () => {
      try {
        if (navigator.share) {
          await navigator.share({ title: 'Invitation BandTalk', text });
          return;
        }
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
      await copy(text);
      toast('Invitation copiée : collez-la dans WhatsApp ou un SMS.');
    };
    $('#invite-copy', root).onclick = async () => {
      await copy(pin);
      toast('Code copié.');
    };
  });
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

// ------------------------------------------------------------------ événements globaux

function wireGlobal() {
  for (const b of $$('.tabbar button')) b.onclick = () => setTab(b.dataset.tab);
  $('#sheet-backdrop').onclick = closeSheet;
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  });

  session.addEventListener('change', () => {
    if (session.inSession && current === 's-main') {
      show('s-live');
    }
    if (current === 's-live') {
      if (!session.inSession) route();
      else renderLive();
    }
  });
  session.addEventListener('beat', renderBeat);
  session.addEventListener('notice', (e) => toast(e.detail));
  session.addEventListener('autoplay', () => ($('#autoplay').hidden = false));
  session.addEventListener('ended', (e) => {
    releaseWakeLock();
    closeSheet();
    $('#cue-overlay').hidden = true;
    $('#autoplay').hidden = true;
    route();
    if (e.detail) toast(e.detail, 6000);
    refreshAccess();
  });

  onAccessChange(() => {
    if (current === 's-main') renderTab();
    if (acces.bloque !== (current === 's-blocked') && user) route();
  });

  let lastResume = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (session.inSession) {
      requestWakeLock();
      session.resume();
    }
    // Retour dans l'appli après avoir payé dans Wave : on vérifie l'abonnement.
    const paid = Number(LS.get('bt_paiement_lance', '0'));
    if (paid && Date.now() - paid < 30 * 60 * 1000) {
      confirmWavePayment().then((ok) => ok && (closeSheet(), toast('Abonnement activé ! Merci.', 6000)));
    } else if (user && Date.now() - lastResume > 30000) {
      lastResume = Date.now();
      syncAccess();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (session.inSession && session.isHost) session.leave();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Nouvelle version installée : rechargée tout de suite, sauf pendant une session.
    if (reloaded || session.inSession) return;
    reloaded = true;
    location.reload();
  });
}

// ------------------------------------------------------------------ démarrage

async function boot() {
  settings.load();
  profile.load();
  acces.load();
  applyTheme();
  registerServiceWorker();
  wireAuth();
  wireGlobal();
  buildLive();

  const params = new URLSearchParams(location.search);
  pendingCode = (params.get('code') ?? '').replace(/\D/g, '').slice(0, 6);
  if (pendingCode.length !== 6) pendingCode = '';
  if (params.has('code')) history.replaceState(null, '', location.pathname);

  db.auth.onAuthStateChange((event, s) => {
    // Pas d'appel à la base directement ici (recommandation Supabase) : on laisse finir.
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        user = s?.user ?? user;
        route();
      } else if (event === 'SIGNED_IN' && s?.user) {
        const first = !user;
        user = s.user;
        profile.fromUser(user);
        if (first) afterLogin();
      } else if (event === 'SIGNED_OUT') {
        user = null;
        if (session.inSession) session.leave();
        route();
      } else if (s?.user) {
        user = s.user;
      }
    }, 0);
  });

  try {
    const { data } = await db.auth.getSession();
    if (data.session?.user && !user) {
      user = data.session.user;
      profile.fromUser(user);
      afterLogin();
      return;
    }
  } catch {
    /* hors-ligne : écran de connexion */
  }
  if (!user) route();
}

boot();
