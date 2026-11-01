// Touch/mouse input → trackpad aim (Nikke-style). The reticle stays wherever you left it; touch anywhere and drag to
// move it relatively, like a laptop trackpad. Holding the trigger on a gun with a sight raises it (aim down sights):
// the view turns onto the reticle and zooms, and from then on you aim with the sight itself.
//   SMG:      no sight, hold = hip fire from the reticle.
//   AR / revolver: hold = raise the iron sights, then fire while held.
//   shotgun:  hold = raise (down the rib) + choke the pattern, release = fire.
//   sniper:   hold = scope in on the reticle, drag = fine aim, release = fire.
import * as THREE from 'three';
import { G, clamp, lerp } from './state.js';
import { settings, sightOf, sightZoom, sightRaise } from './config.js';
import { initAudio, sfx, haptic } from './audio.js';
import { W, cur, fireAt, canShoot, startReload, selectWeapon } from './weapons.js';
import { screenRay } from './combat.js';
import { railQuat, baseVFov, panning } from './camera.js';
import { triggerAbility } from './abilities.js';

const S = { id: null, lastX: 0, lastY: 0, down: false, armed: false, gun: -1, raise: 0, linger: 0, pending: null, choked: false, home: null };
const onRelease = w => w.trigger === 'release';
// guns where a press does something beyond "fire now": raise a sight and/or wait for the release
const holdsToAim = w => !!sightOf(w) || onRelease(w);

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
}

function onDown(e) {
  initAudio();
  if (!active()) return;
  e.preventDefault();
  if (S.id !== null) return; // one aim finger at a time
  const [x, y] = local(e);
  S.id = e.pointerId; S.down = true; S.lastX = x; S.lastY = y;
  S.home = null; // touching takes the reticle back from a re-centre glide
  try { e.target.setPointerCapture(e.pointerId); } catch { /* */ }
  arm();
}

function onMove(e) {
  if (e.pointerId !== S.id) return;
  const [x, y] = local(e);
  const dx = x - S.lastX, dy = y - S.lastY;
  S.lastX = x; S.lastY = y;
  if (G.aim.ads) {
    // sighted: the drag turns the view; one px of finger moves the (zoomed) world by about `sens` px
    const scope = G.aim.sight.type === 'scope';
    const k = (G.view.hfovAds * Math.PI / 180) / G.view.w * (scope ? settings.scopeSensitivity : settings.sightSensitivity);
    G.aim.adsYaw += dx * k; G.aim.adsPitch = clamp(G.aim.adsPitch - dy * k, -1.2, 1.2);
  } else {
    G.aim.x = clamp(G.aim.x + dx * settings.sensitivity, 8, G.view.w - 8);
    G.aim.y = clamp(G.aim.y + dy * settings.sensitivity, 8, G.view.h - 8);
  }
}

function onUp(e) {
  if (e.pointerId !== S.id) return;
  S.id = null; S.down = false;
  if (S.armed) release();
}

// ---- hold-to-aim guns
// press: raise the sight / start the choke. If the gun can't shoot yet (reloading, swapping, mid-pan) the finger only
// moves the reticle, and the hold arms itself the moment the gun is ready.
function arm() {
  const w = cur(), sight = sightOf(w);
  S.armed = false; S.pending = null;
  if (!holdsToAim(w)) return;
  if (!canShoot() || panning()) { if (W.ammo[W.idx] <= 0) startReload(); return; }
  S.armed = true; S.gun = W.idx;
  if (sight) raiseSight(sight);
  if (w.choke) { G.aim.choke = 0; S.choked = false; }
}
// release: fire-on-release guns shoot as soon as they're ready (the pump or bolt may still be cycling); hold-fire guns
// just lower the sight
function release() {
  S.armed = false;
  if (onRelease(cur())) { S.pending = { t: 1.2 }; firePending(); }
  else if (G.aim.ads) lowerSight();
}
function firePending() {
  if (!canShoot()) return endPending();
  if (W.cool > 0) return;
  S.pending = null;
  if (G.aim.ads) { fireAt(G.view.w / 2, G.view.h / 2); S.linger = G.aim.sight.linger ?? 0; } // stay up so you see it land
  else fireAt(G.aim.x, G.aim.y);
  G.aim.choke = null;
}
function endPending() {
  if (G.aim.ads) lowerSight();
  G.aim.choke = null; S.pending = null;
}

const _l = new THREE.Vector3(), _q = new THREE.Quaternion();
function raiseSight(sight) {
  // aim the sight exactly where the reticle is drawn (climb included), then let the camera carry the climb
  const { d } = screenRay(G.aim.x, G.aim.y - G.aim.climb);
  _l.copy(d).applyQuaternion(_q.copy(railQuat()).invert());
  G.aim.adsYaw = Math.atan2(_l.x, -_l.z);
  G.aim.adsPitch = Math.asin(clamp(_l.y, -1, 1));
  G.aim.climb = 0;
  G.aim.ads = true; G.aim.sight = sight; G.aim.adsZoom = sightZoom(sight);
  S.raise = 0; S.linger = 0;
  sfx.raise(sight.type === 'scope'); haptic([5]);
}
// lowering the sight leaves the reticle on the spot the sight was on
function lowerSight() {
  G.aim.ads = false; S.linger = 0;
  const f = (G.view.h / 2) / Math.tan(baseVFov(G.view.w / G.view.h) * Math.PI / 360);
  G.aim.x = clamp(G.view.w / 2 + f * Math.tan(G.aim.adsYaw), 8, G.view.w - 8);
  G.aim.y = clamp(G.view.h / 2 - f * Math.tan(G.aim.adsPitch) / Math.cos(G.aim.adsYaw), 8, G.view.h - 8);
}

// forget the finger and drop any sight without firing (cover, gun swap, scene change, run start)
export function cancelAim() {
  S.id = null; S.down = false; S.armed = false; S.pending = null; S.linger = 0;
  G.aim.ads = false; G.aim.choke = null;
}

// put the reticle back in the middle of the screen: glide over `dur` seconds (0 = snap). Called on every scene change
// (run start, new area, beat pan) so each new view starts from a known, centred reticle.
export function recenterAim(dur = 0) {
  cancelAim();
  if (dur <= 0 || !G.view.w) { S.home = null; G.aim.x = G.view.w / 2; G.aim.y = G.view.h / 2; return; }
  S.home = { x: G.aim.x, y: G.aim.y, t: 0, dur };
}

// called every frame with player dt
export function updateInput(dt, rdt) {
  G.aim.visible = true;
  if (S.home) {
    S.home.t += rdt;
    const u = clamp(S.home.t / S.home.dur, 0, 1), e = 1 - (1 - u) ** 3;
    G.aim.x = lerp(S.home.x, G.view.w / 2, e); G.aim.y = lerp(S.home.y, G.view.h / 2, e);
    if (u >= 1) S.home = null;
  }
  G.aim.x = clamp(G.aim.x, 8, G.view.w - 8); G.aim.y = clamp(G.aim.y, 8, G.view.h - 8); // survives a resize / rotation
  if (!active()) { if (G.aim.ads && !S.down) G.aim.ads = false; return; }

  const w = cur();
  if (S.armed && S.gun !== W.idx) { S.armed = false; S.pending = null; G.aim.choke = null; if (G.aim.ads) lowerSight(); } // swapped mid-hold
  if (G.aim.ads && S.armed && !canShoot()) { S.armed = false; G.aim.choke = null; lowerSight(); } // ran dry: sights come down to reload
  if (S.down && !S.armed && holdsToAim(w) && canShoot() && !panning()) arm(); // still holding once the gun is ready

  if (G.aim.ads) S.raise += dt;
  if (S.down && !onRelease(w)) {
    if (!sightOf(w)) fireAt(G.aim.x, G.aim.y); // hip fire
    else if (G.aim.ads && S.raise >= sightRaise(G.aim.sight)) fireAt(G.view.w / 2, G.view.h / 2);
  }
  if (S.pending) { S.pending.t -= rdt; if (S.pending.t <= 0) endPending(); else firePending(); }
  if (S.down && S.armed && w.choke) {
    G.aim.choke = Math.min(1, G.aim.choke + rdt / w.choke.time);
    if (G.aim.choke >= 1 && !S.choked) { S.choked = true; sfx.choke(); haptic([8]); }
  }
  if (G.aim.ads && S.linger > 0 && !S.down && !S.pending) {
    S.linger -= rdt;
    if (S.linger <= 0) lowerSight();
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
