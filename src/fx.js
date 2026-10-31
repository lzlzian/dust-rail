// Particles, tracers, decals, shockwaves, physics debris, flash lights and camera trauma.
// Everything is pooled; particles are 4 InstancedMeshes (4 draw calls total).
import * as THREE from 'three';
import { G, rand, lerp } from './state.js';
import { toon } from './world.js';
import { J } from './config.js';
import { sfx } from './audio.js';

export const camFx = { trauma: 0, kick: 0, kickYaw: 0, fov: 0 };
export function addTrauma(t) { camFx.trauma = Math.min(1, camFx.trauma + t * J('shake')); }
export function addKick(deg, yaw = 0) { const k = J('kick'); camFx.kick += deg * k; camFx.kickYaw += yaw * k; }
export function fovPunch(deg) { camFx.fov = Math.max(camFx.fov, deg * J('fovPunch')); }
export function hitstop(s) { if (s > 0) G.time.hitstop = Math.max(G.time.hitstop, s * J('hitstop')); }

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
const _c = new THREE.Color(), Z = new THREE.Vector3(0, 0, 1);

class InstPool {
  constructor(scene, geo, mat, max) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.count = 0;
    this.items = []; this.max = max;
    scene.add(this.mesh);
  }
  spawn(o) {
    if (this.items.length >= this.max) this.items.shift();
    o.life = o.max = o.life ?? 0.6;
    o.v = o.v ?? new THREE.Vector3();
    o.r = o.r ?? new THREE.Vector3(rand(0, 6), rand(0, 6), rand(0, 6));
    o.w = o.w ?? new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8));
    o.c0 = new THREE.Color(o.c0 ?? 0xffffff); o.c1 = o.c1 !== undefined ? new THREE.Color(o.c1) : o.c0;
    this.items.push(o);
  }
  update(dt) {
    let n = 0;
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      o.life -= dt;
      if (o.life <= 0) continue;
      o.v.y -= (o.g ?? 0) * dt;
      if (o.drag) o.v.multiplyScalar(Math.exp(-o.drag * dt));
      o.p.addScaledVector(o.v, dt);
      if (o.floor !== undefined && o.p.y < o.floor) { o.p.y = o.floor; o.v.y *= -0.35; o.v.x *= 0.6; o.v.z *= 0.6; o.w.multiplyScalar(0.6); }
      o.r.addScaledVector(o.w, dt);
      const t = 1 - o.life / o.max;
      let s = lerp(o.s0, o.s1, o.shape === 'puff' ? 1 - (1 - t) * (1 - t) : t);
      if (o.shape === 'puff') s *= 1 - Math.max(0, (t - 0.55) / 0.45) ** 2;
      if (o.stretch) {
        // velocity-aligned streak (sparks)
        const sp = o.v.length();
        _q.setFromUnitVectors(Z, _v.copy(o.v).divideScalar(sp || 1));
        _s.set(s, s, s + sp * o.stretch * (1 - t));
      } else {
        _q.setFromEuler(_e.set(o.r.x, o.r.y, o.r.z));
        _s.set(s, s, s);
      }
      _m.compose(o.p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, _c.copy(o.c0).lerp(o.c1, t));
      items[n++] = o;
    }
    items.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

let chunks, sparks, puffs, glows, decals, decalIdx = 0;
const tracers = [], rings = [], bodies = [], lights = [];

export function initFx(scene) {
  chunks = new InstPool(scene, new THREE.BoxGeometry(1, 1, 1), toon(0xffffff), 500);
  sparks = new InstPool(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ fog: false }), 400);
  puffs = new InstPool(scene, new THREE.IcosahedronGeometry(1, 0), toon(0xffffff), 260);
  glows = new InstPool(scene, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ fog: false }), 160);

  const tg = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.visible = false; m.userData = { life: 0 };
    scene.add(m); tracers.push(m);
  }
  const dg = new THREE.CircleGeometry(0.07, 6);
  decals = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: 0x24170e, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 90);
  decals.count = 0; decals.frustumCulled = false; scene.add(decals);

  const rg = new THREE.RingGeometry(0.82, 1, 28);
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.visible = false; m.userData = { life: 0 };
    scene.add(m); rings.push(m);
  }
  // fixed light count: adding/removing lights at runtime forces shader recompiles
  for (let i = 0; i < 2; i++) {
    const l = new THREE.PointLight(0xffc070, 0, 26, 1.2);
    l.userData = { life: 0, max: 1, peak: 0 };
    scene.add(l); lights.push(l);
  }
}

export function flashLight(pos, color, peak, dur, slot = 0) {
  if (!J('flash')) return;
  const l = lights[slot];
  l.position.copy(pos); l.color.setHex(color);
  l.userData.life = l.userData.max = dur; l.userData.peak = peak * J('flash');
}

export function tracer(from, to, color, width) {
  const k = J('tracers');
  if (!k) return;
  const m = tracers.find(t => !t.visible) || tracers[0];
  m.visible = true;
  m.material.color.setHex(color);
  m.userData.from = from.clone(); m.userData.to = to.clone();
  m.userData.life = m.userData.max = 0.075; m.userData.w = width * (0.6 + 0.4 * k);
}

export function decal(p, n) {
  if (!J('impact')) return;
  _q.setFromUnitVectors(Z, n);
  _v.copy(p).addScaledVector(n, 0.01);
  _m.compose(_v, _q, _s.setScalar(rand(0.7, 1.3)));
  decals.setMatrixAt(decalIdx, _m);
  decalIdx = (decalIdx + 1) % 90;
  decals.count = Math.max(decals.count, decalIdx === 0 ? 90 : decalIdx);
  decals.instanceMatrix.needsUpdate = true;
}

export function ring(pos, radius, color = 0xfff1c0, dur = 0.35) {
  const m = rings.find(r => !r.visible) || rings[0];
  m.visible = true; m.position.copy(pos); m.material.color.setHex(color);
  m.userData.life = m.userData.max = dur; m.userData.r = radius;
}

// enemy limbs etc. — reparented to the scene and simulated until they shrink away
export function body(obj, v, w, life = 1.6) {
  G.scene.attach(obj);
  bodies.push({ obj, v, w, life, max: life, s0: obj.scale.clone() });
}

function sparkBurst(p, n, dir, speed, colors, size = 0.05, life = 0.25) {
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(0.7).add(dir).normalize().multiplyScalar(speed * rand(0.4, 1));
    sparks.spawn({ p: p.clone(), v, life: life * rand(0.6, 1.2), s0: size, s1: 0, g: 9, drag: 2, stretch: 0.035, c0: colors[0], c1: colors[1] });
  }
}

export function impact(p, n, kind = 'world', tint = 0xc9925a) {
  const k = J('impact');
  if (!k) return;
  if (kind === 'world') {
    for (let i = 0; i < 2; i++) puffs.spawn({ p: p.clone().addScaledVector(n, 0.1), v: n.clone().multiplyScalar(rand(0.5, 1.5)).add(new THREE.Vector3(rand(-.5, .5), rand(0, .6), rand(-.5, .5))), life: rand(0.35, 0.6), s0: 0.06, s1: rand(0.18, 0.3), shape: 'puff', drag: 3, c0: tint, c1: 0xe9cfa8 });
    for (let i = 0; i < 3; i++) chunks.spawn({ p: p.clone(), v: n.clone().multiplyScalar(rand(2, 4)).add(new THREE.Vector3(rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5))), life: rand(0.4, 0.7), s0: rand(0.04, 0.08), s1: 0.01, g: 14, c0: tint, floor: 0.03 });
    sparkBurst(p, 3, n, 7, [0xfff4b0, 0xff8a2a]);
  } else {
    sparkBurst(p, kind === 'crit' ? 9 : 5, n, kind === 'crit' ? 10 : 7, kind === 'crit' ? [0xffffff, 0xff4040] : [0xfff4b0, 0xffa030], 0.055);
    for (let i = 0; i < (kind === 'crit' ? 4 : 2); i++) chunks.spawn({ p: p.clone(), v: n.clone().multiplyScalar(rand(1.5, 3)).add(new THREE.Vector3(rand(-1, 1), rand(1, 3), rand(-1, 1))), life: rand(0.4, 0.8), s0: rand(0.05, 0.09), s1: 0.01, g: 14, c0: tint, floor: 0.04 });
  }
}

export function muzzleWorld(p, dir, color, scale) {
  const k = J('flash');
  if (!k) return;
  glows.spawn({ p: p.clone(), v: dir.clone().multiplyScalar(2), life: 0.05, s0: 0.12 * scale, s1: 0.02, c0: 0xffffff, c1: color });
}

export function explosion(p, scale = 1, opts = {}) {
  const k = Math.max(0.25, J('impact'));
  const n = Math.round(10 * scale * k);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 6) * scale);
    glows.spawn({ p: p.clone(), v, life: rand(0.18, 0.35), s0: 0.3 * scale, s1: rand(0.6, 1.0) * scale, shape: 'puff', drag: 5, c0: 0xfffbe0, c1: opts.color ?? 0xff6a10 });
  }
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rand(-1, 1), rand(0, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4) * scale);
    puffs.spawn({ p: p.clone().add(new THREE.Vector3(rand(-.3, .3), rand(0, .4), rand(-.3, .3)).multiplyScalar(scale)), v, life: rand(0.6, 1.1), s0: 0.2 * scale, s1: rand(0.55, 0.95) * scale, shape: 'puff', drag: 2.5, g: -1.5, c0: 0x6b5a4c, c1: 0x9a8a7a });
  }
  if (J('gibs')) for (let i = 0; i < n; i++) chunks.spawn({ p: p.clone(), v: new THREE.Vector3(rand(-6, 6), rand(3, 10), rand(-6, 6)).multiplyScalar(scale * 0.8), life: rand(0.7, 1.3), s0: rand(0.06, 0.16) * scale, s1: 0.02, g: 16, c0: opts.debris ?? 0x4a3a2c, floor: 0.05 });
  sparkBurst(p, Math.round(14 * scale * k), new THREE.Vector3(0, 0.5, 0), 14 * scale, [0xffffff, 0xffa020], 0.08, 0.45);
  const d = G.camera.position.distanceTo(p);
  if (d > 5) ring(p, 3.2 * scale, 0xfff1c0, 0.32);
  flashLight(p, 0xff9a40, 60 * scale * Math.min(1, d / 8), 0.28, 1);
  addTrauma(Math.min(0.9, (opts.trauma ?? 0.7) * scale * 9 / Math.max(d, 3)));
  if (!opts.silent) sfx.boom(scale);
}

export function gib(p, colors, n, dir) {
  if (!J('gibs')) return;
  for (let i = 0; i < n; i++) {
    const v = dir.clone().multiplyScalar(rand(2, 6)).add(new THREE.Vector3(rand(-2.5, 2.5), rand(2, 6), rand(-2.5, 2.5)));
    chunks.spawn({ p: p.clone().add(new THREE.Vector3(rand(-.2, .2), rand(-.3, .3), rand(-.2, .2))), v, life: rand(0.8, 1.4), s0: rand(0.08, 0.18), s1: 0.02, g: 16, c0: colors[i % colors.length], floor: 0.06 });
  }
}

export function chargeMote(p, target, color) {
  // particles sucked into a charging weapon
  const v = target.clone().sub(p).multiplyScalar(3.2);
  sparks.spawn({ p: p.clone(), v, life: 0.3, s0: 0.05, s1: 0.02, stretch: 0.03, c0: 0xffffff, c1: color });
}

export function smokeTrail(p, color = 0xd9cbb8, size = 0.18) {
  puffs.spawn({ p: p.clone(), v: new THREE.Vector3(rand(-.3, .3), rand(0, .5), rand(-.3, .3)), life: rand(0.35, 0.55), s0: size * 0.6, s1: size, shape: 'puff', drag: 1, c0: color, c1: 0xffffff });
}

export function updateFx(dt, rdt) {
  chunks.update(dt); sparks.update(dt); puffs.update(dt); glows.update(dt);

  for (const m of tracers) {
    if (!m.visible) continue;
    const u = m.userData;
    u.life -= rdt;
    if (u.life <= 0) { m.visible = false; continue; }
    const t = 1 - u.life / u.max;
    const len = u.from.distanceTo(u.to);
    _v.copy(u.from).lerp(u.to, t * t * 0.9);
    m.position.copy(_v);
    m.lookAt(u.to);
    m.scale.set(u.w, u.w, Math.max(0.01, len * (1 - t * t * 0.9)));
    m.material.opacity = 1 - t * 0.5;
  }
  for (const m of rings) {
    if (!m.visible) continue;
    const u = m.userData;
    u.life -= dt;
    if (u.life <= 0) { m.visible = false; continue; }
    const t = 1 - u.life / u.max;
    m.scale.setScalar(0.2 + u.r * (1 - (1 - t) ** 3));
    m.material.opacity = (1 - t) * 0.9;
    m.quaternion.copy(G.camera.quaternion);
  }
  for (const l of lights) {
    const u = l.userData;
    if (u.life > 0) { u.life -= rdt; l.intensity = Math.max(0, u.peak * (u.life / u.max)); } else l.intensity = 0;
  }
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    b.life -= dt;
    if (b.life <= 0) { G.scene.remove(b.obj); bodies.splice(i, 1); continue; }
    b.v.y -= 18 * dt;
    b.obj.position.addScaledVector(b.v, dt);
    b.obj.rotation.x += b.w.x * dt; b.obj.rotation.y += b.w.y * dt; b.obj.rotation.z += b.w.z * dt;
    if (b.obj.position.y < 0.12) { b.obj.position.y = 0.12; b.v.y *= -0.3; b.v.x *= 0.6; b.v.z *= 0.6; b.w.multiplyScalar(0.6); }
    const s = b.life < 0.35 ? b.life / 0.35 : 1;
    b.obj.scale.copy(b.s0).multiplyScalar(s);
  }
}

export function clearFx() {
  for (const p of [chunks, sparks, puffs, glows]) p.items.length = 0;
  for (const b of bodies) G.scene.remove(b.obj);
  bodies.length = 0;
  decals.count = 0; decalIdx = 0;
}
