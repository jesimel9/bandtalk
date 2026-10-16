// Sons de BandTalk sur iPhone : métronome, décompte et bip, joués par Web Audio
// à l'heure exacte demandée (heures en microsecondes de l'horloge LOCALE, comme
// lib/services/audio_engine.dart dans l'appli Android).

const SONS = ['click_hi', 'click_lo', 'count_one', 'count_two', 'count_three', 'count_four', 'count_go', 'beep'];

/** Horloge locale en microsecondes (même échelle que DateTime.now() sur Android). */
export const nowMicros = () => Math.round((performance.timeOrigin + performance.now()) * 1000);

let ctx = null;
let loading = null;
const buffers = {};
const playing = new Set();

/** Prépare le moteur (à appeler pendant un toucher de l'utilisateur : iOS l'exige). */
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC({ latencyHint: 'interactive' });
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  // Un échantillon muet joué pendant le toucher débloque le son sur iOS.
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(ctx.destination);
  s.start(0);
  if (!loading) loading = loadSounds();
}

async function loadSounds() {
  await Promise.all(
    SONS.map(async (name) => {
      try {
        const data = await (await fetch(`sons/${name}.wav`)).arrayBuffer();
        buffers[name] = await new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
      } catch {
        /* son manquant : ignoré */
      }
    }),
  );
}

export const audioReady = () => loading ?? Promise.resolve();

/** Heure du contexte audio qui sera ENTENDUE à [localMicros] (latence de sortie comprise). */
function ctxTimeFor(localMicros) {
  let ctxNow = ctx.currentTime;
  let perfNow = performance.now();
  if (typeof ctx.getOutputTimestamp === 'function') {
    const ts = ctx.getOutputTimestamp();
    if (ts.contextTime > 0 && ts.performanceTime > 0) {
      ctxNow = ts.contextTime;
      perfNow = ts.performanceTime;
    }
  }
  const targetPerf = localMicros / 1000 - performance.timeOrigin;
  return ctxNow + (targetPerf - perfNow) / 1000;
}

/** Joue [name] à [localMicros] (ou tout de suite si l'heure est passée). */
export function playAt(name, localMicros, gain = 1) {
  const buffer = buffers[name];
  if (!ctx || !buffer) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = Math.max(0, gain);
  src.connect(g).connect(ctx.destination);
  src.start(Math.max(ctx.currentTime, ctxTimeFor(localMicros)));
  const entry = { name, src };
  playing.add(entry);
  src.onended = () => playing.delete(entry);
}

/** Arrête les sons dont le nom commence par [prefix] (déjà programmés compris). */
export function stopTag(prefix) {
  for (const e of playing) {
    if (!e.name.startsWith(prefix)) continue;
    try {
      e.src.stop();
    } catch {
      /* déjà terminé */
    }
    playing.delete(e);
  }
}

// ------------------------------------------------------------------ métronome

const metro = { on: false, period: 500000, anchor: 0, gain: 0.8, last: null, timer: null };

/** Métronome : le temps 1 tombe à [anchorMicros] (horloge locale). Accent tous les 4 temps. */
export function metronome({ on, bpm, anchorMicros, gain }) {
  clearInterval(metro.timer);
  metro.timer = null;
  stopTag('click_');
  metro.on = on;
  metro.period = 60000000 / Math.max(20, bpm);
  metro.anchor = anchorMicros;
  metro.gain = gain;
  metro.last = null;
  if (!on || !ctx) return;
  const tick = () => {
    const now = nowMicros();
    const horizon = now + 220000; // programmé 220 ms à l'avance (minuteries ralenties sur iOS)
    let k = metro.last === null ? Math.ceil((now - metro.anchor) / metro.period) : metro.last + 1;
    for (;;) {
      const t = metro.anchor + k * metro.period;
      if (t >= horizon) break;
      metro.last = k;
      if (t >= now - 15000) playAt(((k % 4) + 4) % 4 === 0 ? 'click_hi' : 'click_lo', t, metro.gain);
      k++;
    }
  };
  tick();
  metro.timer = setInterval(tick, 40);
}

export function metronomeGain(gain) {
  metro.gain = gain;
}
