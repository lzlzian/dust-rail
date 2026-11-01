// Procedural WebAudio SFX: no asset files. Each gun is a layered recipe (crack + body + sub thump + reverb tail).
import { settings, J } from './config.js';
import { renderFoley, foleyBeats } from './foley.js';

let ctx = null, master = null, dry = null, wet = null, noiseBuf = null, foleyBus = null;

const GUNS = {
  revolver: { crack: 0.9, body: 1.0, lp: 3200, dur: 0.32, thump: 1.0, tf: 140, tail: 0.55, pitch: 1.0, mech: 'hammer' },
  smg: { crack: 0.55, body: 0.45, lp: 5200, dur: 0.07, thump: 0.35, tf: 190, tail: 0.18, pitch: 1.5 },
  ar: { crack: 0.8, body: 0.7, lp: 3800, dur: 0.13, thump: 0.6, tf: 160, tail: 0.3, pitch: 1.15 },
  shotgun: { crack: 1.0, body: 1.3, lp: 2100, dur: 0.42, thump: 1.4, tf: 110, tail: 0.7, pitch: 0.75, mech: 'pump' },
  sniper: { crack: 1.3, body: 1.0, lp: 2600, dur: 0.55, thump: 1.3, tf: 120, tail: 1.0, pitch: 0.85, mech: 'bolt' },
};

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.15;
  master = ctx.createGain(); master.gain.value = settings.volume;
  master.connect(comp).connect(ctx.destination);
  dry = ctx.createGain(); dry.connect(master);
  const conv = ctx.createConvolver(); conv.buffer = impulse(1.6, 2.6);
  wet = ctx.createGain(); wet.gain.value = 0.45; wet.connect(conv).connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // foley: dry and close, panned a touch toward the gun hand, plus two quiet early reflections (hands, body)
  foleyBus = ctx.createGain(); foleyBus.gain.value = 1.1;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (pan.pan) pan.pan.value = 0.2;
  foleyBus.connect(pan).connect(master);
  for (const [dt, g] of [[0.009, 0.2], [0.017, 0.11]]) {
    const dl = ctx.createDelay(0.05), lp = ctx.createBiquadFilter(), gn = ctx.createGain();
    dl.delayTime.value = dt; lp.type = 'lowpass'; lp.frequency.value = 3500; gn.gain.value = g;
    foleyBus.connect(dl).connect(lp).connect(gn).connect(master);
  }
  prewarmFoley();
}

// ------------------------------------------------------------------ foley playback (see foley.js)
// 3 rendered variations per beat so repeated reloads never sound copy-pasted; rendered in idle slices after the first tap
const FOLEY_VARIANTS = 3, foleyCache = new Map();
function foleyBuffer(gun, beat) {
  const key = gun + '.' + beat;
  let c = foleyCache.get(key);
  if (!c) { c = { bufs: [], i: 0 }; foleyCache.set(key, c); }
  if (c.bufs.length < FOLEY_VARIANTS) {
    const data = renderFoley(gun, beat, ctx.sampleRate);
    if (!data) return null;
    const b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.copyToChannel(data, 0);
    c.bufs.push(b);
    if (c.bufs.length < FOLEY_VARIANTS) return b; // rendering on demand: use the fresh one
  }
  return c.bufs[c.i++ % c.bufs.length];
}
function prewarmFoley() {
  const jobs = [];
  for (let k = 0; k < FOLEY_VARIANTS; k++) for (const [g, b] of foleyBeats()) jobs.push([g, b]);
  const step = () => {
    const t0 = performance.now();
    while (jobs.length && performance.now() - t0 < 6) { const [g, b] = jobs.shift(); const c = foleyCache.get(g + '.' + b); if (!c || c.bufs.length < FOLEY_VARIANTS) foleyBuffer(g, b); }
    if (jobs.length) setTimeout(step, 16);
  };
  setTimeout(step, 50);
}
function foley(gun, beat, t) {
  const b = foleyBuffer(gun, beat);
  if (!b) return false;
  const src = ctx.createBufferSource(); src.buffer = b;
  src.playbackRate.value = 0.97 + Math.random() * 0.06;
  src.connect(foleyBus); src.start(t);
  return true;
}

export function setVolume(v) { if (master) master.gain.value = v; }

function impulse(sec, decay) {
  const len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const on = () => ctx && J('sound') > 0;

function noise(t, dur, type, freq, q, gain, attack = 0.001, send = 0, rate = 1) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = rate;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g); g.connect(dry);
  if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s).connect(wet); }
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  return f;
}

function tone(t, dur, type, f0, f1, gain, send = 0, attack = 0.002) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dry);
  if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s).connect(wet); }
  o.start(t); o.stop(t + dur + 0.05);
}

const click = (t, f = 2500, gain = 0.25, dur = 0.03) => noise(t, dur, 'bandpass', f, 4, gain);

export const sfx = {
  shot(id) {
    if (!on()) return;
    const p = GUNS[id] || GUNS.ar, t = ctx.currentTime, v = 0.92 + Math.random() * 0.16;
    noise(t, 0.035, 'highpass', 2400 * p.pitch * v, 0.7, 0.9 * p.crack);
    noise(t, p.dur, 'lowpass', p.lp * v, 0.8, 0.85 * p.body, 0.002, p.tail);
    tone(t, p.dur * 0.7 + 0.06, 'sine', p.tf * v, 38, 0.9 * p.thump);
    if (p.mech === 'pump') foley('shotgun', 'pump', t + 0.34);
    if (p.mech === 'bolt') { foley('sniper', 'boltUp', t + 0.42); foley('sniper', 'boltBack', t + 0.48); foley('sniper', 'boltFwd', t + 0.64); foley('sniper', 'boltDown', t + 0.76); }
    if (p.mech === 'hammer') click(t + 0.12, 3200, 0.12, 0.02);
  },
  shell(delay = 0.25) {
    if (!on()) return;
    const t = ctx.currentTime + delay, f = 3800 + Math.random() * 1600;
    tone(t, 0.06, 'triangle', f, f * 0.9, 0.05); tone(t + 0.09, 0.05, 'triangle', f * 1.05, f, 0.03);
  },
  dry() { if (on()) click(ctx.currentTime, 2800, 0.3, 0.025); },
  // one beat of a scripted reload (see reloadSeq in config.js); every gun has its own recipes in foley.js
  reload(name, gun) { if (on()) foley(gun, name, ctx.currentTime); },
  // shotgun choke fully tight: a soft mechanical detent
  choke() { if (on()) { const t = ctx.currentTime; click(t, 3600, 0.16, 0.012); click(t + 0.03, 2400, 0.12, 0.015); } },
  // sights up: cloth/sling swish + the cheek-weld tick; a scope adds a faint glassy ring as the eye finds it
  raise(scope) {
    if (!on()) return;
    const t = ctx.currentTime;
    const f = noise(t, 0.09, 'bandpass', 700, 0.9, 0.16, 0.025); f.frequency.exponentialRampToValueAtTime(1700, t + 0.08);
    click(t + 0.075, 2100, 0.1, 0.018);
    if (scope) tone(t + 0.08, 0.12, 'sine', 3300, 3200, 0.025);
  },
  swap() { if (on()) { const t = ctx.currentTime; click(t, 1500, 0.2, 0.05); click(t + 0.12, 2400, 0.25, 0.03); } },
  hit(crit) {
    if (!on()) return;
    const t = ctx.currentTime;
    if (crit) { tone(t, 0.22, 'triangle', 1500, 1450, 0.22); tone(t, 0.18, 'sine', 3000, 2950, 0.1); }
    else tone(t, 0.05, 'square', 1100, 900, 0.06);
  },
  kill(big) {
    if (!on()) return;
    const t = ctx.currentTime;
    tone(t, 0.18, 'sine', 220, 60, 0.5);
    noise(t, 0.15, 'bandpass', 900, 1.2, 0.35);
    if (big) tone(t + 0.02, 0.35, 'triangle', 660, 990, 0.12, 0.3);
  },
  boom(size = 1) {
    if (!on()) return;
    const t = ctx.currentTime;
    const f = noise(t, 0.9 * size + 0.3, 'lowpass', 1400, 0.7, 1.0, 0.004, 0.6, 0.7);
    f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.8 * size);
    tone(t, 0.6 * size + 0.2, 'sine', 90, 28, 1.1);
    noise(t, 0.05, 'highpass', 3000, 0.5, 0.5);
  },
  intercept() {
    if (!on()) return;
    const t = ctx.currentTime;
    tone(t, 0.16, 'square', 880, 1760, 0.08); tone(t + 0.06, 0.2, 'triangle', 1320, 2640, 0.08, 0.3);
  },
  interrupt() {
    if (!on()) return;
    const t = ctx.currentTime;
    tone(t, 0.4, 'sawtooth', 900, 120, 0.18, 0.4); noise(t, 0.3, 'bandpass', 600, 2, 0.4);
  },
  hurt(big) {
    if (!on()) return;
    const t = ctx.currentTime;
    tone(t, 0.25, 'sine', big ? 120 : 160, 50, 0.8); noise(t, 0.2, 'lowpass', 700, 1, 0.6);
  },
  blocked() { if (on()) { const t = ctx.currentTime; tone(t, 0.1, 'square', 2200, 1800, 0.08); noise(t, 0.12, 'bandpass', 3000, 3, 0.3); } },
  enemyShot(dist) {
    if (!on()) return;
    const t = ctx.currentTime, g = Math.min(1, 12 / Math.max(dist, 1));
    noise(t, 0.12, 'bandpass', 1600, 0.8, 0.5 * g, 0.002, 0.4); tone(t, 0.1, 'sine', 180, 60, 0.3 * g);
  },
  whiz() { if (on()) { const t = ctx.currentTime; const f = noise(t, 0.18, 'bandpass', 3000, 6, 0.25, 0.04); f.frequency.exponentialRampToValueAtTime(900, t + 0.18); } },
  launch() { if (on()) { const t = ctx.currentTime; noise(t, 0.45, 'bandpass', 700, 0.8, 0.45, 0.01, 0.3); tone(t, 0.3, 'sawtooth', 120, 60, 0.08); } },
  lob() { if (on()) { const t = ctx.currentTime; tone(t, 0.12, 'sine', 400, 250, 0.15); noise(t, 0.2, 'bandpass', 1200, 2, 0.15, 0.02); } },
  ui() { if (on()) tone(ctx.currentTime, 0.05, 'square', 1400, 1500, 0.05); },
  heal() { if (on()) { const t = ctx.currentTime; [523, 659, 784].forEach((f, i) => tone(t + i * 0.07, 0.25, 'triangle', f, f, 0.12, 0.3)); } },
  focus(onOff) { if (on()) { const t = ctx.currentTime; tone(t, 0.6, 'sine', onOff ? 600 : 150, onOff ? 150 : 600, 0.25, 0.5); } },
  cover() { if (on()) noise(ctx.currentTime, 0.12, 'lowpass', 600, 1, 0.35); },
  // beat camera: a two-note call-out before a turn, then a whoosh that rides the pan
  cue() { if (on()) { const t = ctx.currentTime; tone(t, 0.08, 'square', 740, 760, 0.06); tone(t + 0.1, 0.16, 'square', 988, 1000, 0.07, 0.25); } },
  pan(dur) {
    if (!on()) return;
    const t = ctx.currentTime, f = noise(t, dur + 0.2, 'bandpass', 260, 1.2, 0.3, dur * 0.5, 0.2, 0.6);
    f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(1100, t + dur * 0.5); f.frequency.exponentialRampToValueAtTime(320, t + dur + 0.15);
  },
  clear() { if (on()) { const t = ctx.currentTime; [392, 523, 659, 784].forEach((f, i) => tone(t + i * 0.09, 0.4, 'triangle', f, f, 0.12, 0.4)); } },

  // Rising whine for charge-up telegraphs. Returns a handle the enemy updates/stops.
  charge(dur) {
    if (!on() || !settings.tele.audio) return null;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'square';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + dur);
    o2.frequency.setValueAtTime(112, t); o2.frequency.exponentialRampToValueAtTime(1780, t + dur);
    f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(5000, t + dur); f.Q.value = 6;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.22, t + dur);
    o.connect(f); o2.connect(f); f.connect(g).connect(dry);
    o.start(t); o2.start(t);
    return {
      stop() {
        const n = ctx.currentTime;
        g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.exponentialRampToValueAtTime(0.0001, n + 0.08);
        o.stop(n + 0.1); o2.stop(n + 0.1);
      },
    };
  },
  beam() {
    if (!on()) return;
    const t = ctx.currentTime;
    noise(t, 0.8, 'lowpass', 2500, 0.6, 1.0, 0.005, 0.7, 0.5); tone(t, 0.7, 'sawtooth', 220, 40, 0.35, 0.4); tone(t, 0.9, 'sine', 70, 25, 1.0);
  },
};

export function haptic(pattern) {
  if (!J('haptics') || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch { /* ignored */ }
}
