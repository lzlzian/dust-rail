// Touch/mouse input → the trackpad aim scheme (Nikke-style). The reticle stays wherever you left it; touch anywhere
// and drag to move it relatively, like a laptop trackpad.
//   SMG / AR / revolver: hold = fire.
//   sniper:  hold = scope in on the reticle, drag = fine aim, release = fire.
//   shotgun: hold = choke (the pattern tightens), release = fire.
import * as THREE from 'three';
import { G, clamp } from './state.js';
import { settings } from './config.js';
import { initAudio, sfx, haptic } from './audio.js';
import { W, cur, fireAt, canShoot, startReload, selectWeapon } from './weapons.js';
import { screenRay } from './combat.js';
import { railQuat, baseVFov } from './camera.js';
import { triggerAbility } from './abilities.js';

const S = { id: null, lastX: 0, lastY: 0, down: false, scopeHold: 0, mode: null, pending: null };
// hold-to-aim guns name their mode in config (trackpad: 'scope' | 'choke'); everything else fires while held
const aimMode = () => cur().trackpad ?? null;

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
  G.aim.x = G.view.w / 2; G.aim.y = G.view.h * 0.45;
}

function onDown(e) {
  initAudio();
  if (!active()) return;
  e.preventDefault();
  if (S.id !== null) return; // one aim finger at a time
  const [x, y] = local(e);
  S.id = e.pointerId; S.down = true; S.lastX = x; S.lastY = y;
  try { e.target.setPointerCapture(e.pointerId); } catch { /* */ }
  armAim();
}

function onMove(e) {
  if (e.pointerId !== S.id) return;
  const [x, y] = local(e);
  const dx = x - S.lastX, dy = y - S.lastY;
  S.lastX = x; S.lastY = y;
  if (G.aim.scoped && S.mode === 'scope') {
    const k = (G.view.hfovScoped * Math.PI / 180) / G.view.w * settings.scopeSensitivity;
    G.aim.scopeYaw += dx * k; G.aim.scopePitch = clamp(G.aim.scopePitch - dy * k, -1.2, 1.2);
  } else {
    G.aim.x = clamp(G.aim.x + dx * settings.sensitivity, 8, G.view.w - 8);
    G.aim.y = clamp(G.aim.y + dy * settings.sensitivity, 8, G.view.h - 8);
  }
}

function onUp(e) {
  if (e.pointerId !== S.id) return;
  S.id = null; S.down = false;
  if (S.mode) releaseAim();
}

// ---- hold-to-aim guns
// press: arm the gun's aim mode, or only reposition the reticle if it can't shoot yet (reloading / swapping)
function armAim() {
  S.mode = aimMode(); S.pending = null;
  if (!S.mode) return;
  if (!canShoot()) { if (W.ammo[W.idx] <= 0) startReload(); S.mode = null; return; }
  if (S.mode === 'scope') beginScope(G.aim.x, G.aim.y - G.aim.climb);
  else if (S.mode === 'choke') { G.aim.choke = 0; S.choked = false; }
}
// release: fire as soon as the gun is ready (the pump or bolt may still be cycling)
function releaseAim() {
  S.pending = { m: S.mode, t: 1.2 }; S.mode = null;
  firePending();
}
function firePending() {
  const P = S.pending;
  if (!canShoot()) return endPending();
  if (W.cool > 0) return;
  S.pending = null;
  if (P.m === 'scope') { fireAt(G.view.w / 2, G.view.h / 2); S.scopeHold = 0.32; } // linger zoomed so you see the hit land
  else if (P.m === 'choke') { fireAt(G.aim.x, G.aim.y); G.aim.choke = null; }
}
function endPending() {
  if (S.pending?.m === 'scope') { G.aim.scoped = false; reticleFromScope(); }
  G.aim.choke = null; S.pending = null;
}

const _l = new THREE.Vector3(), _q = new THREE.Quaternion();
function beginScope(x, y) {
  const { d } = screenRay(x, y);
  _l.copy(d).applyQuaternion(_q.copy(railQuat()).invert());
  G.aim.scopeYaw = Math.atan2(_l.x, -_l.z);
  G.aim.scopePitch = Math.asin(clamp(_l.y, -1, 1));
  G.aim.scoped = true; S.scopeHold = 0;
  sfx.ui();
}
// after a scope shot, leave the reticle on the spot you were scoped on
function reticleFromScope() {
  const f = (G.view.h / 2) / Math.tan(baseVFov(G.view.w / G.view.h) * Math.PI / 360);
  G.aim.x = clamp(G.view.w / 2 + f * Math.tan(G.aim.scopeYaw), 8, G.view.w - 8);
  G.aim.y = clamp(G.view.h / 2 - f * Math.tan(G.aim.scopePitch) / Math.cos(G.aim.scopeYaw), 8, G.view.h - 8);
}

export function cancelAim() {
  S.id = null; S.down = false; G.aim.scoped = false; S.scopeHold = 0;
  S.mode = null; S.pending = null; G.aim.choke = null;
}

// called every frame with player dt
export function updateInput(dt, rdt) {
  G.aim.visible = true;
  if (aimMode() !== 'scope' && G.aim.scoped) G.aim.scoped = false;
  if (!active()) { if (G.aim.scoped && !S.down) G.aim.scoped = false; return; }

  if (S.mode && S.mode !== aimMode()) { const d = S.down; cancelAim(); S.down = d; } // gun changed mid-hold
  if (S.down && !aimMode()) fireAt(G.aim.x, G.aim.y);
  if (S.pending) { S.pending.t -= rdt; if (S.pending.t <= 0) endPending(); else firePending(); }
  if (S.down && S.mode === 'choke') {
    G.aim.choke = Math.min(1, G.aim.choke + rdt / cur().choke.time);
    if (G.aim.choke >= 1 && !S.choked) { S.choked = true; sfx.choke(); haptic([8]); }
  }
  if (G.aim.scoped && S.scopeHold > 0 && !S.down && !S.pending) {
    S.scopeHold -= rdt;
    if (S.scopeHold <= 0) { G.aim.scoped = false; reticleFromScope(); }
  }
}

// ---- desktop keyboard (handy for quick testing in a browser)
const KEYS = { Space: 'cover', KeyQ: 'grenade', KeyE: 'focus', KeyF: 'medkit' };
function onKey(e) {
  if (!active() || e.repeat) return;
  if (e.code.startsWith('Digit')) { const n = +e.code.slice(5) - 1; if (n >= 0 && n < 5) selectWeapon(n); }
  if (e.code === 'KeyR') startReload();
  if (KEYS[e.code]) { e.preventDefault(); triggerAbility(KEYS[e.code], true, G.aim.x, G.aim.y); }
}
function onKeyUp(e) {
  if (KEYS[e.code] === 'cover') triggerAbility('cover', false);
}
