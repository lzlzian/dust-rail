// Touch/mouse input → control schemes. Each scheme is a small state machine over the "aim pointer".
import * as THREE from 'three';
import { G, clamp } from './state.js';
import { settings, SCHEMES, saveSettings } from './config.js';
import { initAudio, sfx, haptic } from './audio.js';
import { W, cur, fireAt, queueBurst, startVolley, ready, canShoot, startReload, selectWeapon } from './weapons.js';
import { pick, screenRay } from './combat.js';
import { tapRipple } from './hud.js';
import { railQuat, baseVFov } from './camera.js';
import { triggerAbility } from './abilities.js';

const S = { id: null, x: 0, y: 0, lastX: 0, lastY: 0, down: false, tagCool: 0, scopeHold: 0, mode: null, pending: null };
export const scheme = () => settings.schemes[cur().id];
const relative = s => s === 'drag-relative' || s === 'drag-autofire';
// Trackpad on a precision gun: hold = aim (sniper scope / revolver dead-eye / shotgun choke), release = fire.
// null for hold-to-fire guns (SMG, AR) or when the bench switches it off.
const aimMode = () => (scheme() === 'drag-relative' && settings.trackpadAim && cur().trackpad) || null;
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
  if (s === 'drag-relative') armAim();
}

function onMove(e) {
  if (e.pointerId !== S.id) return;
  const [x, y] = local(e);
  const dx = x - S.lastX, dy = y - S.lastY;
  S.lastX = x; S.lastY = y; S.x = x; S.y = y;
  const s = scheme();
  if (s === 'offset-hold' || s === 'paint') { G.aim.x = x; G.aim.y = y - offsetY(); }
  else if (G.aim.scoped && (s === 'scope' || S.mode === 'scope')) {
    const k = (G.view.hfovScoped * Math.PI / 180) / G.view.w * settings.scopeSensitivity;
    G.aim.scopeYaw += dx * k; G.aim.scopePitch = clamp(G.aim.scopePitch - dy * k, -1.2, 1.2);
  } else if (relative(s)) {
    G.aim.x = clamp(G.aim.x + dx * settings.sensitivity, 8, G.view.w - 8);
    G.aim.y = clamp(G.aim.y + dy * settings.sensitivity, 8, G.view.h - 8);
  }
}

function onUp(e) {
  if (e.pointerId !== S.id) return;
  S.id = null; S.down = false;
  const s = scheme();
  if (s === 'offset-hold') G.aim.visible = false;
  if (s === 'paint') { startVolley(G.aim.tags.map(t => t)); G.aim.visible = false; }
  if (s === 'drag-relative' && S.mode) releaseAim();
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

// ---- trackpad precision guns
// press: arm the gun's aim mode, or only reposition the reticle if it can't shoot yet (reloading / swapping)
function armAim() {
  S.mode = aimMode(); S.pending = null; S.holdT = 0;
  if (!S.mode) return;
  if (!canShoot()) { if (W.ammo[W.idx] <= 0) startReload(); S.mode = null; return; }
  if (S.mode === 'scope') beginScope(G.aim.x, G.aim.y - G.aim.climb);
  else if (S.mode === 'deadeye') { G.aim.tags.length = 0; W.volley = null; S.markKey = null; S.markT = 0; S.markN = 0; G.time.deadeye = true; sfx.deadeye(true); }
  else if (S.mode === 'choke') { G.aim.choke = 0; S.choked = false; }
}
// release: fire as soon as the gun is ready (the pump or bolt may still be cycling)
function releaseAim() {
  if (S.mode === 'deadeye') { G.time.deadeye = false; G.aim.markP = 0; sfx.deadeye(false); }
  S.pending = { m: S.mode, t: 1.2 }; S.mode = null;
  firePending();
}
function firePending() {
  const P = S.pending;
  if (!canShoot()) return endPending();
  if (W.cool > 0) return;
  S.pending = null;
  if (P.m === 'scope') { fireAt(G.view.w / 2, G.view.h / 2); S.fired = true; S.scopeHold = 0.32; }
  else if (P.m === 'deadeye') { if (G.aim.tags.length) startVolley(G.aim.tags); else fireAt(G.aim.x, G.aim.y); }
  else if (P.m === 'choke') { fireAt(G.aim.x, G.aim.y); G.aim.choke = null; }
}
function endPending() {
  if (S.pending?.m === 'scope') { G.aim.scoped = false; reticleFromScope(); }
  G.aim.choke = null; G.aim.tags.length = 0; S.pending = null;
}
// dead-eye: dwell on a hitbox (or projectile) to mark it; keep dwelling to stack another round on it
function updateDeadeye(rdt) {
  const D = settings.deadeye;
  S.holdT += rdt;
  const p = pick(G.aim.x, G.aim.y, settings.aimAssist * 0.5);
  const key = p.proj || p.hb || null;
  if (key !== S.markKey) { S.markKey = key; S.markT = 0; S.markN = 0; } else if (key) S.markT += rdt;
  G.aim.deadeyeAmmo = W.ammo[W.idx];
  const need = S.markN ? D.repeatTime : D.markTime, room = W.ammo[W.idx] - G.aim.tags.length;
  G.aim.markP = key && room > 0 ? clamp(S.markT / need, 0, 1) : 0;
  if (key && room > 0 && S.markT >= need) {
    G.aim.tags.push(p.proj ? { proj: p.proj } : { enemy: p.enemy, hb: p.hb });
    S.markT = 0; S.markN++; sfx.tag(); haptic([6]);
  }
  if (S.holdT >= D.max) releaseAim(); // dead-eye runs out: fire what's marked; the finger can keep dragging
}
// after a trackpad scope shot, leave the reticle on the spot you were scoped on
function reticleFromScope() {
  const f = (G.view.h / 2) / Math.tan(baseVFov(G.view.w / G.view.h) * Math.PI / 360);
  G.aim.x = clamp(G.view.w / 2 + f * Math.tan(G.aim.scopeYaw), 8, G.view.w - 8);
  G.aim.y = clamp(G.view.h / 2 - f * Math.tan(G.aim.scopePitch) / Math.cos(G.aim.scopeYaw), 8, G.view.h - 8);
}

export function cancelAim() {
  S.id = null; S.down = false; G.aim.visible = false; G.aim.scoped = false; G.aim.tags.length = 0; S.scopeHold = 0;
  S.mode = null; S.pending = null; G.aim.choke = null; G.aim.markP = 0;
  if (G.time.deadeye) { G.time.deadeye = false; sfx.deadeye(false); }
}

// called every frame with player dt
export function updateInput(dt, rdt) {
  const s = scheme();
  G.aim.flashT = Math.max(0, (G.aim.flashT ?? 0) - rdt);
  if (relative(s)) G.aim.visible = true;
  else if (s === 'tap' || s === 'tap-burst') G.aim.visible = G.aim.flashT > 0 || !!W.burst;
  else if (s === 'scope') G.aim.visible = false;
  if (s !== 'scope' && aimMode() !== 'scope' && G.aim.scoped) G.aim.scoped = false;
  if (!active()) { if (G.aim.scoped && !S.down) G.aim.scoped = false; return; }

  if ((s === 'offset-hold' || (s === 'drag-relative' && !aimMode())) && S.down) fireAt(G.aim.x, G.aim.y);
  if (S.mode && S.mode !== aimMode()) { const d = S.down; cancelAim(); S.down = d; } // gun or scheme changed mid-hold
  if (S.pending) { S.pending.t -= rdt; if (S.pending.t <= 0) endPending(); else firePending(); }
  if (S.down && S.mode === 'deadeye') updateDeadeye(rdt);
  if (S.down && S.mode === 'choke') {
    G.aim.choke = Math.min(1, G.aim.choke + rdt / cur().choke.time);
    if (G.aim.choke >= 1 && !S.choked) { S.choked = true; sfx.choke(); haptic([8]); }
  }

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

  if (G.aim.scoped && S.scopeHold > 0 && !S.down && !S.pending) {
    S.scopeHold -= rdt;
    if (S.scopeHold <= 0) { G.aim.scoped = false; if (s === 'drag-relative') reticleFromScope(); }
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
