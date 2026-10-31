// Final camera = rail pose + look offset (auto-frame / edge push / keys / gyro) + cover duck
// + scope offset + aim lean + kick + trauma shake + FOV punch.
import * as THREE from 'three';
import { G, clamp, damp } from './state.js';
import { settings, WEAPONS, J } from './config.js';
import { camFx } from './fx.js';
import { panPoint, keyPan, aimPointerDown } from './input.js';

export const rig = { pos: new THREE.Vector3(0, 1.7, 0), quat: new THREE.Quaternion(), moving: false, speed: 0 };

const D2R = Math.PI / 180;
const st = { yaw: 0, pitch: 0, zoom: 0, leanX: 0, leanY: 0, fov: 60, t: 0, swayT: 0, lookYaw: 0, lookPitch: 0, manualT: 9, idleT: 0 };
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3(), _inv = new THREE.Quaternion();
const lookQ = new THREE.Quaternion();

// rail orientation + the player's/director's look offset: the "base" every aim calculation starts from
export const railQuat = () => lookQ;
export const lookState = () => st;

// vertical FOV (deg) for an aspect, honouring the fit mode
export function baseVFov(aspect) {
  const fit = settings.fovFit === 'auto' ? (aspect < 1 ? 'horizontal' : 'vertical') : settings.fovFit;
  if (fit === 'horizontal') {
    const v = 2 * Math.atan(Math.tan(settings.hFov * D2R / 2) / aspect) / D2R;
    return Math.min(v, settings.maxVFov);
  }
  return settings.vFov;
}

const n1 = (t, s) => Math.sin(t * 13.1 + s) * 0.55 + Math.sin(t * 27.7 + s * 1.7) * 0.3 + Math.sin(t * 51.3 + s * 3.1) * 0.15;

// ------------------------------------------------------------------ look / panning
// gyro: integrate rotation rate, remapped for the current screen orientation
let gyroYaw = 0, gyroPitch = 0;
function onMotion(e) {
  const r = e.rotationRate;
  if (!r || !settings.look.gyro) return;
  const a = (screen.orientation?.angle ?? window.orientation ?? 0) % 360;
  let yawRate, pitchRate;
  if (a === 90) { yawRate = -r.beta; pitchRate = -r.gamma; }
  else if (a === 270 || a === -90) { yawRate = r.beta; pitchRate = r.gamma; }
  else { yawRate = -r.gamma; pitchRate = r.beta; }
  const k = settings.look.gyroSens * (settings.look.gyroInvert ? -1 : 1);
  const dt = (e.interval > 1 ? e.interval / 1000 : e.interval) || 1 / 60;
  gyroYaw += (yawRate || 0) * dt * k; gyroPitch += (pitchRate || 0) * dt * k;
}
window.addEventListener('devicemotion', onMotion);

// iOS needs a user gesture + permission prompt before motion events flow
export async function enableGyro() {
  const DM = window.DeviceMotionEvent;
  if (DM && typeof DM.requestPermission === 'function') {
    try { if ((await DM.requestPermission()) !== 'granted') return false; } catch { return false; }
  }
  return !!DM;
}

// pick the look yaw that keeps the most weight on screen (charging enemies and incoming projectiles weigh more)
function director(halfFov, dt) {
  _inv.copy(rig.quat).invert();
  const items = [];
  const add = (p, w, o) => {
    _v.copy(p).sub(rig.pos).applyQuaternion(_inv);
    if (_v.z > -0.5) return null; // behind the rail
    const it = { yaw: Math.atan2(_v.x, -_v.z), w };
    items.push(it);
    return it;
  };
  for (const e of G.enemies) {
    if (!e.alive || !e.root.visible || !e.counts || !e.targetable) continue;
    // weight: charging >> boss > shooting at you > idle; anything left off-screen slowly gains weight so the camera checks on it
    const it = add(e.hitboxes[0].c, e.charge ? 5 : e.isBoss ? 3 : e.attack ? 2 : 1);
    if (!it) continue;
    e.offT = Math.abs(it.yaw - st.lookYaw) > halfFov ? (e.offT ?? 0) + dt : 0;
    it.w += Math.min(2.5, e.offT / 2.5);
  }
  for (const p of G.projectiles) if (p.alive) add(p.pos, p.eta < 1.5 ? 3 : 1.5);
  if (!items.length) { st.idleT += dt; return st.idleT > 1.5 ? 0 : st.lookYaw; }
  st.idleT = 0;
  const range = settings.look.range * D2R, half = halfFov * 0.8;
  const cands = [st.lookYaw, 0];
  for (const it of items) cands.push(it.yaw, it.yaw - half * 0.9, it.yaw + half * 0.9);
  let best = st.lookYaw, bestS = -Infinity;
  for (let c of cands) {
    c = clamp(c, -range, range);
    let s = 0;
    for (const it of items) if (Math.abs(it.yaw - c) <= half) s += it.w;
    s -= Math.abs(c - st.lookYaw) * 0.6 + Math.abs(c) * 0.15; // stay put / stay central when it doesn't matter
    if (s > bestS) { bestS = s; best = c; }
  }
  return best;
}

function updateLook(rdt) {
  const L = settings.look, w = G.view.w;
  const range = L.range * D2R, prange = L.pitchRange * D2R;
  let push = keyPan();
  const pp = L.edge ? panPoint() : null;
  if (pp && !G.aim.scoped) {
    const z = L.edgeZone * w;
    if (pp.x < z) push -= 1 - pp.x / z;
    else if (pp.x > w - z) push += (pp.x - (w - z)) / z;
  }
  if (push) { st.lookYaw += clamp(push, -1, 1) * L.edgeSpeed * D2R * rdt; st.manualT = 0; }
  else st.manualT += rdt;
  if (gyroYaw || gyroPitch) {
    st.lookYaw += gyroYaw * D2R; st.lookPitch += gyroPitch * D2R;
    if (Math.abs(gyroYaw) > 0.02) st.manualT = 0;
    gyroYaw = gyroPitch = 0;
  } else if (!L.gyro) st.lookPitch = damp(st.lookPitch, 0, 3, rdt);
  if (rig.moving) { st.lookYaw = damp(st.lookYaw, 0, 2.5, rdt); st.lookPitch = damp(st.lookPitch, 0, 2.5, rdt); }
  else if (L.auto && st.manualT > L.autoDelay && !G.aim.scoped && !L.gyro) {
    const target = director(G.view.hfov * D2R / 2, rdt);
    // ease off while the player is holding a trigger so the frame doesn't pull their aim around
    const k = 2.2 * L.autoSpeed * (aimPointerDown() ? 0.35 : 1);
    st.lookYaw = damp(st.lookYaw, target, k, rdt);
  }
  st.lookYaw = clamp(st.lookYaw, -range, range);
  st.lookPitch = clamp(st.lookPitch, -prange, prange);
  _e.set(st.lookPitch, -st.lookYaw, 0);
  lookQ.copy(rig.quat).multiply(_q.setFromEuler(_e));
}

export function resetLook() { st.lookYaw = 0; st.lookPitch = 0; st.manualT = 9; gyroYaw = gyroPitch = 0; }

// ------------------------------------------------------------------ per frame
export function updateCamera(rdt) {
  const cam = G.camera, P = G.player;
  st.t += rdt;
  const aspect = G.view.w / G.view.h;
  updateLook(rdt);

  // cover duck
  P.coverT = damp(P.coverT, P.cover ? 1 : 0, 14, rdt);
  cam.position.copy(rig.pos);
  _v.set(0.35 * P.coverT, -0.85 * P.coverT, 0.2 * P.coverT).applyQuaternion(lookQ);
  cam.position.add(_v);
  if (rig.moving) cam.position.y += Math.abs(Math.sin(st.t * 7)) * 0.05 * Math.min(1, rig.speed / 4);

  // scope: zoom and turn towards the scoped direction
  const scoped = G.aim.scoped;
  st.zoom = damp(st.zoom, scoped ? 1 : 0, scoped ? 16 : 12, rdt);
  if (scoped) {
    st.swayT += rdt;
    const sway = settings.scopeSway * 0.0035 * (G.time.focus > 0 ? 0.3 : 1);
    st.yaw = damp(st.yaw, G.aim.scopeYaw + Math.sin(st.swayT * 1.3) * sway + Math.sin(st.swayT * 2.9) * sway * 0.4, 22, rdt);
    st.pitch = damp(st.pitch, G.aim.scopePitch + Math.sin(st.swayT * 1.7 + 1) * sway * 0.8, 22, rdt);
  } else {
    st.yaw = damp(st.yaw, 0, 10, rdt); st.pitch = damp(st.pitch, 0, 10, rdt);
  }

  // optional lean towards the reticle (Time-Crisis style aim drift)
  const lean = J('lean') && G.aim.visible && !scoped ? 1 : 0;
  const nx = (G.aim.x / G.view.w) * 2 - 1, ny = (G.aim.y / G.view.h) * 2 - 1;
  st.leanX = damp(st.leanX, lean * nx * 2.2 * D2R, 4, rdt);
  st.leanY = damp(st.leanY, lean * -ny * 1.6 * D2R, 4, rdt);

  // kick recovers, trauma decays
  camFx.kick = damp(camFx.kick, 0, 9, rdt); camFx.kickYaw = damp(camFx.kickYaw, 0, 9, rdt);
  camFx.fov = damp(camFx.fov, 0, 12, rdt);
  camFx.trauma = Math.max(0, camFx.trauma - rdt * 1.5);
  const sh = camFx.trauma * camFx.trauma;
  const t = st.t;

  _e.set(st.pitch + st.leanY + camFx.kick * D2R + sh * 2.2 * D2R * n1(t, 1), -st.yaw - st.leanX + camFx.kickYaw * D2R + sh * 2.2 * D2R * n1(t, 2), sh * 2.5 * D2R * n1(t, 3) + P.coverT * 4 * D2R);
  _q.setFromEuler(_e);
  cam.quaternion.copy(lookQ).multiply(_q);
  _v.set(n1(t, 4), n1(t, 5), 0).multiplyScalar(sh * 0.05).applyQuaternion(cam.quaternion);
  cam.position.add(_v);

  // FOV
  const base = baseVFov(aspect);
  const zoom = WEAPONS.find(w => w.id === 'sniper').zoom;
  const zoomed = 2 * Math.atan(Math.tan(base * D2R / 2) / zoom) / D2R;
  const fov = THREE.MathUtils.lerp(base, zoomed, st.zoom) + camFx.fov;
  if (Math.abs(fov - cam.fov) > 1e-3 || cam.aspect !== aspect) {
    cam.fov = fov; cam.aspect = aspect; cam.updateProjectionMatrix();
  }
  G.view.vfov = fov;
  G.view.hfov = 2 * Math.atan(Math.tan(fov * D2R / 2) * aspect) / D2R;
  G.view.hfovScoped = 2 * Math.atan(Math.tan(zoomed * D2R / 2) * aspect) / D2R;
  G.view.focalPx = (G.view.h / 2) / Math.tan(fov * D2R / 2);
  G.view.zoom = st.zoom;
  cam.updateMatrixWorld();
}
