// Weapon state, firing/damage resolution, and the first-person viewmodel (separate scene, drawn on top).
import * as THREE from 'three';
import { G, rand, clamp, lerp } from './state.js';
import { WEAPONS, settings, J } from './config.js';
import { toon, outline } from './world.js';
import { pick, castWorld, castTargets, screenRay, project, spreadNow } from './combat.js';
import * as fx from './fx.js';
import { sfx, haptic } from './audio.js';
import { popDamage, popText, hitMarker } from './hud.js';

export const W = {
  idx: 0, ammo: WEAPONS.map(w => w.mag), cool: 0, reloading: false, reloadT: 0,
  swapT: 0, swapTo: -1,
  lastAim: new THREE.Vector3(0, 1.5, -20), lastAimT: 0, firing: 0,
};
export const cur = () => WEAPONS[W.idx];

let killHook = () => {};
export function setWeaponKillHook(fn) { killHook = fn; }

// ------------------------------------------------------------------ viewmodel
const VM = { root: null, aim: null, recoil: null, guns: [], flash: null, flashT: 0, light: null, shells: [], rec: { z: 0, vz: 0, rx: 0, vrx: 0, ry: 0, vry: 0 }, bob: 0 };

function gunModel(w) {
  const g = new THREE.Group();
  const L = w.look, body = toon(L.body), acc = toon(L.accent), grip = toon(L.grip), dark = toon(0x26221e);
  const add = (geo, m, x, y, z, rx = 0, ot = 0.006) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.x = rx; outline(mesh, ot); g.add(mesh); return mesh; };
  const B = (a, b, c) => new THREE.BoxGeometry(a, b, c), C = (r, h, s = 8) => new THREE.CylinderGeometry(r, r, h, s).rotateX(Math.PI / 2);
  let mz = 0.3, port = new THREE.Vector3(0.03, 0.05, 0.02);
  if (w.id === 'revolver') {
    add(B(0.055, 0.08, 0.13), body, 0, 0.03, 0.02);
    add(C(0.02, 0.2), body, 0, 0.05, 0.17);
    add(B(0.012, 0.03, 0.18), acc, 0, 0.075, 0.16);
    add(C(0.045, 0.075, 7), acc, 0, 0.03, 0.04);
    add(B(0.05, 0.13, 0.06), grip, 0, -0.06, -0.05, 0.35);
    add(B(0.015, 0.03, 0.03), dark, 0, 0.08, -0.05);
    mz = 0.28; port.set(0.04, 0.04, 0.04);
  } else if (w.id === 'smg') {
    add(B(0.07, 0.09, 0.26), body, 0, 0.03, 0.05);
    add(C(0.018, 0.08), dark, 0, 0.04, 0.22);
    add(B(0.04, 0.16, 0.05), acc, 0, -0.07, 0.07, 0.15);
    add(B(0.05, 0.1, 0.05), grip, 0, -0.05, -0.04, 0.3);
    add(B(0.03, 0.025, 0.12), acc, 0, 0.09, 0.03);
    add(B(0.05, 0.06, 0.1), body, 0, 0.02, -0.12);
    mz = 0.27;
  } else if (w.id === 'ar') {
    add(B(0.07, 0.1, 0.34), body, 0, 0.03, 0.06);
    add(C(0.017, 0.2), dark, 0, 0.045, 0.31);
    add(B(0.045, 0.15, 0.06), acc, 0, -0.08, 0.1, 0.35);
    add(B(0.05, 0.1, 0.05), grip, 0, -0.05, -0.04, 0.3);
    add(B(0.06, 0.08, 0.18), grip, 0, 0.02, -0.2);
    add(C(0.022, 0.1, 6), acc, 0, 0.11, 0.06);
    add(B(0.05, 0.04, 0.12), body, 0, -0.03, 0.21);
    mz = 0.42;
  } else if (w.id === 'shotgun') {
    add(B(0.08, 0.09, 0.22), body, 0, 0.02, 0.0);
    add(C(0.024, 0.42), acc, -0.022, 0.05, 0.3);
    add(C(0.024, 0.42), acc, 0.022, 0.05, 0.3);
    W.pump = add(B(0.07, 0.06, 0.14), grip, 0, 0.0, 0.26);
    add(B(0.06, 0.1, 0.22), grip, 0, -0.01, -0.2, 0.15);
    mz = 0.52; port.set(0.045, 0.03, 0.04);
  } else {
    add(B(0.07, 0.09, 0.38), body, 0, 0.03, 0.05);
    add(C(0.018, 0.46), dark, 0, 0.05, 0.46);
    add(C(0.034, 0.24), dark, 0, 0.13, 0.06);
    add(new THREE.CircleGeometry(0.028, 12), new THREE.MeshBasicMaterial({ color: 0x4fe3ff }), 0, 0.13, 0.181);
    add(B(0.012, 0.012, 0.05), acc, 0.05, 0.05, -0.04);
    add(B(0.05, 0.1, 0.05), grip, 0, -0.05, -0.06, 0.3);
    add(B(0.06, 0.09, 0.22), body, 0, 0.0, -0.22);
    add(B(0.02, 0.07, 0.3), acc, 0.04, 0.03, 0.05);
    mz = 0.7;
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.05, mz); g.add(muzzle);
  const ejector = new THREE.Object3D(); ejector.position.copy(port); g.add(ejector);
  g.userData = { muzzle, ejector };
  g.visible = false;
  return g;
}

export function initWeapons() {
  const vs = new THREE.Scene();
  vs.add(new THREE.HemisphereLight(0xdcecff, 0x8a6040, 1.6));
  const dl = new THREE.DirectionalLight(0xfff0d6, 2.4); dl.position.set(-0.5, 1, 0.6); vs.add(dl);
  VM.light = new THREE.PointLight(0xffc070, 0, 2, 1); vs.add(VM.light);
  G.vmScene = vs;
  G.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  VM.root = new THREE.Group(); vs.add(VM.root);
  VM.aim = new THREE.Group(); VM.root.add(VM.aim);
  VM.recoil = new THREE.Group(); VM.aim.add(VM.recoil);
  VM.guns = WEAPONS.map(w => { const g = gunModel(w); VM.recoil.add(g); return g; });
  // muzzle flash: crossed quads + core
  const fm = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const fl = new THREE.Group();
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.012 : 0.042; i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(r, 0); }
  const sg = new THREE.ShapeGeometry(star);
  const s1 = new THREE.Mesh(sg, fm); fl.add(s1);
  const s2 = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.12).translate(0, 0.06, 0), fm); s2.rotation.set(Math.PI / 2, 0, 0); s2.rotation.order = 'YXZ'; fl.add(s2);
  const s3 = s2.clone(); s3.rotation.y = Math.PI / 2; fl.add(s3);
  fl.visible = false; VM.flash = fl; VM.flashMat = fm;
  const shellG = new THREE.BoxGeometry(0.012, 0.012, 0.032);
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(shellG, toon(0xd8a640)); m.visible = false; vs.add(m);
    VM.shells.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 });
  }
  selectWeapon(0, true);
}

export function layoutViewmodel() {
  const cam = G.vmCamera;
  const aspect = G.view.w / G.view.h;
  const portrait = aspect < 1;
  // same idea as the world camera: portrait fixes horizontal FOV, landscape fixes vertical
  const vf = portrait ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(29)) / aspect)) : 56;
  cam.fov = clamp(vf, 44, 100); cam.aspect = aspect; cam.updateProjectionMatrix();
  const d = 0.55, halfH = d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), halfW = halfH * aspect;
  VM.restPos = new THREE.Vector3((portrait ? 0.56 : 0.42) * halfW, (portrait ? -0.6 : -0.55) * halfH, -d);
  VM.root.position.copy(VM.restPos);
  VM.root.scale.setScalar(settings.hud.vmScale * (portrait ? 0.78 : 0.95));
}

export function selectWeapon(i, instant = false) {
  if (i === W.idx && !instant) return;
  if (W.reloading) { W.reloading = false; }
  if (instant) { W.idx = i; VM.guns.forEach((g, k) => (g.visible = k === i)); attachFlash(); return; }
  W.swapTo = i; W.swapT = 0.36; sfx.swap();
}
function attachFlash() { VM.guns[W.idx].userData.muzzle.add(VM.flash); }

export function startReload() {
  const w = cur();
  if (W.reloading || W.ammo[W.idx] >= w.mag || W.swapT > 0) return;
  W.reloading = true; W.reloadT = 0; W.reloadStage = 0;
}

// each scripted reload beat: sound + a small viewmodel jolt + a haptic tick on the beats that "seat"
const RELOAD_JOLT = { magOut: [0.02, -0.15, 0], magIn: [-0.03, 0.55, 0], rack: [-0.06, 0.25, 0.15], cylOpen: [0, 0, -0.4], speedload: [-0.02, 0.3, 0], cylClose: [0, 0.2, 0.6], shell: [-0.015, 0.2, 0], pump: [-0.07, 0.35, 0], boltUp: [0, 0, -0.2], boltBack: [-0.04, 0.1, 0], boltFwd: [0.03, 0.25, 0], boltDown: [0, 0.15, 0.25], ready: [0, 0.18, 0] };
const RELOAD_BUZZ = { magIn: [14], rack: [10, 30, 18], cylClose: [16], shell: [8], pump: [12, 40, 20], boltFwd: [14], ready: [6] };
function reloadBeat(name) {
  sfx.reload(name, cur().id);
  const j = RELOAD_JOLT[name], m = J('recoil');
  if (j && m) { VM.rec.vz += j[0] * 14 * m; VM.rec.vrx += j[1] * 6 * m; VM.rec.vry += j[2] * 6 * m; }
  if (RELOAD_BUZZ[name]) haptic(RELOAD_BUZZ[name]);
}

export const canShoot = () => !W.reloading && W.swapT <= 0 && W.ammo[W.idx] > 0 && !G.player.cover;
export const ready = () => canShoot() && W.cool <= 0;

// ------------------------------------------------------------------ firing
const _v = new THREE.Vector3(), _u = new THREE.Vector3();

function coneDir(d, deg) {
  if (deg <= 0) return d.clone();
  // 'center' packs shots toward the reticle (half land inside half the cone); 'uniform' fills the whole disc evenly
  const u = Math.random(), a = THREE.MathUtils.degToRad(deg) * (settings.spreadPattern === 'uniform' ? Math.sqrt(u) : u), th = Math.random() * Math.PI * 2;
  const up = Math.abs(d.y) < 0.95 ? _u.set(0, 1, 0) : _u.set(1, 0, 0);
  const r = new THREE.Vector3().crossVectors(d, up).normalize(), u2 = new THREE.Vector3().crossVectors(r, d);
  return d.clone().multiplyScalar(Math.cos(a)).addScaledVector(r, Math.sin(a) * Math.cos(th)).addScaledVector(u2, Math.sin(a) * Math.sin(th)).normalize();
}

export function muzzleWorld() {
  const g = VM.guns[W.idx];
  g.userData.muzzle.getWorldPosition(_v);
  _v.project(G.vmCamera);
  const { o, d } = screenRay((_v.x * 0.5 + 0.5) * G.view.w, (-_v.y * 0.5 + 0.5) * G.view.h);
  return o.clone().addScaledVector(d, settings.hud.viewmodel ? 0.9 : 0.3).add(settings.hud.viewmodel ? _u.set(0, 0, 0) : _u.set(0, -0.25, 0));
}

const WORLD_TINT = { ground: 0xd8b07a, box: 0x9a6a3a, rock: 0xb8653a };

// Fire one trigger pull at screen point (x, y).
export function fireAt(x, y) {
  const w = cur();
  if (!canShoot() || W.cool > 0) {
    if (W.ammo[W.idx] <= 0 && !W.reloading && W.swapT <= 0 && !G.player.cover) { sfx.dry(); startReload(); }
    return false;
  }
  W.cool = 60 / w.rpm;
  W.ammo[W.idx]--;
  W.firing = 0.12;
  const st = G.stats.weapons[w.id];
  st.shots++;

  const base = pick(x, y - G.aim.climb, w.id === 'sniper' && G.aim.scoped ? 6 : settings.aimAssist);
  const spread = spreadNow(w);
  const reach = w.choke && G.aim.choke != null ? lerp(1, w.choke.reach, G.aim.choke) : 1; // a tight pattern carries further
  const mw = muzzleWorld();
  const perEnemy = new Map();
  let anyHit = false, anyCrit = false, anyKill = false, aimPoint = null;

  for (let p = 0; p < w.pellets; p++) {
    const d = coneDir(base.d, spread);
    const res = resolveShot(base.o, d, w, perEnemy, reach);
    anyHit ||= res.hit; anyCrit ||= res.crit; anyKill ||= res.kill;
    if (!aimPoint || res.hit) aimPoint = res.point;
    if (p < 5 || Math.random() < 0.5) fx.tracer(mw, res.point, w.j.tracerColor, w.j.tracer);
  }
  for (const [e, a] of perEnemy) popDamage(a.point, a.dmg, a.crit, e);
  if (anyHit) st.hits++;
  if (anyCrit) st.crits++;
  W.lastAim.copy(aimPoint); W.lastAimT = 0.7;

  // marker at where the shot went
  if (J('markers') && anyHit) {
    const sp = project(aimPoint);
    hitMarker(sp.x, sp.y, anyKill ? 'kill' : anyCrit ? 'crit' : 'hit');
    if (!anyKill) sfx.hit(anyCrit);
  }
  // spread bloom + climb for sustained fire
  G.aim.bloom = Math.min(w.bloom, G.aim.bloom + w.bloomPer);
  G.aim.climb = Math.min((w.climbMax ?? 0) * settings.recoilClimb, G.aim.climb + w.climb * settings.recoilClimb);
  feedback(w, mw, base.d, anyHit, anyCrit, anyKill);
  if (W.ammo[W.idx] <= 0) setTimeout(() => { if (W.ammo[W.idx] <= 0) startReload(); }, 180);
  return true;
}

function resolveShot(o, d, w, perEnemy, reach = 1) {
  const world = castWorld(o, d, w.range);
  const hits = castTargets(o, d, world.t);
  const out = { hit: false, crit: false, kill: false, point: null };
  const seen = new Set();
  for (const h of hits) {
    if (h.proj) {
      h.proj.intercept(w);
      out.hit = true; out.point = o.clone().addScaledVector(d, h.t);
      if (!w.pierce) return out;
      continue;
    }
    const e = h.enemy, hb = h.hb;
    if (seen.has(e)) continue;
    seen.add(e);
    const point = o.clone().addScaledVector(d, h.t);
    const crit = hb.tag === 'head' || !!hb.weak;
    let dmg = w.dmg * (hb.tag === 'head' ? w.crit : hb.mult);
    if (w.falloff) dmg *= lerp(1, 0.35, clamp((h.t - w.falloff[0] * reach) / ((w.falloff[1] - w.falloff[0]) * reach), 0, 1));
    dmg = Math.max(1, Math.round(dmg));
    const killed = e.damage(dmg, hb, point, d, w);
    const st = G.stats.weapons[w.id]; st.dmg += dmg;
    fx.impact(point, d.clone().negate(), crit ? 'crit' : 'enemy', e.mats[0]?.color.getHex() ?? 0xaa7744);
    const a = perEnemy.get(e) ?? { dmg: 0, crit: false, point };
    a.dmg += dmg; a.crit ||= crit; a.point = point; perEnemy.set(e, a);
    out.hit = true; out.crit ||= crit; out.point = point;
    if (killed) { out.kill = true; onKill(e, w, hb, crit, h.t); }
    else fx.hitstop(w.j.hitstop * (crit ? 1.3 : 1));
    if (!w.pierce) return out;
  }
  if (!out.point) {
    out.point = o.clone().addScaledVector(d, Math.min(world.t, w.range));
    if (world.kind) { fx.impact(out.point, world.n, 'world', WORLD_TINT[world.kind]); fx.decal(out.point, world.n); }
  }
  return out;
}

export function onKill(e, w, hb, crit, dist = 10) {
  const st = G.stats.weapons[w.id];
  if (st) st.kills++;
  if (!e.counts) return; // barrels
  G.combo++; G.comboT = 3;
  const pts = Math.round(e.def.score * (1 + Math.min(G.combo, 20) * 0.1) * (crit ? 1.5 : 1));
  G.score += pts;
  popText(e.headPos().add(new THREE.Vector3(0, 1.1, 0)), crit && hb?.tag === 'head' ? 'HEADSHOT' : 'KILL', crit ? '#ffd23f' : '#fff4dc', crit ? 1.0 : 0.85);
  fx.hitstop((w.j?.killstop ?? 0.04) * (crit ? 1.4 : 1));
  fx.addTrauma(0.08);
  sfx.kill(crit);
  haptic([15, 20, 25]);
  killHook(e, w);
}

function feedback(w, mw, dir, hit, crit, kill) {
  const j = w.j, m = settings.juice.master;
  sfx.shot(j.sound);
  haptic(j.haptic);
  fx.addTrauma(j.shake);
  fx.addKick(j.kick, rand(-0.3, 0.3) * j.kick);
  fx.fovPunch(j.fov);
  fx.muzzleWorld(mw, dir, j.tracerColor, j.flash);
  fx.flashLight(mw, 0xffc070, 14 * j.flash, 0.06, 0);
  if (J('recoil')) {
    VM.rec.vz -= j.recZ * 14 * m;
    VM.rec.vrx += j.recRot * 14 * m;
    VM.rec.vry += rand(-0.5, 0.5) * j.recRot * 4 * m;
  }
  if (J('flash')) {
    VM.flashT = 0.045;
    VM.flash.scale.setScalar(j.flash * rand(0.8, 1.25));
    VM.flash.rotation.z = rand(0, Math.PI);
    VM.light.intensity = 3 * j.flash;
  }
  if (J('shells')) {
    const delay = j.pump ? 0.38 : j.bolt ? 0.5 : 0;
    const n = 1;
    const go = () => { for (let i = 0; i < n; i++) ejectShell(w.id === 'shotgun' ? 0xc8301e : 0xd8a640, w.id === 'shotgun' ? 1.6 : w.id === 'sniper' ? 1.4 : 1); };
    delay ? setTimeout(go, delay * 1000) : go();
    if (w.id !== 'smg' || Math.random() < 0.3) sfx.shell(delay + 0.3);
  }
  if (j.pump) W.pumpT = 0.55;
  if (j.bolt) W.boltT = 0.75;
}

function ejectShell(color, s) {
  const sh = VM.shells.find(x => !x.m.visible) || VM.shells[0];
  const g = VM.guns[W.idx];
  g.userData.ejector.getWorldPosition(sh.m.position);
  sh.m.material.color.setHex(color);
  sh.m.scale.setScalar(s * VM.root.scale.x);
  sh.v.set(rand(0.7, 1.1), rand(0.9, 1.4), rand(-0.1, 0.25)).multiplyScalar(VM.root.scale.x);
  sh.w.set(rand(-20, 20), rand(-20, 20), rand(-20, 20));
  sh.life = 0.55; sh.m.visible = true;
}

// ------------------------------------------------------------------ update
export function updateWeapons(pdt, rdt) {
  const w = cur();
  W.cool -= pdt;
  W.firing = Math.max(0, W.firing - rdt);
  // bloom/climb recover when not firing
  const rec = W.firing > 0 ? 0.5 : 4;
  G.aim.bloom = Math.max(0, G.aim.bloom - rec * pdt * (w.bloom || 1));
  G.aim.climb = Math.max(0, G.aim.climb - (W.firing > 0 ? 4 : 90) * pdt);

  if (W.swapT > 0) {
    W.swapT -= rdt;
    if (W.swapTo >= 0 && W.swapT <= 0.18) {
      W.idx = W.swapTo; W.swapTo = -1;
      VM.guns.forEach((g, k) => (g.visible = k === W.idx));
      attachFlash();
      W.cool = 0;
    }
  }
  if (W.reloading) {
    W.reloadT += pdt;
    const p = W.reloadT / w.reload, seq = w.reloadSeq;
    while (W.reloadStage < seq.length && p >= seq[W.reloadStage][0]) reloadBeat(seq[W.reloadStage++][1]);
    if (p >= 1) { W.reloading = false; W.ammo[W.idx] = w.mag; reloadBeat('ready'); W.reloadPop = true; }
  }
}

const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);

export function updateViewmodel(rdt, moving) {
  const show = settings.hud.viewmodel && !G.aim.scoped && G.mode !== 'menu';
  VM.root.visible = show;
  // aim the gun at what we're shooting at (camera-local), drifting back to rest
  W.lastAimT -= rdt;
  let target;
  if (G.aim.visible) { const { o, d } = screenRay(G.aim.x, G.aim.y - G.aim.climb); target = o.clone().addScaledVector(d, 25); }
  else if (W.lastAimT > 0) target = W.lastAim;
  if (target) _v.copy(target).applyMatrix4(G.camera.matrixWorldInverse);
  else _v.set(VM.restPos.x * 0.3, VM.restPos.y * 0.2, -20);
  _m.lookAt(_v, VM.root.position, UP);
  _q.setFromRotationMatrix(_m);
  VM.aim.quaternion.slerp(_q, 1 - Math.exp(-18 * rdt));

  // recoil spring
  const r = VM.rec, K = 230, C = 21;
  r.vz += (-K * r.z - C * r.vz) * rdt; r.z += r.vz * rdt;
  r.vrx += (-K * r.rx - C * r.vrx) * rdt; r.rx += r.vrx * rdt;
  r.vry += (-K * r.ry - C * r.vry) * rdt; r.ry += r.vry * rdt;
  VM.recoil.position.set(0, 0, r.z);
  VM.recoil.rotation.set(-r.rx, r.ry, 0);

  // bob / swap / reload poses
  VM.bob += rdt * (moving ? 9 : 1.6);
  const amp = moving ? 0.012 : 0.003;
  let px = Math.sin(VM.bob) * amp, py = Math.abs(Math.cos(VM.bob)) * amp * (moving ? 1 : 0.5);
  let rx = 0, rz = 0;
  if (W.swapT > 0) { const k = 1 - Math.abs(W.swapT - 0.18) / 0.18; py -= 0.22 * k; rx += 0.9 * k; }
  if (W.reloading) {
    const p = W.reloadT / cur().reload, k = Math.sin(Math.min(1, p) * Math.PI);
    py -= 0.06 * k; rx += 0.5 * k; rz += 0.7 * k;
  }
  if (W.pumpT > 0) { W.pumpT -= rdt; const k = Math.sin(clamp((0.55 - W.pumpT) / 0.4, 0, 1) * Math.PI); if (W.pump) W.pump.position.z = 0.26 - 0.08 * k; rz -= 0.15 * k; }
  if (W.boltT > 0) { W.boltT -= rdt; const k = Math.sin(clamp((0.75 - W.boltT) / 0.5, 0, 1) * Math.PI); rz -= 0.35 * k; py -= 0.02 * k; }
  if (G.player.coverT > 0) { py -= 0.16 * G.player.coverT; rx += 0.5 * G.player.coverT; }
  const g = VM.guns[W.idx];
  g.position.set(px, py, 0);
  g.rotation.set(rx, 0, rz);

  if (VM.flashT > 0) { VM.flashT -= rdt; VM.flash.visible = true; } else VM.flash.visible = false;
  VM.light.intensity *= Math.exp(-40 * rdt);
  VM.light.position.copy(VM.root.position).add(_u.set(0, 0.1, -0.2));

  for (const s of VM.shells) {
    if (!s.m.visible) continue;
    s.life -= rdt;
    if (s.life <= 0) { s.m.visible = false; continue; }
    s.v.y -= 6 * rdt;
    s.m.position.addScaledVector(s.v, rdt);
    s.m.rotation.x += s.w.x * rdt; s.m.rotation.y += s.w.y * rdt; s.m.rotation.z += s.w.z * rdt;
  }
}

export function resetWeapons() {
  W.ammo = WEAPONS.map(w => w.mag); W.reloading = false; W.cool = 0;
  G.aim.bloom = 0; G.aim.climb = 0;
}
