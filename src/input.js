// Touch/mouse input → control schemes. Each scheme is a small state machine over the "aim pointer".
import * as THREE from 'three';
import { G, clamp } from './state.js';
import { settings, SCHEMES, saveSettings } from './config.js';
import { initAudio, sfx } from './audio.js';
import { W, cur, fireAt, queueBurst, startVolley, ready, canShoot, startReload, selectWeapon } from './weapons.js';
import { pick, screenRay } from './combat.js';
import { tapRipple } from './hud.js';
import { railQuat } from './camera.js';
import { triggerAbility } from './abilities.js';

const S = { id: null, x: 0, y: 0, lastX: 0, lastY: 0, down: false, tagCool: 0, scopeHold: 0 };
export const scheme = () => settings.schemes[cur().id];
const relative = s => s === 'drag-relative' || s === 'drag-autofire';
const offsetY = () => settings.reticleOffset;

let frameEl;
function local(e) {
  const r = frameEl.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
const active = () => (G.mode === 'run' || G.mode === 'range') && !G.paused && G.player.alive;

export function initInput(canvas, frame) {
  frameEl = frame;
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => held.clear());
  G.aim.x = G.view.w / 2; G.aim.y = G.view.h * 0.45;
}

function onDown(e) {
  initAudio();
  if (!active()) return;
  e.preventDefault();
  const [x, y] = local(e);
  const s = scheme(), w = cur();
  if (s === 'tap' || s === 'tap-burst') {
    tapRipple(x, y);
    if (s === 'tap') { if (!fireAt(x, y) && canShoot()) W.buffer = { x, y, t: 0.2 }; }
    else queueBurst(x, y, w.burst ?? 3);
    G.aim.x = x; G.aim.y = y; G.aim.flashT = s === 'tap' ? 0.25 : 0.35;
    // a held finger still counts for edge panning
    if (S.id === null) { S.id = e.pointerId; S.down = true; S.x = S.lastX = x; S.y = S.lastY = y; }
    return;
  }
  if (S.id !== null) return; // one aim finger at a time
  S.id = e.pointerId; S.down = true; S.x = S.lastX = x; S.y = S.lastY = y;
  try { e.target.setPointerCapture(e.pointerId); } catch { /* */ }
  if (s === 'offset-hold' || s === 'paint') { G.aim.x = x; G.aim.y = y - offsetY(); G.aim.visible = true; }
  if (s === 'paint') { G.aim.tags.length = 0; S.tagCool = 0; W.volley = null; }
  if (s === 'scope') beginScope(x, y);
}

function onMove(e) {
  if (e.pointerId !== S.id) return;
  const [x, y] = local(e);
  const dx = x - S.lastX, dy = y - S.lastY;
  S.lastX = x; S.lastY = y; S.x = x; S.y = y;
  const s = scheme();
  if (s === 'offset-hold' || s === 'paint') { G.aim.x = x; G.aim.y = y - offsetY(); }
  else if (relative(s)) {
    G.aim.x = clamp(G.aim.x + dx * settings.sensitivity, 8, G.view.w - 8);
    G.aim.y = clamp(G.aim.y + dy * settings.sensitivity, 8, G.view.h - 8);
  } else if (s === 'scope' && G.aim.scoped) {
    const k = (G.view.hfovScoped * Math.PI / 180) / G.view.w * settings.scopeSensitivity;
    G.aim.scopeYaw += dx * k; G.aim.scopePitch = clamp(G.aim.scopePitch - dy * k, -1.2, 1.2);
  }
}

function onUp(e) {
  if (e.pointerId !== S.id) return;
  S.id = null; S.down = false;
  const s = scheme();
  if (s === 'offset-hold') G.aim.visible = false;
  if (s === 'paint') { startVolley(G.aim.tags.map(t => t)); G.aim.visible = false; }
  if (s === 'scope' && G.aim.scoped && !S.fired) {
    if (!fireAt(G.view.w / 2, G.view.h / 2) && W.ammo[W.idx] <= 0) startReload();
    S.fired = true;
    S.scopeHold = 0.32; // linger zoomed so you see the hit land
  }
}

const _l = new THREE.Vector3(), _q = new THREE.Quaternion();
function beginScope(x, y) {
  if (!canShoot()) { if (W.ammo[W.idx] <= 0) startReload(); S.id = null; S.down = false; return; }
  const { d } = screenRay(x, y);
  _l.copy(d).applyQuaternion(_q.copy(railQuat()).invert());
  G.aim.scopeYaw = Math.atan2(_l.x, -_l.z);
  G.aim.scopePitch = Math.asin(clamp(_l.y, -1, 1));
  G.aim.scoped = true; S.fired = false; S.scopeHold = 0;
  sfx.ui();
}

export function cancelAim() {
  S.id = null; S.down = false; G.aim.visible = false; G.aim.scoped = false; G.aim.tags.length = 0; S.scopeHold = 0;
}

// called every frame with player dt
export function updateInput(dt, rdt) {
  const s = scheme();
  G.aim.flashT = Math.max(0, (G.aim.flashT ?? 0) - rdt);
  if (relative(s)) G.aim.visible = true;
  else if (s === 'tap' || s === 'tap-burst') G.aim.visible = G.aim.flashT > 0 || !!W.burst;
  else if (s === 'scope') G.aim.visible = false;
  if (s !== 'scope' && G.aim.scoped) G.aim.scoped = false;
  if (!active()) { if (G.aim.scoped && !S.down) G.aim.scoped = false; return; }

  if ((s === 'offset-hold' || s === 'drag-relative') && S.down) fireAt(G.aim.x, G.aim.y);

  if (s === 'drag-autofire') {
    const p = pick(G.aim.x, G.aim.y - G.aim.climb, settings.aimAssist * 0.6);
    const on = !!(p.enemy || p.proj);
    G.aim.autoT = on ? G.aim.autoT + dt : 0;
    G.aim.onTarget = on;
    if (on && G.aim.autoT >= settings.autoFireDelay) fireAt(G.aim.x, G.aim.y);
  } else G.aim.onTarget = false;

  if (s === 'paint' && S.down) {
    S.tagCool -= dt;
    const p = pick(G.aim.x, G.aim.y, settings.aimAssist);
    const room = W.ammo[W.idx] - G.aim.tags.length;
    if ((p.enemy || p.proj) && S.tagCool <= 0 && room > 0 && canShoot()) {
      G.aim.tags.push(p.proj ? { proj: p.proj } : { enemy: p.enemy, hb: p.hb });
      S.tagCool = 60 / cur().rpm * 1.4;
      sfx.tag();
    }
  }

  if (s === 'scope' && G.aim.scoped && S.scopeHold > 0 && !S.down) {
    S.scopeHold -= rdt;
    if (S.scopeHold <= 0) G.aim.scoped = false;
  }
}

export function cycleScheme(dir = 1) {
  const w = cur(), list = w.schemes;
  const i = list.indexOf(settings.schemes[w.id]);
  settings.schemes[w.id] = list[(i + dir + list.length) % list.length];
  saveSettings();
  cancelAim();
  W.burst = null; W.volley = null;
  return SCHEMES[settings.schemes[w.id]];
}

// ---- desktop keyboard (handy for quick testing in a browser)
const KEYS = { Space: 'cover', KeyQ: 'grenade', KeyE: 'focus', KeyF: 'medkit' };
function onKey(e) {
  if (/^(Arrow(Left|Right)|Key[AD])$/.test(e.code)) { held.add(e.code); e.preventDefault(); }
  if (!active() || e.repeat) return;
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < 5) selectWeapon(n); }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Tab') { e.preventDefault(); cycleScheme(1); }
  if (KEYS[e.code]) { e.preventDefault(); triggerAbility(KEYS[e.code], true, G.aim.x, G.aim.y); }
}
function onKeyUp(e) {
  held.delete(e.code);
  if (KEYS[e.code] === 'cover') triggerAbility('cover', false);
}
export const aimPointerDown = () => S.down;

// where a held finger (or the dragged reticle) is, for edge panning
export function panPoint() {
  if (!S.down) return null;
  const s = scheme();
  if (s === 'scope') return null;
  return relative(s) ? { x: G.aim.x, y: G.aim.y } : { x: S.x, y: S.y };
}
const held = new Set();
export const keyPan = () => (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0) - (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0);
export const readyToFire = ready;
