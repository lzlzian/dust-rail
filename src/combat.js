// Ray casting against analytic hitboxes (spheres), cover boxes and the ground, plus screen-space aim assist.
import * as THREE from 'three';
import { G } from './state.js';
import { settings } from './config.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3();

export function screenRay(x, y, o = new THREE.Vector3(), d = new THREE.Vector3()) {
  const cam = G.camera;
  o.copy(cam.position);
  d.set((x / G.view.w) * 2 - 1, -(y / G.view.h) * 2 + 1, 0.5).unproject(cam).sub(o).normalize();
  return { o, d };
}

// world -> frame px. z > 1 or behind => off screen
export function project(p, out = { x: 0, y: 0, behind: false, dist: 0 }) {
  const cam = G.camera;
  _w.copy(p).sub(cam.position);
  out.dist = _w.length();
  _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
  out.behind = _w.dot(_v) <= 0.05;
  _v.copy(p).project(cam);
  out.x = (_v.x * 0.5 + 0.5) * G.view.w;
  out.y = (-_v.y * 0.5 + 0.5) * G.view.h;
  if (out.behind) { out.x = G.view.w - out.x; out.y = G.view.h - out.y; }
  return out;
}

export function pxRadius(r, dist) { return (r * G.view.focalPx) / Math.max(dist, 0.01); }

export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t < 0 ? -1 : t;
}

function rayBox(o, d, mn, mx, n) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z, da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const lo = a === 0 ? mn.x : a === 1 ? mn.y : mn.z, hi = a === 0 ? mx.x : a === 1 ? mx.y : mx.z;
    if (Math.abs(da) < 1e-8) { if (oa < lo || oa > hi) return -1; continue; }
    let t1 = (lo - oa) / da, t2 = (hi - oa) / da, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  if (tmin < 0) return -1; // started inside: ignore (camera behind cover while ducking)
  n.set(0, 0, 0);
  if (axis === 0) n.x = sign; else if (axis === 1) n.y = sign; else n.z = sign;
  return tmin;
}

// nearest static hit: { t, n, kind }  (kind: 'ground' | 'box' | 'rock')
export function castWorld(o, d, maxT = 400) {
  let best = maxT, bn = new THREE.Vector3(0, 1, 0), kind = null;
  if (d.y < -1e-4) { const t = -o.y / d.y; if (t > 0 && t < best) { best = t; bn.set(0, 1, 0); kind = 'ground'; } }
  for (const c of G.colliders) {
    if (c.type === 'box') {
      const t = rayBox(o, d, c.min, c.max, _n);
      if (t > 0 && t < best) { best = t; bn.copy(_n); kind = 'box'; }
    } else {
      const t = raySphere(o, d, c.c, c.r);
      if (t > 0 && t < best) { best = t; bn.copy(o).addScaledVector(d, t).sub(c.c).normalize(); kind = 'rock'; }
    }
  }
  return { t: best, n: bn, kind };
}

export const projRadius = p => p.r * settings.projHitMult;

// all target hits along a ray, nearest first. Each: { t, enemy?, hb?, proj? }
export function castTargets(o, d, maxT) {
  const hits = [];
  for (const e of G.enemies) {
    if (!e.alive || !e.targetable) continue;
    let best = null;
    for (const hb of e.hitboxes) {
      const t = raySphere(o, d, hb.c, hb.r);
      if (t > 0 && t < maxT && (!best || t < best.t - 0.05 || (Math.abs(t - best.t) < 0.05 && hb.mult > best.hb.mult))) best = { t, enemy: e, hb };
    }
    if (best) hits.push(best);
  }
  for (const p of G.projectiles) {
    if (!p.alive || !p.shootable) continue;
    const t = raySphere(o, d, p.pos, projRadius(p));
    if (t > 0 && t < maxT) hits.push({ t, proj: p });
  }
  return hits.sort((a, b) => a.t - b.t);
}

// What would a shot at screen (x, y) hit? Applies aim assist when the raw ray misses.
// Returns { o, d, t, enemy, hb, proj, world, assisted, point }
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _pp = { x: 0, y: 0, behind: false, dist: 0 };
export function pick(x, y, assistPx = settings.aimAssist, maxT = 300) {
  const { o, d } = screenRay(x, y, _o, _d);
  const world = castWorld(o, d, maxT);
  const hits = castTargets(o, d, world.t);
  if (hits.length) return { o: o.clone(), d: d.clone(), ...hits[0], world, assisted: false, point: o.clone().addScaledVector(d, hits[0].t) };

  let best = null, bestScore = Infinity;
  const consider = (c, r, extra, data) => {
    project(c, _pp);
    if (_pp.behind) return;
    // prefer bodies over heads/weak points so assist never hands out free crits
    const score = Math.hypot(_pp.x - x, _pp.y - y) - pxRadius(r, _pp.dist) + (data.hb && data.hb.mult > 1 ? 8 : 0);
    if (score < assistPx * extra && score < bestScore) {
      const dir = _v.copy(c).sub(o);
      const dist = dir.length(); dir.divideScalar(dist);
      if (castWorld(o, dir, dist).t < dist - r) return; // occluded
      bestScore = score; best = { ...data, c: c.clone(), dist };
    }
  };
  if (assistPx > 0) {
    for (const e of G.enemies) {
      if (!e.alive || !e.targetable) continue;
      for (const hb of e.hitboxes) consider(hb.c, hb.r, 1, { enemy: e, hb });
    }
    for (const p of G.projectiles) if (p.alive && p.shootable) consider(p.pos, projRadius(p), settings.projAssist, { proj: p });
  }
  if (best) {
    const dir = best.c.clone().sub(o).normalize();
    return { o: o.clone(), d: dir, t: best.dist, enemy: best.enemy, hb: best.hb, proj: best.proj, world, assisted: true, point: best.c };
  }
  return { o: o.clone(), d: d.clone(), t: world.t, world, assisted: false, point: o.clone().addScaledVector(d, Math.min(world.t, maxT)) };
}

// current cone (deg) for a gun: base spread + bloom, tightened by the shotgun's choke while held and by sighting in
export function spreadNow(w) {
  const k = w.choke && G.aim.choke != null ? G.aim.choke : 0;
  const sighted = G.aim.ads && G.aim.sight === w.sight ? w.sight.spread ?? 1 : 1;
  return (w.spread + ((w.choke?.min ?? w.spread) - w.spread) * k + G.aim.bloom) * sighted;
}
