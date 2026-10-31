// Final camera = rail pose + scripted beat yaw + cover duck + scope offset + aim lean + kick + trauma shake + FOV punch.
import * as THREE from 'three';
import { G, clamp, damp, lerp } from './state.js';
import { settings, WEAPONS, J } from './config.js';
import { camFx } from './fx.js';

export const rig = { pos: new THREE.Vector3(0, 1.7, 0), quat: new THREE.Quaternion(), moving: false, speed: 0 };

const D2R = Math.PI / 180;
const st = { yaw: 0, pitch: 0, zoom: 0, leanX: 0, leanY: 0, fov: 60, t: 0, swayT: 0, lookYaw: 0 };
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3();
const lookQ = new THREE.Quaternion();
// arcade framing: the level names a bearing for each beat (sub-encounter) and the camera pans there on a fixed ease
const beat = { yaw: 0, from: 0, t: 0, dur: 0 };

// rail orientation + the beat's yaw: the "base" every aim calculation starts from
export const railQuat = () => lookQ;

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

// ------------------------------------------------------------------ beat pans
// pan to a bearing (deg, + = right of the rail direction); returns the pan duration in seconds
export function panTo(yawDeg) {
  beat.from = st.lookYaw; beat.yaw = yawDeg * D2R; beat.t = 0;
  beat.dur = Math.abs(beat.yaw - beat.from) < 0.01 ? 0 : clamp(Math.abs(beat.yaw - beat.from) / (settings.look.panSpeed * D2R), 0.35, 1.6);
  return beat.dur;
}
export const panning = () => beat.t < beat.dur;
const easeInOut = u => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

function updateLook(rdt) {
  let roll = 0;
  if (panning()) {
    // a slight bank into the turn sells it as a head turn rather than a dolly
    beat.t += rdt;
    const u = clamp(beat.t / beat.dur, 0, 1);
    st.lookYaw = lerp(beat.from, beat.yaw, easeInOut(u));
    roll = Math.sin(u * Math.PI) * Math.sign(beat.yaw - beat.from) * -2.5 * D2R * Math.min(1, Math.abs(beat.yaw - beat.from) / 0.6);
  } else if (rig.moving) st.lookYaw = damp(st.lookYaw, 0, 2.5, rdt); // riding the rail: face down the track again
  _e.set(0, -st.lookYaw, roll);
  lookQ.copy(rig.quat).multiply(_q.setFromEuler(_e));
}

export function resetLook() { st.lookYaw = 0; beat.yaw = beat.from = 0; beat.t = beat.dur = 0; }

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
