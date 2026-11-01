// Weapon definitions and persisted test-bench settings.

// trackpad = what holding does on a hold-to-aim gun ('scope' | 'choke'); guns without it fire while held.
// j = juice profile. Every value is scaled by settings.juice.master and gated by the per-layer toggles.
//   shake: camera trauma per shot       kick: camera pitch kick (deg)      recZ/recRot: viewmodel recoil
//   hitstop: freeze on hit (s)          killstop: freeze on kill (s)       fov: FOV punch (deg)
//   flash: muzzle flash scale           tracer: tracer width               haptic: navigator.vibrate pattern
export const WEAPONS = [
  {
    id: 'revolver', name: 'HAND CANNON', kind: 'semi',
    reloadSeq: [[0, 'cylOpen'], [0.1, 'eject'], [0.5, 'speedload'], [0.74, 'cylClose'], [0.82, 'spin']],
    dmg: 48, crit: 2.2, rpm: 190, mag: 6, reload: 1.35, spread: 0.25, bloom: 0, bloomPer: 0, pellets: 1, range: 150, force: 3, climb: 0,
    j: { shake: 0.32, kick: 1.6, recZ: 0.12, recRot: 0.6, hitstop: 0.035, killstop: 0.07, fov: 1.5, flash: 1.3, tracer: 0.06, tracerColor: 0xffd36b, haptic: [22], sound: 'revolver' },
    look: { body: 0x7a7f8a, accent: 0xd09a34, grip: 0x5e3419 },
  },
  {
    id: 'smg', name: 'BUZZSAW SMG', kind: 'auto',
    reloadSeq: [[0.02, 'magOut'], [0.55, 'magIn'], [0.8, 'rack']],
    dmg: 9, crit: 1.8, rpm: 840, mag: 42, reload: 1.5, spread: 1.2, bloom: 1.6, bloomPer: 0.1, pellets: 1, range: 90, force: 0.6, climb: 0.8, climbMax: 12,
    j: { shake: 0.075, kick: 0.22, recZ: 0.035, recRot: 0.14, hitstop: 0, killstop: 0.03, fov: 0, flash: 0.7, tracer: 0.025, tracerColor: 0xfff0a0, haptic: [7], sound: 'smg' },
    look: { body: 0x3b8f6a, accent: 0xf2e04a, grip: 0x2a2a2a },
  },
  {
    id: 'ar', name: 'RANGER AR', kind: 'auto',
    reloadSeq: [[0.02, 'magOut'], [0.5, 'magIn'], [0.78, 'rack']],
    dmg: 17, crit: 2, rpm: 560, mag: 30, reload: 1.75, spread: 0.6, bloom: 1.4, bloomPer: 0.12, pellets: 1, range: 140, force: 1.2, climb: 2, climbMax: 20,
    j: { shake: 0.12, kick: 0.5, recZ: 0.05, recRot: 0.24, hitstop: 0, killstop: 0.04, fov: 0.3, flash: 0.9, tracer: 0.035, tracerColor: 0xffc860, haptic: [11], sound: 'ar' },
    look: { body: 0x4a5a78, accent: 0xff7a2a, grip: 0x232323 },
  },
  {
    id: 'shotgun', name: 'BOOMSTICK', kind: 'semi',
    reloadSeq: [[0.1, 'shell'], [0.27, 'shell'], [0.44, 'shell'], [0.61, 'shell'], [0.8, 'pump']],
    dmg: 13, crit: 1.6, rpm: 78, mag: 6, reload: 1.9, spread: 5.5, bloom: 0, bloomPer: 0, pellets: 9, range: 45, falloff: [8, 26], force: 6, climb: 0,
    trackpad: 'choke', choke: { min: 1.5, time: 0.5, reach: 1.8 }, // hold = pattern tightens (spread → min deg, falloff × reach), release = fire
    j: { shake: 0.55, kick: 3.2, recZ: 0.2, recRot: 0.95, hitstop: 0.05, killstop: 0.08, fov: 4, flash: 1.9, tracer: 0.03, tracerColor: 0xffb050, haptic: [38], sound: 'shotgun', pump: true },
    look: { body: 0x8a5a32, accent: 0xb9b9b9, grip: 0x6e3b1c },
  },
  {
    id: 'sniper', name: 'LONGSHOT', kind: 'scope',
    reloadSeq: [[0, 'boltUp'], [0.07, 'boltBack'], [0.25, 'magOut'], [0.58, 'magIn'], [0.78, 'boltFwd'], [0.87, 'boltDown']],
    dmg: 140, crit: 2.5, rpm: 50, mag: 5, reload: 2.2, spread: 0, bloom: 0, bloomPer: 0, pellets: 1, range: 300, force: 8, climb: 0, pierce: true, zoom: 3.5,
    trackpad: 'scope', // hold = scope in on the reticle, drag = fine aim, release = fire
    j: { shake: 0.45, kick: 2.6, recZ: 0.22, recRot: 0.8, hitstop: 0.06, killstop: 0.13, fov: 3, flash: 1.6, tracer: 0.07, tracerColor: 0x9ff3ff, haptic: [45], sound: 'sniper', bolt: true },
    look: { body: 0x2f3440, accent: 0x4fe3ff, grip: 0x3a2a20 },
  },
];

export const DEFAULTS = {
  aspect: 'fill',            // fill | portrait | landscape  (simulated frames, for desktop comparison)
  fovFit: 'auto',            // auto = horizontal fit in portrait, vertical fit in landscape | horizontal | vertical
  hFov: 60, vFov: 56, maxVFov: 108,
  sensitivity: 1.5, scopeSensitivity: 0.55, recoilClimb: 1, spreadPattern: 'center',
  aimAssist: 34, projHitMult: 1.8, projAssist: 1.6, scopeSway: 1,
  // arcade camera: each stop is split into beats (front / flanks); at a lull it cues, then pans to the next one
  look: { panSpeed: 75, cueTime: 0.45 },
  tele: { glow: true, ring: true, laser: true, outline: true, icon: true, offscreen: true, audio: true, haptic: true, slowmo: false },
  juice: { master: 1, shake: true, recoil: true, kick: true, flash: true, tracers: true, numbers: true, hitstop: true, gibs: true, markers: true, shells: true, haptics: true, lean: false, fovPunch: true, sound: true, impact: true },
  hud: { layout: 'bottom', buttonSize: 62, thumbZones: 'off', hitboxes: false, targetPx: false, viewmodel: true, vmScale: 1, projMarkers: true, offscreenEnemies: true },
  game: { god: false, enemyDmg: 1, projSpeed: 1, gameSpeed: 1, attackTokens: 2 },
  volume: 0.7,
};

const KEY = 'dustrail.settings.v2';
const OLD_KEY = 'dustrail.settings.v1'; // v1 → v2: the look-around defaults changed (beat camera), so v1's look block is dropped

function merge(base, over) {
  if (!over || typeof over !== 'object') return structuredClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(base)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = merge(base[k], over[k]);
    else if (k in over && typeof over[k] === typeof base[k]) out[k] = over[k];
  }
  return out;
}

export const settings = (() => {
  try {
    let saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) { saved = JSON.parse(localStorage.getItem(OLD_KEY)); if (saved) delete saved.look; }
    return merge(DEFAULTS, saved);
  } catch { return structuredClone(DEFAULTS); }
})();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

export function resetSettings() {
  const fresh = structuredClone(DEFAULTS);
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, fresh);
  saveSettings();
}

export function getPath(obj, path) { return path.split('.').reduce((o, k) => o?.[k], obj); }
export function setPath(obj, path, v) {
  const ks = path.split('.'); const last = ks.pop();
  ks.reduce((o, k) => o[k], obj)[last] = v;
}

// juice scale helper: 0 when a layer is off, otherwise the master multiplier
export function J(layer) { return settings.juice[layer] ? settings.juice.master : 0; }
