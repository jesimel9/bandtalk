// Cerveau de la session sur iPhone — mode Internet (Agora) uniquement.
// Portage de lib/controllers/session_controller.dart (partie « Mode Internet ») :
// mêmes messages, même canal « bandtalk_<code> », mêmes règles de priorité.
// Un iPhone et des téléphones Android peuvent donc être dans la même session.
import { nowMicros, unlockAudio, playAt, stopTag, metronome, metronomeGain } from './audio.js';
import { agoraToken, profile, randomHex } from './backend.js';
import { cueById } from './config.js';
import { settings } from './reglages.js';

const LEAD = 650000; // avance donnée aux messages pour arriver partout avant l'heure prévue (µs)
const COUNT = ['count_one', 'count_two', 'count_three', 'count_four', 'count_go'];

const vibrate = (ms) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* pas de vibration sur iPhone */
  }
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Chargement impossible : vérifiez Internet.'));
    document.head.appendChild(s);
  });
}

let agoraLoading = null;
/** Le moteur Agora (1,6 Mo) n'est chargé qu'au moment d'ouvrir une session. */
export function loadAgora() {
  agoraLoading ??= loadScript('vendor/agora-rtc-4.24.8.js').then(() => {
    const A = window.AgoraRTC;
    A.setLogLevel(3);
    try {
      A.disableLogUpload();
    } catch {
      /* ancienne version */
    }
    return A;
  });
  agoraLoading.catch(() => (agoraLoading = null));
  return agoraLoading;
}

class Participant {
  constructor(id) {
    this.id = id;
    this.name = 'Musicien';
    this.role = 'musicien';
    this.section = 'Rythme';
    this.speaking = false;
    this.vox = false;
    this.whisper = false;
    this.micMuted = false;
    this.excluded = false;
    this.gated = false;
    this.isHost = false;
    this.joinedAt = 0;
    this.uid = null;
    this.speakSince = 0;
    this.mix = 1;
    this.solo = false;
    this.localMute = false;
    this.appliedVolume = -1;
  }

  get isPriority() {
    return this.role === 'chef';
  }
}

export class Session extends EventTarget {
  constructor() {
    super();
    this.bpm = 120;
    this.metroVolume = 0.8;
    this.speakerOn = false; // l'utilisateur écoute sur le haut-parleur (anti-larsen)
    this._reset();
  }

  _reset() {
    this.inSession = false;
    this.isHost = false;
    this.sessionName = '';
    this.pin = '';
    this.appId = '';
    this.maxPeers = 8;
    this.link = 'idle'; // idle | connecting | online | reconnecting
    this.peers = new Map();
    this.handsFree = false;
    this.pttDown = false;
    this.muted = false;
    this.whisperTo = null;
    this.whisperDown = false;
    this.talkGroup = null;
    this.selfSpeaking = false;
    this.selfLevel = 0;
    this.lastCue = null;
    this.metroRunning = false;
    this.countCue = null;
    this.countStep = 0;
    this.overlay = null;
    this.overlayHidden = false;
    this.beat = -1;
    this.clockOffset = 0;
    this.diag = { latencyMs: 0, loss: 0 };
    this._joinedAt = 0;
    this._micOpen = false;
    this._micSeq = 0;
    this._seenCues = new Set();
    this._clockWaiters = new Map();
    this._bestRtt = 2 ** 40;
    this._metroAnchor = 0;
    this._timers = [];
    this._countTimers = [];
    this._lastAbove = 0;
    this._leaving = false;
  }

  // ------------------------------------------------------------ état public

  get myId() {
    return profile.id;
  }

  get count() {
    return this.peers.size + 1;
  }

  get micOpen() {
    return this._micOpen;
  }

  get sessionNow() {
    return nowMicros() + this.clockOffset;
  }

  toLocal(sessionMicros) {
    return sessionMicros - this.clockOffset;
  }

  get sectionsInSession() {
    const set = new Set([profile.section, ...[...this.peers.values()].map((p) => p.section)]);
    return [...set];
  }

  get tempoName() {
    const b = this.bpm;
    if (b < 60) return 'Largo';
    if (b < 76) return 'Adagio';
    if (b < 108) return 'Andante';
    if (b <= 120) return 'Moderato';
    if (b < 156) return 'Allegro';
    if (b < 176) return 'Vivace';
    return 'Presto';
  }

  get priorityTalker() {
    for (const p of this.peers.values()) if (p.speaking && !p.excluded && p.isPriority) return p;
    return null;
  }

  /** Anti-larsen : je parle et le son sort par le haut-parleur. */
  get larsenCut() {
    return settings.antiLarsen && this.speakerOn && !this.muted && (this.pttDown || this.whisperDown || (this.handsFree && this.selfSpeaking));
  }

  get _myInfo() {
    return {
      id: this.myId,
      name: profile.name,
      role: profile.role,
      section: profile.section,
      host: this.isHost,
      joinedAt: this._joinedAt,
    };
  }

  /** Prévient l'interface (au plus une fois par image). */
  changed() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this.dispatchEvent(new Event('change'));
    });
  }

  notice(text) {
    this.dispatchEvent(new CustomEvent('notice', { detail: text }));
  }

  // =================================================================
  // Créer / rejoindre / quitter
  // =================================================================

  /** Crée une session Internet. Renvoie null si c'est fait, sinon le message d'erreur. */
  async host(name) {
    if (this.inSession) await this.leave();
    this.isHost = true;
    this.sessionName = name.trim() || 'Session BandTalk';
    this.pin = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    this.maxPeers = 8;
    return this._connect('createur');
  }

  /** Rejoint une session Internet avec son code à 6 chiffres. */
  async join(code) {
    if (this.inSession) await this.leave();
    this.isHost = false;
    this.pin = code;
    this.sessionName = 'Session Internet';
    return this._connect('participant');
  }

  async _connect(role) {
    unlockAudio(); // pendant le toucher : iOS autorise alors le son
    this.inSession = true;
    this.endReason = null;
    this.link = 'connecting';
    this._joinedAt = Date.now();
    this._sessionKey = 'web' + randomHex(24); // compte UNE session pour l'essai, même si le jeton est renouvelé
    this._role = role;
    this.changed();
    try {
      const AgoraRTC = await loadAgora();
      AgoraRTC.onAutoplayFailed = () => this.dispatchEvent(new Event('autoplay'));
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
      } catch {
        /* Safari ancien */
      }
      // 1. Micro (la question « Autoriser le micro ? » arrive ici).
      this.mic = await this._createMic(AgoraRTC);
      // 2. Jeton du serveur BandTalk (vérifie l'essai ou l'abonnement).
      const { appId, token } = await agoraToken({ pin: this.pin, session: this._sessionKey, role });
      this.appId = appId; // voyage dans le QR code d'invitation (les Android rejoignent le même projet)
      // 3. Canal Agora, le même que celui des téléphones Android.
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      this.client = client;
      this._wire(client);
      await client.join(appId, `bandtalk_${this.pin}`, token, null);
      await client.publish([this.mic]);
      try {
        client.enableAudioVolumeIndicator();
      } catch {
        /* facultatif */
      }
    } catch (e) {
      await this._teardown();
      return this._errorMessage(e);
    }
    this.link = 'online';
    this._sendHello();
    this._every(5000, () => this._sendHello());
    this._every(60, () => this._pollLevel());
    this._every(2000, () => this._refreshStats());
    if (this.isHost) this.clockOffset = 0;
    else this._watchForHost();
    this.changed();
    return null;
  }

  /** Personne n'a créé de session Internet avec ce code (souvent : une session Wi-Fi local
   *  d'Android, que l'iPhone ne peut pas rejoindre). On le dit au lieu d'attendre dans le vide. */
  _watchForHost() {
    clearTimeout(this._hostTimer);
    this._hostTimer = setTimeout(() => {
      if (!this.inSession || this._leaving) return;
      if ([...this.peers.values()].some((p) => p.isHost)) return;
      this.leave(
        'Aucune session Internet avec ce code. Sur iPhone, BandTalk ne peut rejoindre que les sessions « 4G / 5G » : ' +
          'demandez au chef de créer une session 4G / 5G (même si tout le monde est sur le même Wi-Fi), puis tapez le nouveau code.',
      );
    }, 15000);
  }

  async _createMic(AgoraRTC) {
    const mic = await AgoraRTC.createMicrophoneAudioTrack({
      encoderConfig: settings.studio ? 'music_standard' : 'speech_standard',
      AEC: true,
      ANS: settings.noise,
      AGC: true,
    });
    await mic.setMuted(true); // micro fermé tant qu'on n'appuie pas sur PARLER
    mic.on?.('track-ended', () => this._restartMic());
    return mic;
  }

  _errorMessage(e) {
    const code = String(e?.code ?? '');
    const msg = String(e?.message ?? e ?? '');
    if (e?.name === 'NotAllowedError' || code === 'PERMISSION_DENIED' || /permission|not allowed/i.test(msg)) {
      return 'BandTalk n’a pas accès au micro. Touchez « Autoriser » quand l’iPhone le demande (ou Réglages › Safari › Micro).';
    }
    if (code === 'NOT_SUPPORTED' || /not supported/i.test(msg)) {
      return 'Ce navigateur ne permet pas les appels. Ouvrez BandTalk avec Safari (iOS 15 ou plus récent).';
    }
    if (/token|dynamic key|invalid vendor key|appid/i.test(msg)) {
      return 'Le serveur Agora a refusé la connexion. Réessayez, ou prévenez BandTalk.';
    }
    if (code === 'CAN_NOT_GET_GATEWAY_SERVER' || code === 'NETWORK_ERROR' || /network|timeout/i.test(msg)) {
      return 'Connexion Internet impossible. Vérifiez la 4G ou le Wi-Fi, puis réessayez.';
    }
    return msg || 'Connexion impossible.';
  }

  _every(ms, fn) {
    this._timers.push(setInterval(fn, ms));
  }

  _wire(client) {
    client.on('user-joined', () => this._sendHello());
    client.on('user-published', async (user, type) => {
      if (type !== 'audio') return;
      try {
        await client.subscribe(user, 'audio');
        user.audioTrack?.play();
        const p = this._peerByUid(user.uid);
        if (p) p.appliedVolume = -1;
        this._applyVolumes();
      } catch {
        /* nouvel essai à la prochaine publication */
      }
    });
    client.on('user-left', (user) => {
      for (const [id, p] of this.peers) if (p.uid === user.uid) this.peers.delete(id);
      this._applyVolumes();
      this.changed();
    });
    client.on('stream-message', (uid, payload) => {
      try {
        const m = JSON.parse(new TextDecoder().decode(payload));
        if (m && typeof m === 'object') this._onMessage(uid, m);
      } catch {
        /* message abîmé */
      }
    });
    client.on('connection-state-change', (cur, prev, reason) => {
      if (this._leaving || !this.inSession) return;
      if (cur === 'RECONNECTING') this.link = 'reconnecting';
      else if (cur === 'CONNECTED') this.link = 'online';
      else if (cur === 'DISCONNECTED' && reason !== 'LEAVE') {
        this.leave(reason === 'UID_BANNED' || reason === 'CHANNEL_BANNED' ? 'Accès refusé par le serveur.' : 'Connexion Internet perdue.');
      }
      this.changed();
    });
    const renew = () => this._renewToken();
    client.on('token-privilege-will-expire', renew);
    client.on('token-privilege-did-expire', renew);
  }

  async _renewToken() {
    try {
      const { token } = await agoraToken({ pin: this.pin, session: this._sessionKey, role: this._role });
      await this.client?.renewToken(token);
    } catch (e) {
      this.notice(e?.message ?? 'Renouvellement de la connexion impossible.');
    }
  }

  /** L'iPhone a coupé le micro (appli mise en arrière-plan, appel téléphonique…) : on le relance. */
  async _restartMic() {
    if (!this.inSession || this._restarting) return;
    this._restarting = true;
    try {
      const AgoraRTC = await loadAgora();
      const old = this.mic;
      const fresh = await this._createMic(AgoraRTC);
      if (old) {
        await this.client?.unpublish([old]).catch(() => {});
        old.close();
      }
      this.mic = fresh;
      await this.client?.publish([fresh]);
      await this._updateMic();
      this.notice('Micro relancé.');
    } catch (e) {
      this.notice(this._errorMessage(e));
    } finally {
      this._restarting = false;
    }
  }

  /** Retour dans l'appli : son débloqué, micro vérifié. */
  async resume() {
    unlockAudio();
    if (!this.inSession) return;
    for (const u of this.client?.remoteUsers ?? []) {
      try {
        u.audioTrack?.play();
      } catch {
        /* rien */
      }
    }
    const track = this.mic?.getMediaStreamTrack?.();
    if (track && track.readyState === 'ended') await this._restartMic();
  }

  async leave(reason = null) {
    if (!this.inSession && !this.client) return;
    this._leaving = true;
    if (this.isHost) this._send({ t: 'end' });
    await new Promise((r) => setTimeout(r, 120));
    await this._teardown();
    this.endReason = reason;
    this._leaving = false;
    this.changed();
    this.dispatchEvent(new CustomEvent('ended', { detail: reason }));
  }

  async _teardown() {
    for (const t of this._timers) clearInterval(t);
    for (const t of this._countTimers) clearTimeout(t);
    clearTimeout(this._hostTimer);
    clearTimeout(this._overlayTimer);
    clearTimeout(this._beatTimer);
    clearTimeout(this._bpmDebounce);
    clearInterval(this._syncTimer);
    metronome({ on: false, bpm: this.bpm, anchorMicros: 0, gain: 0 });
    stopTag('count_');
    const client = this.client;
    const mic = this.mic;
    this.client = null;
    this.mic = null;
    try {
      await client?.leave();
    } catch {
      /* déjà parti */
    }
    try {
      mic?.close();
    } catch {
      /* déjà fermé */
    }
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'auto';
    } catch {
      /* Safari ancien */
    }
    this._reset();
    this.changed();
  }

  // =================================================================
  // Messages (data stream Agora, même format que l'appli Android)
  // =================================================================

  _send(message) {
    const client = this.client;
    if (!client) return;
    const bytes = new TextEncoder().encode(JSON.stringify(message));
    if (bytes.length > 1000) return; // limite d'un message Agora (1 Ko)
    try {
      Promise.resolve(client.sendStreamMessage(bytes)).catch(() => {});
    } catch {
      /* pas encore dans le canal */
    }
  }

  _bcast(data, to = null) {
    this._send({ t: 'bcast', from: this.myId, ...(to ? { to: [...to] } : {}), data });
  }

  _stateData() {
    return { kind: 'state', muted: this.muted, vox: this.handsFree, speaking: false, gate: false };
  }

  get _metroData() {
    return { kind: 'metro', bpm: this.bpm, on: this.metroRunning, vol: this.metroVolume, anchor: this._metroAnchor };
  }

  _sendHello() {
    if (!this.client) return;
    this._send({
      t: 'hello',
      info: this._myInfo,
      ...(this.isHost ? { session: { name: this.sessionName, max: this.maxPeers } } : {}),
      ...(this.isHost && this.metroRunning ? { metro: this._metroData } : {}),
      state: this._stateData(),
    });
  }

  /** Envoie mon nom / rôle / section mis à jour aux autres. */
  pushProfile() {
    if (this.inSession) this._sendHello();
    this.changed();
  }

  _peerByUid(uid) {
    for (const p of this.peers.values()) if (p.uid === uid) return p;
    return null;
  }

  _upsert(info) {
    const id = String(info.id ?? '');
    let p = this.peers.get(id);
    if (!p) {
      p = new Participant(id);
      this.peers.set(id, p);
    }
    if (typeof info.name === 'string') p.name = info.name.slice(0, 40);
    p.role = ['chef', 'musicien', 'inge'].includes(info.role) ? info.role : 'musicien';
    if (typeof info.section === 'string') p.section = info.section.slice(0, 30);
    p.isHost = info.host === true;
    if (typeof info.joinedAt === 'number') p.joinedAt = info.joinedAt;
    return p;
  }

  _onMessage(uid, m) {
    switch (m.t) {
      case 'hello': {
        const info = m.info;
        if (!info || typeof info !== 'object' || !info.id || info.id === this.myId) return;
        const isNew = !this.peers.has(info.id);
        const p = this._upsert(info);
        p.uid = uid;
        p.appliedVolume = -1;
        const session = m.session;
        if (session && typeof session === 'object' && !this.isHost) {
          if (typeof session.name === 'string') this.sessionName = session.name.slice(0, 60);
          if (typeof session.max === 'number') this.maxPeers = session.max;
        }
        if (m.metro && typeof m.metro === 'object' && !this.metroRunning) this._applyMetro(m.metro);
        if (m.state && typeof m.state === 'object') this._onBroadcast(p.id, m.state);
        if (isNew) {
          this._sendHello(); // on se présente au nouveau venu
          if (p.isHost) this._startClockSync();
        }
        this._checkCapacity();
        break;
      }
      case 'bcast': {
        if (Array.isArray(m.to) && !m.to.includes(this.myId)) return;
        if (!m.from || !m.data || typeof m.data !== 'object' || !this.peers.has(m.from)) return;
        this._onBroadcast(m.from, m.data);
        break;
      }
      case 'end':
        if (!this.isHost && !this._leaving) this.leave('L’hôte a fermé la session.');
        return;
      case 'tping':
      case 'tpong':
        this._onClockMessage(m);
        return;
      default:
        return;
    }
    this._applyVolumes();
    this.changed();
  }

  /** Limite de participants : les derniers arrivés au-delà de la limite quittent d'eux-mêmes. */
  _checkCapacity() {
    if (this.isHost || this.count <= this.maxPeers) return;
    const order = [[this.myId, this._joinedAt], ...[...this.peers.values()].map((p) => [p.id, p.joinedAt])].sort((a, b) =>
      a[1] !== b[1] ? a[1] - b[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
    const rank = order.findIndex((e) => e[0] === this.myId);
    if (rank >= this.maxPeers && !this._leaving) this.leave(`Session pleine (${this.maxPeers} participants maximum).`);
  }

  _onBroadcast(from, d) {
    let p = this.peers.get(from);
    if (!p) {
      p = new Participant(from);
      this.peers.set(from, p);
    }
    switch (d.kind) {
      case 'speak': {
        const on = d.on === true;
        if (on && !p.speaking) p.speakSince = Date.now();
        p.speaking = on;
        p.vox = d.vox === true;
        p.excluded = on && Array.isArray(d.targets) && !d.targets.includes(this.myId);
        p.whisper = on && d.whisper === true && !p.excluded;
        if (p.whisper) vibrate(60);
        break;
      }
      case 'state':
        p.micMuted = d.muted === true;
        p.vox = d.vox === true;
        p.gated = d.gate === true;
        if (d.speaking !== true) {
          p.speaking = false;
          p.excluded = false;
        }
        break;
      case 'metro':
        this._applyMetro(d);
        break;
      case 'cue':
      case 'count':
        this._receiveCue(p.name, d);
        break;
      default:
        break;
    }
  }

  // =================================================================
  // Parole : appui pour parler, mains libres, chuchotement, groupes
  // =================================================================

  _targets() {
    if (this.whisperDown && this.whisperTo) return new Set([this.whisperTo]);
    if (this.talkGroup === null) return new Set(this.peers.keys());
    return new Set([...this.peers.values()].filter((p) => p.section === this.talkGroup).map((p) => p.id));
  }

  get _wantMic() {
    return !this.muted && (this.whisperDown || this.handsFree || this.pttDown);
  }

  async _updateMic() {
    const seq = ++this._micSeq;
    const open = this._wantMic;
    this._micOpen = open;
    try {
      await this.mic?.setMuted(!open);
    } catch {
      /* micro en cours de relance */
    }
    if (seq === this._micSeq && (!this.handsFree || this.whisperDown || this.muted)) this._setSpeaking(this._wantMic);
    this._applyVolumes();
    this.changed();
  }

  _setSpeaking(on) {
    if (this.selfSpeaking === on) return;
    this.selfSpeaking = on;
    const targets = this._targets();
    const everyone = this.talkGroup === null && !this.whisperDown;
    // En Internet, tout le monde reçoit l'info (pour couper ceux qui ne sont pas visés).
    this._bcast({
      kind: 'speak',
      on,
      vox: this.handsFree && !this.whisperDown,
      whisper: this.whisperDown,
      ...(everyone ? {} : { targets: [...targets] }),
    });
    this._applyVolumes();
    this.changed();
  }

  setPtt(down) {
    if (this.handsFree || this.pttDown === down) return;
    this.pttDown = down;
    if (down) vibrate(25);
    this._updateMic();
  }

  /** Renvoie un avertissement si le mains libres est activé sur haut-parleur. */
  setHandsFree(value) {
    const warn = value && this.speakerOn && this.inSession ? 'Mains libres sur haut-parleur : risque de larsen.' : null;
    this.handsFree = value;
    this.pttDown = false;
    this._setSpeaking(false);
    this._updateMic();
    this._bcast(this._stateData());
    return warn;
  }

  toggleMute() {
    this.muted = !this.muted;
    vibrate(40);
    this._updateMic();
    this._bcast(this._stateData());
  }

  setWhisper(peerId, down) {
    if (!down) {
      if (!this.whisperDown) return;
      this.whisperDown = false;
      this._setSpeaking(false);
      this._updateMic();
      return;
    }
    this.whisperTo = peerId;
    this.whisperDown = true;
    this._setSpeaking(false);
    vibrate(25);
    this._updateMic();
  }

  setTalkGroup(group) {
    this.talkGroup = group;
    if (this.selfSpeaking) this._setSpeaking(false);
    this._updateMic();
  }

  toggleSpeaker() {
    this.speakerOn = !this.speakerOn;
    if (this.speakerOn && this.handsFree) this.notice('Mains libres sur haut-parleur : risque de larsen.');
    this._applyVolumes();
    this.changed();
  }

  /** Niveau du micro (vu-mètre) et porte « mains libres ». */
  _pollLevel() {
    if (!this.mic) return;
    let level = 0;
    try {
      level = this.mic.getVolumeLevel() || 0;
    } catch {
      return;
    }
    const changed = Math.abs(level - this.selfLevel) > 0.02;
    this.selfLevel = level;
    if (this.handsFree && !this.muted && !this.whisperDown) {
      const threshold = 10 ** (settings.voxDb / 20);
      const now = Date.now();
      if (level >= threshold) {
        this._lastAbove = now;
        this._setSpeaking(true);
      } else if (this.selfSpeaking && now - this._lastAbove > 500) {
        this._setSpeaking(false); // « hang time » de 500 ms pour ne pas hacher les phrases
      }
    }
    if (changed) this.changed();
  }

  _refreshStats() {
    const client = this.client;
    if (!client) return;
    try {
      const stats = client.getRemoteAudioStats?.() ?? {};
      let delay = 0;
      let loss = 0;
      let n = 0;
      for (const s of Object.values(stats)) {
        delay += Number(s.end2EndDelay ?? s.transportDelay ?? 0);
        loss = Math.max(loss, Number(s.packetLossRate ?? 0));
        n++;
      }
      this.diag = { latencyMs: n ? Math.round(delay / n) : 0, loss: Math.round(loss) };
      this.changed();
    } catch {
      /* statistiques indisponibles */
    }
  }

  // =================================================================
  // Priorités et mix (règles identiques sur chaque téléphone)
  // =================================================================

  _applyVolumes() {
    const heard = [...this.peers.values()].filter((p) => p.speaking && !p.excluded);
    const chefTalking = heard.some((p) => p.isPriority);
    const talkers = heard.filter((p) => !p.isPriority).sort((a, b) => a.speakSince - b.speakSince);
    const firstTalker = talkers.length ? talkers[0].id : null;
    const anySolo = [...this.peers.values()].some((p) => p.solo);
    const cut = this.larsenCut;
    const remote = this.client?.remoteUsers ?? [];

    for (const p of this.peers.values()) {
      if (p.uid === null) continue;
      let v = settings.listen * p.mix;
      if (cut && !p.whisper) {
        v = 0; // ANTI-LARSEN : je parle sur haut-parleur → retour coupé net
      } else if (p.localMute || (anySolo && !p.solo) || (p.vox && !p.speaking && !p.whisper && !p.gated) || p.excluded) {
        v = 0; // porte mains libres fermée, coupé ici, hors solo, ou il ne me parle pas
      } else if (!p.isPriority && chefTalking) {
        v *= settings.duck; // Priorité 1 : le chef de groupe passe devant
      } else if (!p.isPriority && firstTalker !== null && p.speaking && p.id !== firstTalker) {
        v *= Math.max(settings.duck, 0.5); // Priorité 2 : premier arrivé, premier servi
      }
      const user = remote.find((u) => u.uid === p.uid);
      if (!user?.audioTrack) continue;
      if (Math.abs(p.appliedVolume - v) > 0.001) {
        p.appliedVolume = v;
        try {
          user.audioTrack.setVolume(Math.max(0, Math.min(400, Math.round(v * 100))));
        } catch {
          /* piste en cours de remplacement */
        }
      }
    }
  }

  setMix(id, v) {
    const p = this.peers.get(id);
    if (p) p.mix = v;
    this._applyVolumes();
    this.changed();
  }

  toggleSolo(id) {
    const p = this.peers.get(id);
    if (!p) return;
    p.solo = !p.solo;
    this._applyVolumes();
    this.changed();
  }

  toggleLocalMute(id) {
    const p = this.peers.get(id);
    if (!p) return;
    p.localMute = !p.localMute;
    this._applyVolumes();
    this.changed();
  }

  refreshVolumes() {
    for (const p of this.peers.values()) p.appliedVolume = -1;
    this._applyVolumes();
  }

  // =================================================================
  // Horloge commune (synchro type NTP avec l'hôte)
  // =================================================================

  _startClockSync() {
    clearInterval(this._syncTimer);
    if (this.isHost) {
      this.clockOffset = 0;
      return;
    }
    this._bestRtt = 2 ** 40;
    this._syncBurst(8);
    this._syncTimer = setInterval(() => this._syncBurst(4), 15000);
  }

  async _syncBurst(n) {
    let best = null;
    let bestRtt = 2 ** 40;
    for (let i = 0; i < n && this.inSession; i++) {
      const sample = await this._clockSample();
      if (sample && sample[0] < bestRtt) {
        bestRtt = sample[0];
        best = sample[1];
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    if (best === null || !this.inSession) return;
    // On garde la mesure la plus fiable (aller-retour le plus court).
    if (bestRtt <= this._bestRtt * 1.5 || Math.abs(best - this.clockOffset) > 20000) {
      this._bestRtt = Math.min(bestRtt, this._bestRtt);
      const changed = Math.abs(best - this.clockOffset) > 2000;
      this.clockOffset = best;
      if (changed && this.metroRunning) this._runMetro();
    }
  }

  _clockSample() {
    let host = null;
    for (const p of this.peers.values()) if (p.isHost) host = p;
    if (!host || !this.client) return Promise.resolve(null);
    const id = 't' + nowMicros();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._clockWaiters.delete(id);
        resolve(null);
      }, 1500);
      this._clockWaiters.set(id, { t0: nowMicros(), resolve, timer });
      this._send({ t: 'tping', id, to: host.id, from: this.myId });
    });
  }

  _onClockMessage(m) {
    if (m.to !== this.myId) return;
    if (m.t === 'tping' && this.isHost) {
      this._send({ t: 'tpong', id: m.id, to: m.from, now: nowMicros() });
    } else if (m.t === 'tpong') {
      const w = this._clockWaiters.get(m.id);
      if (!w || typeof m.now !== 'number') return;
      this._clockWaiters.delete(m.id);
      clearTimeout(w.timer);
      const t1 = nowMicros();
      w.resolve([t1 - w.t0, Math.round(m.now - (w.t0 + t1) / 2)]);
    }
  }

  // =================================================================
  // Signaux : plein écran, bip, décompte calé sur le métronome
  // =================================================================

  get _periodMicros() {
    return Math.round(60000000 / this.bpm);
  }

  /** Envoie un signal. Sauf « Alerte son », il est précédé d'un décompte « One, two, three, four, GO ». */
  sendCue(cueId, toGroup = false) {
    const cue = cueById(cueId);
    const g = this.talkGroup ?? profile.section;
    const to = toGroup ? [...this.peers.values()].filter((p) => p.section === g).map((p) => p.id) : null;
    const count = cue.id !== 'alert';
    const at = this._countStartAt();
    this._send2({ kind: 'cue', id: cue.id, count, at }, to);
    const ev = { cue, from: 'Vous', at: Date.now() };
    this.lastCue = ev;
    this._showOverlay(ev, count ? this.toLocal(at + 4 * this._periodMicros) + 1500000 : null);
    if (count) this._scheduleCountIn(cue, at, this.bpm);
  }

  /** Décompte seul, pour démarrer ensemble. */
  sendCountIn() {
    const at = this._countStartAt();
    this._send2({ kind: 'count', count: true, at }, null);
    this._scheduleCountIn(null, at, this.bpm);
  }

  _send2(data, to) {
    const msg = {
      ...data,
      bpm: this.bpm,
      mid: `${this.myId}-${nowMicros()}`,
      from: this.myId,
      pin: this.pin,
      ...(to ? { to } : {}),
    };
    this._bcast(msg, to);
  }

  _receiveCue(fromName, d) {
    const mid = d.mid;
    if (typeof mid === 'string') {
      if (this._seenCues.has(mid)) return; // doublon
      this._seenCues.add(mid);
      if (this._seenCues.size > 60) this._seenCues.delete(this._seenCues.values().next().value);
    }
    const cue = d.kind === 'cue' ? cueById(d.id) : null;
    const tempo = Math.min(260, Math.max(30, Math.round(Number(d.bpm) || this.bpm)));
    const at = typeof d.at === 'number' ? d.at : this.sessionNow + 100000;
    const count = d.count === true;
    if (cue) {
      const ev = { cue, from: fromName, at: Date.now() };
      this.lastCue = ev;
      this._showOverlay(ev, count ? this.toLocal(at + 4 * Math.round(60000000 / tempo)) + 1500000 : null);
    }
    if (count) this._scheduleCountIn(cue, at, tempo);
    this.changed();
  }

  /** Heure de session du « 1 » : prochain temps fort du métronome (ou dans un instant). */
  _countStartAt() {
    const earliest = this.sessionNow + LEAD;
    if (!this.metroRunning) return earliest;
    const bar = this._periodMicros * 4;
    const k = Math.ceil((earliest - this._metroAnchor) / bar);
    return this._metroAnchor + Math.max(0, k) * bar;
  }

  _scheduleCountIn(cue, atSession, tempo) {
    for (const t of this._countTimers) clearTimeout(t);
    this._countTimers = [];
    stopTag('count_');
    this.countCue = cue;
    this.overlayHidden = false;
    const period = Math.round(60000000 / tempo);
    for (let i = 0; i < 5; i++) {
      const local = this.toLocal(atSession + i * period);
      const wait = local - nowMicros();
      if (settings.countVoice && wait > -80000) playAt(COUNT[i], local);
      const step = i + 1;
      this._countTimers.push(
        setTimeout(() => {
          this.countStep = step;
          vibrate(step === 5 ? 80 : 30);
          if (step === 5) {
            this._countTimers.push(
              setTimeout(() => {
                this.countStep = 0;
                this.countCue = null;
                this.changed();
              }, 1200),
            );
          }
          this.changed();
        }, Math.max(0, wait / 1000)),
      );
    }
  }

  /** Plein écran chez tout le monde pendant 6 s (ou jusqu'après le GO), avec bip. */
  _showOverlay(ev, minUntilLocal = null) {
    this.overlay = ev;
    this.overlayHidden = false;
    const now = nowMicros();
    const until = Math.max(now + 6000000, minUntilLocal ?? 0);
    clearTimeout(this._overlayTimer);
    this._overlayTimer = setTimeout(() => {
      this.overlay = null;
      this.changed();
    }, (until - now) / 1000);
    playAt('beep', now, 0.9);
    vibrate([120, 80, 120]);
    this.changed();
  }

  /** Ferme le plein écran à tout moment (le décompte continue en son). */
  dismissOverlay() {
    clearTimeout(this._overlayTimer);
    this.overlay = null;
    this.overlayHidden = true;
    this.changed();
  }

  // =================================================================
  // Métronome partagé (horloge commune)
  // =================================================================

  setBpm(value) {
    this.bpm = Math.min(260, Math.max(30, Math.round(value)));
    this.changed();
    clearTimeout(this._bpmDebounce);
    this._bpmDebounce = setTimeout(() => {
      if (this.metroRunning) {
        this._metroAnchor = this.sessionNow + LEAD;
        this._runMetro();
      }
      this._shareMetro();
    }, 350);
  }

  toggleMetro() {
    unlockAudio();
    this.metroRunning = !this.metroRunning;
    if (this.metroRunning) this._metroAnchor = this.sessionNow + LEAD;
    this._runMetro();
    this._shareMetro();
    this.changed();
  }

  setMetroVolume(v, share = true) {
    this.metroVolume = Math.min(1, Math.max(0, v));
    metronomeGain(this.metroVolume);
    if (share) this._shareMetro();
    this.changed();
  }

  tapTempo() {
    const now = Date.now();
    this._taps ??= [];
    if (this._taps.length && now - this._taps[this._taps.length - 1] > 2000) this._taps = [];
    this._taps.push(now);
    if (this._taps.length > 5) this._taps.shift();
    if (this._taps.length >= 2) {
      const ms = (this._taps[this._taps.length - 1] - this._taps[0]) / (this._taps.length - 1);
      if (ms > 0) this.setBpm(60000 / ms);
    }
  }

  _shareMetro() {
    if (this.inSession) this._bcast(this._metroData);
  }

  _applyMetro(d) {
    this.bpm = Math.min(260, Math.max(30, Math.round(Number(d.bpm) || this.bpm)));
    const vol = Number(d.vol);
    if (Number.isFinite(vol)) this.metroVolume = Math.min(1, Math.max(0, vol));
    this.metroRunning = d.on === true;
    if (typeof d.anchor === 'number') this._metroAnchor = d.anchor;
    else if (this.metroRunning) this._metroAnchor = this.sessionNow + 100000;
    this._runMetro();
  }

  _runMetro() {
    clearTimeout(this._beatTimer);
    metronome({ on: this.metroRunning, bpm: this.bpm, anchorMicros: this.toLocal(this._metroAnchor), gain: this.metroVolume });
    if (!this.metroRunning) {
      this.beat = -1;
      this.dispatchEvent(new Event('beat'));
      return;
    }
    this._scheduleBeat();
  }

  /** Affichage des temps (le son, lui, est programmé par le moteur Web Audio). */
  _scheduleBeat() {
    const p = this._periodMicros;
    const now = this.sessionNow;
    const k = Math.max(0, Math.floor((now - this._metroAnchor) / p) + 1);
    const at = this._metroAnchor + k * p;
    this._beatTimer = setTimeout(() => {
      if (!this.metroRunning) return;
      this.beat = ((k % 4) + 4) % 4;
      this.dispatchEvent(new Event('beat'));
      this._scheduleBeat();
    }, Math.max(0, (at - now) / 1000));
  }
}
