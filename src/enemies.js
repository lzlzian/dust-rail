// Enemies built from primitives: bandit grunts, rocketeers, grenadiers, snipers, drones, heavies, a boss mech
// and explosive barrels. Charge-up telegraphs are layered so each layer can be toggled in the test bench.
import * as THREE from 'three';
import { G, rand, clamp, lerp } from './state.js';
import { settings } from './config.js';
import { toon, outline, INK } from './world.js';
import { sfx, haptic } from './audio.js';
import * as fx from './fx.js';
import { castWorld } from './combat.js';
import { spawnProjectile } from './projectiles.js';
import { hurtPlayer } from './player.js';
import { popText } from './hud.js';

const geoCache = new Map();
const box = (w, h, d) => { const k = `b${w},${h},${d}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d)); return geoCache.get(k); };
const cyl = (r1, r2, h, s = 8) => { const k = `c${r1},${r2},${h},${s}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(r1, r2, h, s)); return geoCache.get(k); };
const ico = (r, d = 0) => { const k = `i${r},${d}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.IcosahedronGeometry(r, d)); return geoCache.get(k); };

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const camPos = () => G.camera.position;

// target point near the player for enemy shots / projectiles
function playerPoint(spread = 0.4) {
  const c = camPos();
  return new THREE.Vector3(c.x + rand(-spread, spread), c.y - 0.15 + rand(-spread, spread) * 0.5, c.z + rand(-spread, spread));
}

function takeToken() {
  if (G.attackTokens >= settings.game.attackTokens) return false;
  G.attackTokens++;
  return true;
}
const giveToken = () => { G.attackTokens = Math.max(0, G.attackTokens - 1); };

// ---------------------------------------------------------------------------------------------
export class Enemy {
  constructor(type, spawn) {
    this.type = type;
    this.def = TYPES[type];
    this.spawn = spawn;
    this.root = new THREE.Group();
    this.mats = [];
    this.inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    this.parts = {};
    this.hitboxes = [];
    this.alive = true; this.targetable = false; this.counts = this.def.counts !== false;
    this.hp = this.maxHp = this.def.hp * (spawn.hpMul ?? 1);
    this.state = 'enter'; this.t = 0; this.stateT = 0;
    this.flash = 0; this.flinch = new THREE.Vector3(); this.flinchV = new THREE.Vector3();
    this.cool = rand(...(this.def.firstCool ?? [1.2, 2.4]));
    this.attack = null; this.charge = null; this.hasToken = false;
    this.home = new THREE.Vector3(...spawn.at);
    this.root.position.copy(this.home);
    this.def.build(this);
    G.scene.add(this.root);
    this.def.enter?.(this);
    G.enemies.push(this);
  }

  mat(color, emissive = 0x000000) {
    const m = toon(color, { emissive });
    m.userData.baseEmissive = new THREE.Color(emissive);
    this.mats.push(m);
    return m;
  }
  part(name, geo, mat, x, y, z, parent = this.root, ot = 0.03) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    outline(m, ot, this.inkMat);
    parent.add(m);
    if (name) this.parts[name] = m;
    return m;
  }
  pivot(name, x, y, z, parent = this.root) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); this.parts[name] = g; return g;
  }
  hitbox(obj, x, y, z, r, mult = 1, tag = 'body') { this.hitboxes.push({ obj, off: new THREE.Vector3(x, y, z), c: new THREE.Vector3(), r0: r, r, mult, tag }); }

  faceCamera(dt, k = 6) {
    _v.copy(camPos()).sub(this.root.position); _v.y = 0;
    const target = Math.atan2(_v.x, _v.z);
    let d = target - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, k * dt);
  }

  setState(s) { this.state = s; this.stateT = 0; }

  update(dt) {
    this.t += dt; this.stateT += dt;
    if (this.state === 'enter') {
      if (this.def.updateEnter(this, dt)) { this.setState('active'); this.targetable = true; }
    } else if (this.state === 'active') {
      this.def.ai(this, dt);
    } else if (this.state === 'stagger') {
      if (this.stateT > (this.staggerDur ?? 1.1)) this.setState('active');
    }
    // hit flash + flinch spring
    this.flash = Math.max(0, this.flash - dt * 9);
    for (const m of this.mats) m.emissive.copy(m.userData.baseEmissive).lerp(WHITE, this.flash);
    this.flinchV.addScaledVector(this.flinch, -160 * dt).multiplyScalar(Math.exp(-14 * dt));
    this.flinch.addScaledVector(this.flinchV, dt);
    if (this.parts.torso) { this.parts.torso.rotation.x = this.baseTorsoX ?? 0; this.parts.torso.rotation.x += -this.flinch.z * 0.9; this.parts.torso.rotation.z = this.flinch.x * 0.6; }
    if (this.charge) this.updateCharge(dt);
    this.updateOutline();
    this.root.updateMatrixWorld(true);
    const sc = this.root.scale.x;
    for (const hb of this.hitboxes) { hb.c.copy(hb.off).applyMatrix4(hb.obj.matrixWorld); hb.r = hb.r0 * sc; }
  }

  updateOutline() {
    if (this.charge && settings.tele.outline) {
      const p = this.charge.t / this.charge.dur;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * (10 + p * 30));
      this.inkMat.color.setHex(0xff2a10).lerp(YELLOW, pulse * 0.6);
    } else this.inkMat.color.setHex(INK);
  }

  // ---- charge-up attack (heavy, sniper, boss) ----
  startCharge(dur, opts) {
    this.charge = { t: 0, dur, dmgTaken: 0, ...opts, whine: sfx.charge(dur), lastTick: 0 };
    G.stats.charge.started++;
    this.def.chargeStart?.(this);
  }
  updateCharge(dt) {
    const c = this.charge;
    c.t += dt;
    const p = c.t / c.dur;
    if (settings.tele.haptic && navigator.vibrate) {
      const interval = lerp(0.5, 0.12, p);
      if (c.t - c.lastTick > interval) { c.lastTick = c.t; try { navigator.vibrate(12); } catch { /* */ } }
    }
    if (settings.tele.glow && c.orb) {
      c.orb.visible = true;
      c.orb.scale.setScalar(0.25 + p * 1.1 + Math.sin(this.t * 40) * 0.06);
      c.orb.material.color.setHex(p > 0.75 && Math.sin(this.t * 50) > 0 ? 0xffffff : c.color);
      if (Math.random() < 0.6) {
        c.orb.getWorldPosition(_v);
        fx.chargeMote(_w.copy(_v).add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.7, 1.2))), _v, c.color);
      }
    } else if (c.orb) c.orb.visible = false;
    if (c.laser) {
      c.laser.visible = settings.tele.laser;
      if (c.laser.visible) {
        c.orb.getWorldPosition(_v);
        const tgt = _w.copy(camPos()); tgt.y -= 0.25;
        c.laser.position.copy(_v);
        c.laser.lookAt(tgt);
        const len = _v.distanceTo(tgt);
        const w = p > 0.85 ? (Math.sin(this.t * 60) > 0 ? 0.06 : 0.02) : lerp(0.008, 0.035, p);
        c.laser.scale.set(w, w, len);
        c.laser.material.opacity = 0.35 + 0.6 * p;
      }
    }
    if (G.time.focus <= 0 && settings.tele.slowmo && p > 0.6 && !c.slowed) { c.slowed = true; G.time.slowmo = 0.6; G.time.slowmoScale = 0.4; }
    if (c.t >= c.dur) this.releaseCharge(true);
  }
  endChargeVisuals() {
    const c = this.charge;
    if (!c) return;
    c.whine?.stop();
    if (c.orb) c.orb.visible = false;
    if (c.laser) c.laser.visible = false;
  }
  releaseCharge(fire) {
    const c = this.charge;
    this.endChargeVisuals();
    this.charge = null;
    if (fire) this.def.chargeFire(this, c);
    if (this.hasToken) { giveToken(); this.hasToken = false; }
  }
  interrupt() {
    if (!this.charge) return;
    this.releaseCharge(false);
    G.stats.charge.interrupted++;
    sfx.interrupt();
    popText(this.headPos(), 'INTERRUPTED!', '#4fe3ff', 1.2);
    fx.addTrauma(0.25);
    this.staggerDur = 1.4;
    this.setState('stagger');
    this.cool = rand(2.5, 4);
  }

  headPos() { const hb = this.hitboxes.find(h => h.tag === 'head') || this.hitboxes[0]; return hb.c.clone().add(new THREE.Vector3(0, hb.r + 0.35, 0)); }

  // returns true if killed
  damage(amount, hb, point, dir, w) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 1;
    const force = (w?.force ?? 1) * (hb?.tag === 'head' ? 1.6 : 1);
    this.flinchV.add(new THREE.Vector3(rand(-1, 1) * 0.2, 0, force * 0.35));
    if (this.charge) {
      this.charge.dmgTaken += amount * (hb?.weak ? 2 : 1);
      if (this.charge.dmgTaken >= this.charge.interruptDmg) this.interrupt();
    }
    this.def.onDamage?.(this, amount, hb, point);
    if (this.hp <= 0) { this.die(dir, w, hb); return true; }
    return false;
  }

  die(dir, w, hb) {
    if (!this.alive) return;
    this.alive = false; this.targetable = false;
    if (this.charge) { this.releaseCharge(false); G.stats.charge.killed++; }
    if (this.hasToken) { giveToken(); this.hasToken = false; }
    if (this.attack?.release) this.attack.release();
    this.attack = null;
    this.def.onDeath?.(this, dir, w);
    // break apart: every top-level mesh/group flies off as physics debris
    const d = dir ? dir.clone().setY(0).normalize() : new THREE.Vector3(0, 0, -1);
    const k = (w?.force ?? 2) * (hb?.tag === 'head' ? 1.4 : 1);
    if (!this.def.noBreak) {
      const pieces = [];
      this.root.traverse(o => { if (o.isMesh && !o.userData.isOutline && o.visible && o.parent && !o.userData.noDebris) pieces.push(o); });
      for (const o of pieces) {
        const v = d.clone().multiplyScalar(rand(1, 2.5) * k * 0.6).add(new THREE.Vector3(rand(-1.5, 1.5), rand(2, 5), rand(-1.5, 1.5)));
        fx.body(o, v, new THREE.Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10)), rand(1.1, 1.8));
      }
    }
    if (w?.id === 'shotgun' || this.def.gib) fx.gib(this.root.position.clone().add(new THREE.Vector3(0, 1, 0)), this.def.gibColors ?? [0x8a4b2a, 0x3a2a20, 0xd8c09a], 10, d);
    setTimeout(() => this.dispose(), 50);
  }

  dispose() {
    this.endChargeVisuals();
    G.scene.remove(this.root);
    if (this.extra) for (const o of this.extra) G.scene.remove(o);
    // materials are left alive on purpose: the flying debris pieces still render with them
    const i = G.enemies.indexOf(this);
    if (i >= 0) G.enemies.splice(i, 1);
  }

  muzzlePos(name = 'muzzle') { const m = this.parts[name] || this.root; return m.getWorldPosition(new THREE.Vector3()); }
}

const WHITE = new THREE.Color(0xffffff), YELLOW = new THREE.Color(0xffd23f);

// --------------------------------------------- shared rig builders
function buildBandit(e, pal) {
  const s = e.spawn.scale ?? e.def.scale ?? 1.15;
  e.root.scale.setScalar(s);
  const cloth = e.mat(pal.cloth), pants = e.mat(pal.pants), skin = e.mat(pal.mask), dark = e.mat(0x2a221c), acc = e.mat(pal.accent);
  e.body = e.pivot('body', 0, 0, 0);
  const hips = e.pivot('hips', 0, 0.92, 0, e.body);
  const legL = e.pivot('legL', -0.15, 0, 0, hips), legR = e.pivot('legR', 0.15, 0, 0, hips);
  e.part(null, box(0.24, 0.9, 0.28), pants, 0, -0.45, 0, legL);
  e.part(null, box(0.24, 0.9, 0.28), pants, 0, -0.45, 0, legR);
  e.part(null, box(0.28, 0.14, 0.36), dark, 0, -0.86, 0.04, legL);
  e.part(null, box(0.28, 0.14, 0.36), dark, 0, -0.86, 0.04, legR);
  const torso = e.pivot('torso', 0, 0, 0, hips);
  e.part('chest', box(0.74, 0.72, 0.42), cloth, 0, 0.4, 0, torso);
  e.part(null, box(0.78, 0.12, 0.46), dark, 0, 0.04, 0, torso);
  e.part(null, box(0.3, 0.16, 0.5), acc, 0.33, 0.78, 0, torso); // shoulder pad
  const head = e.pivot('head', 0, 0.82, 0, torso);
  const skull = e.part('skull', box(0.46, 0.48, 0.46), skin, 0, 0.24, 0, head);
  // face details ride along with the skull when it flies off
  e.part(null, box(0.13, 0.07, 0.04), dark, -0.11, 0.04, 0.24, skull, 0.015).userData.noDebris = true;
  e.part(null, box(0.13, 0.07, 0.04), dark, 0.11, 0.04, 0.24, skull, 0.015).userData.noDebris = true;
  e.part(null, box(0.24, 0.05, 0.04), dark, 0, -0.14, 0.24, skull, 0.015).userData.noDebris = true;
  if (pal.hair) e.part(null, box(0.1, 0.18, 0.44), e.mat(pal.hair), 0, 0.56, -0.02, head);
  const armL = e.pivot('armL', -0.47, 0.68, 0, torso), armR = e.pivot('armR', 0.47, 0.68, 0, torso);
  e.part(null, box(0.2, 0.62, 0.2), cloth, 0, -0.28, 0, armL);
  e.part(null, box(0.2, 0.62, 0.2), cloth, 0, -0.28, 0, armR);
  armL.rotation.x = -1.1; armR.rotation.x = -1.2;
  e.hitbox(e.parts.skull, 0, 0, 0, 0.32, 2, 'head');
  e.hitbox(e.parts.chest, 0, 0.05, 0, 0.48, 1, 'body');
  e.hitbox(hips, 0, -0.1, 0, 0.36, 1, 'body');
  e.hitbox(hips, 0, -0.6, 0, 0.3, 0.75, 'legs');
  return { cloth, dark, acc, skin, armL, armR, torso };
}

function banditGun(e, r, len = 0.6) {
  const g = e.pivot('gun', 0, -0.5, 0.15, r.armR);
  e.part(null, box(0.1, 0.16, len), r.dark, 0, 0, len / 2 - 0.1, g);
  const mz = e.pivot('muzzle', 0, 0.02, len - 0.05, g);
  return mz;
}

// popup from behind cover, run-in from offscreen, or fly-in
function enterGeneric(e) {
  const s = e.spawn;
  e.enterMode = s.enter ?? 'popup';
  e.popDepth = s.popDepth ?? (e.home.y > 0.5 ? 1.25 : 1.9); // rooftops/towers: stand up inside the cabin
  if (e.enterMode === 'popup') { e.root.position.y = e.home.y - e.popDepth; }
  else if (e.enterMode === 'run') { e.from = new THREE.Vector3(...(s.from ?? [e.home.x + (e.home.x > 0 ? 9 : -9), e.home.y, e.home.z - 3])); e.root.position.copy(e.from); }
  else if (e.enterMode === 'drop') { e.root.position.y = e.home.y + 6; e.vy = 0; }
}
function updateEnterGeneric(e, dt) {
  const t = e.stateT - (e.spawn.delay ?? 0);
  if (t < 0) { e.root.visible = false; return false; }
  e.root.visible = true;
  e.faceCamera(dt, 20);
  if (e.enterMode === 'popup') {
    const u = clamp(t / 0.32, 0, 1);
    const ease = 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2; // overshoot
    e.root.position.y = e.home.y - e.popDepth * (1 - ease);
    return u >= 1;
  }
  if (e.enterMode === 'run') {
    e.targetable = true; // visible the whole way in, so shootable the whole way in
    _v.copy(e.home).sub(e.root.position); const d = _v.length();
    walkAnim(e, dt, (e.def.speed ?? 5) * 1.8);
    if (d < 0.1) { e.root.position.copy(e.home); return true; }
    e.root.position.addScaledVector(_v.normalize(), Math.min(d, (e.def.speed ?? 5) * dt));
    return false;
  }
  if (e.enterMode === 'drop') {
    e.vy -= 22 * dt; e.root.position.y += e.vy * dt;
    if (e.root.position.y <= e.home.y) { e.root.position.y = e.home.y; fx.impact(e.root.position.clone(), new THREE.Vector3(0, 1, 0), 'world'); fx.addTrauma(0.1); return true; }
    return false;
  }
  return true;
}
function walkAnim(e, dt, speed) {
  const ph = e.t * speed;
  if (e.parts.legL) { e.parts.legL.rotation.x = Math.sin(ph) * 0.7; e.parts.legR.rotation.x = -Math.sin(ph) * 0.7; }
  if (e.parts.hips) e.parts.hips.position.y = 0.92 + Math.abs(Math.cos(ph)) * 0.06;
}
function idleAnim(e) {
  if (e.parts.hips) e.parts.hips.position.y = 0.92 + Math.sin(e.t * 2.4) * 0.015;
  if (e.parts.legL) { e.parts.legL.rotation.x *= 0.85; e.parts.legR.rotation.x *= 0.85; }
}

// simple shot at the player with a telegraph: muzzle glows, then hitscan
function gruntAttack(e, dt, dmg, windup = 0.65) {
  if (!e.attack) {
    e.cool -= dt;
    if (e.cool <= 0 && takeToken()) { e.hasToken = true; e.attack = { t: 0 }; e.parts.flare.visible = true; }
    return;
  }
  const a = e.attack;
  a.t += dt;
  const f = e.parts.flare;
  f.scale.setScalar(0.4 + (a.t / windup) * 1.2 + Math.sin(e.t * 50) * 0.15);
  if (a.t >= windup) {
    f.visible = false;
    const from = e.muzzlePos();
    const hit = Math.random() < (e.def.accuracy ?? 0.7);
    const to = hit ? playerPoint(0.25) : playerPoint(1.6).add(new THREE.Vector3(0, 0, 0));
    fx.tracer(from, to, 0xff5030, 0.05);
    fx.muzzleWorld(from, to.clone().sub(from).normalize(), 0xff7040, 1.2);
    sfx.enemyShot(from.distanceTo(camPos()));
    if (hit) hurtPlayer(dmg, from, e.type); else sfx.whiz();
    e.attack = null; giveToken(); e.hasToken = false;
    e.cool = rand(...(e.def.cool ?? [1.6, 3.2]));
  }
}

function flare(e, parent, color = 0xff3020) {
  const f = new THREE.Mesh(ico(0.12), new THREE.MeshBasicMaterial({ color, fog: false }));
  f.visible = false; f.userData.noDebris = true; parent.add(f); e.parts.flare = f;
  return f;
}

function makeOrb(e, parent, color, r = 0.22) {
  const orb = new THREE.Mesh(ico(r, 1), new THREE.MeshBasicMaterial({ color, fog: false }));
  orb.visible = false; orb.userData.noDebris = true;
  parent.add(orb);
  return orb;
}
function makeLaser(e, color) {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  const l = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  l.visible = false; G.scene.add(l);
  (e.extra ??= []).push(l);
  return l;
}

// ---------------------------------------------------------------------------------------------
export const TYPES = {
  grunt: {
    hp: 60, score: 100,
    build(e) {
      const r = buildBandit(e, { cloth: 0xb4672e, pants: 0x4a3a30, mask: 0xefe4cf, accent: 0x7f8a90, hair: 0xd23a1e });
      const mz = banditGun(e, r);
      flare(e, mz);
    },
    enter: enterGeneric, updateEnter: updateEnterGeneric,
    ai(e, dt) { e.faceCamera(dt); idleAnim(e); gruntAttack(e, dt, 6); },
  },

  rocketeer: {
    hp: 80, score: 150,
    build(e) {
      const r = buildBandit(e, { cloth: 0x5c7a3a, pants: 0x3a3226, mask: 0xd8cdb8, accent: 0xe0a020 });
      const tube = e.pivot('tube', 0.36, 0.86, -0.05, r.torso);
      e.part(null, cyl(0.13, 0.13, 1.1, 8), e.mat(0x5b6450), 0, 0, 0.1, tube).rotation.x = Math.PI / 2;
      e.part(null, cyl(0.16, 0.13, 0.12, 8), e.mat(0xe0a020), 0, 0, 0.66, tube).rotation.x = Math.PI / 2;
      e.pivot('muzzle', 0, 0, 0.72, tube);
      flare(e, e.parts.muzzle, 0xffa020);
      r.armR.rotation.x = -2.6;
    },
    enter: enterGeneric, updateEnter: updateEnterGeneric,
    firstCool: [1.5, 2.5], cool: [3.5, 5],
    ai(e, dt) {
      e.faceCamera(dt); idleAnim(e);
      if (!e.attack) { e.cool -= dt; if (e.cool <= 0) e.attack = { t: 0 }; e.parts.flare.visible = false; return; }
      const a = e.attack; a.t += dt;
      e.parts.flare.visible = true; e.parts.flare.scale.setScalar(0.6 + a.t * 1.5 + Math.sin(e.t * 40) * 0.2);
      e.parts.tube.rotation.x = -Math.min(1, a.t / 0.5) * 0.15;
      if (a.t >= 0.75) {
        const from = e.muzzlePos();
        spawnProjectile('rocket', from, { target: playerPoint(0.3), source: e.type });
        fx.muzzleWorld(from, new THREE.Vector3(0, 0, 1), 0xffa040, 2);
        fx.addKick(0); sfx.launch();
        e.flinchV.z += 1.5;
        e.attack = null; e.cool = rand(...TYPES.rocketeer.cool);
      }
    },
  },

  grenadier: {
    hp: 70, score: 150,
    build(e) {
      const r = buildBandit(e, { cloth: 0x7a4a8a, pants: 0x332a30, mask: 0xf0d8c0, accent: 0x3a3a3a, hair: 0x2a2a2a });
      e.part(null, box(0.5, 0.3, 0.2), e.mat(0x6a5030), 0, 0.3, -0.3, r.torso);
      const hand = e.pivot('muzzle', 0, -0.62, 0, r.armR);
      e.nade = e.part(null, ico(0.12), e.mat(0x2f4a2a), 0, 0, 0, hand);
      e.nade.userData.noDebris = true;
      r.armR.rotation.x = -0.3;
    },
    enter: enterGeneric, updateEnter: updateEnterGeneric,
    firstCool: [1.8, 3], cool: [3.2, 4.8],
    ai(e, dt) {
      e.faceCamera(dt); idleAnim(e);
      const arm = e.parts.armR;
      if (!e.attack) { e.cool -= dt; arm.rotation.x = lerp(arm.rotation.x, -0.3, 0.1); if (e.cool <= 0) e.attack = { t: 0 }; return; }
      const a = e.attack; a.t += dt;
      arm.rotation.x = a.t < 0.6 ? lerp(-0.3, 2.6, a.t / 0.6) : lerp(2.6, -2.2, Math.min(1, (a.t - 0.6) / 0.12));
      if (a.t >= 0.66 && !a.thrown) {
        a.thrown = true;
        const tgt = camPos().clone(); tgt.y = 0; _v.copy(e.root.position).sub(tgt).setY(0).normalize();
        tgt.addScaledVector(_v, rand(0.8, 1.6)).add(new THREE.Vector3(rand(-0.8, 0.8), 0, 0));
        spawnProjectile('grenade', e.muzzlePos(), { target: tgt, source: e.type });
        e.nade.visible = false; sfx.lob();
      }
      if (a.t > 1.2) { e.attack = null; e.nade.visible = true; e.cool = rand(...TYPES.grenadier.cool); }
    },
  },

  sniper: {
    hp: 70, score: 200,
    build(e) {
      const r = buildBandit(e, { cloth: 0x3a4a5a, pants: 0x2a2a30, mask: 0xe6e0d0, accent: 0x9aa4ad });
      const g = e.pivot('gun', 0, -0.5, 0.15, r.armR);
      e.part(null, box(0.08, 0.12, 1.3), r.dark, 0, 0, 0.5, g);
      e.part(null, cyl(0.06, 0.06, 0.3, 6), e.mat(0x222222), 0, 0.12, 0.3, g).rotation.x = Math.PI / 2;
      const mz = e.pivot('muzzle', 0, 0.12, 0.48, g);
      e.orb = makeOrb(e, mz, 0xff2a2a, 0.12);
      e.laser = makeLaser(e, 0xff2020);
    },
    enter: enterGeneric, updateEnter: updateEnterGeneric,
    firstCool: [1.0, 2.0],
    ai(e, dt) {
      e.faceCamera(dt); idleAnim(e);
      if (!e.charge) { e.cool -= dt; if (e.cool <= 0 && takeToken()) { e.hasToken = true; e.startCharge(2.4 / Math.max(0.6, e.spawn.speed ?? 1), { orb: e.orb, laser: e.laser, color: 0xff2a2a, interruptDmg: 40 }); } }
    },
    chargeFire(e) {
      const from = e.muzzlePos();
      fx.tracer(from, playerPoint(0.1), 0xff4040, 0.12);
      fx.muzzleWorld(from, new THREE.Vector3(0, 0, 1), 0xff4040, 3);
      sfx.enemyShot(4);
      hurtPlayer(22, from, 'sniper', true);
      e.cool = rand(2.5, 4);
    },
  },

  drone: {
    hp: 30, score: 120, targetableDuringEnter: true,
    build(e) {
      const body = e.mat(0x9aa0a8), dark = e.mat(0x30343a), eye = e.mat(0xff3020, 0xff2010);
      e.root.scale.setScalar(e.spawn.scale ?? 1.1);
      const core = e.pivot('core', 0, 0, 0);
      e.part('hull', new THREE.OctahedronGeometry(0.42, 0), body, 0, 0, 0, core);
      e.part(null, box(1.3, 0.06, 0.16), dark, 0, 0.12, 0, core);
      e.part(null, box(0.16, 0.06, 1.3), dark, 0, 0.12, 0, core);
      e.rotors = [[-0.62, 0], [0.62, 0], [0, 0.62], [0, -0.62]].map(([x, z]) => {
        const r = e.part(null, box(0.5, 0.03, 0.08), dark, x, 0.2, z, core); return r;
      });
      e.part('eye', ico(0.13), eye, 0, -0.04, 0.34, core);
      e.pivot('muzzle', 0, -0.05, 0.45, core);
      flare(e, e.parts.muzzle, 0xff4020);
      e.hitbox(core, 0, 0, 0, 0.5, 1, 'body');
      e.hitbox(e.parts.eye, 0, 0, 0, 0.17, 2.2, 'head');
      e.phase = rand(0, 6);
    },
    enter(e) { e.from = new THREE.Vector3(...(e.spawn.from ?? [e.home.x + rand(-6, 6), e.home.y + 9, e.home.z - 8])); e.root.position.copy(e.from); },
    updateEnter(e, dt) {
      if (e.stateT < (e.spawn.delay ?? 0)) { e.root.visible = false; return false; }
      e.root.visible = true; e.targetable = true;
      e.root.position.lerp(e.home, 1 - Math.exp(-2.5 * dt));
      e.faceCamera(dt, 10); spin(e, dt);
      return e.root.position.distanceTo(e.home) < 0.4;
    },
    firstCool: [1.2, 2.5], cool: [2.2, 3.6],
    ai(e, dt) {
      spin(e, dt); e.faceCamera(dt, 10);
      const s = e.spawn.wander ?? 2.2;
      e.root.position.set(e.home.x + Math.sin(e.t * 0.9 + e.phase) * s, e.home.y + Math.sin(e.t * 1.7 + e.phase) * 0.6, e.home.z + Math.cos(e.t * 0.6 + e.phase) * 1.2);
      if (!e.attack) { e.cool -= dt; e.parts.flare.visible = false; if (e.cool <= 0) e.attack = { t: 0 }; return; }
      const a = e.attack; a.t += dt;
      e.parts.flare.visible = true; e.parts.flare.scale.setScalar(0.5 + a.t * 2);
      if (a.t >= 0.45) {
        spawnProjectile('bolt', e.muzzlePos(), { target: playerPoint(0.4), source: 'drone' });
        sfx.enemyShot(8);
        e.attack = null; e.cool = rand(...TYPES.drone.cool);
      }
    },
    onDeath(e) { fx.explosion(e.root.position.clone(), 0.55, { debris: 0x9aa0a8 }); },
    gibColors: [0x9aa0a8, 0x30343a, 0xff3020],
  },

  heavy: {
    hp: 420, score: 500, speed: 1.6, scale: 1.55,
    build(e) {
      const r = buildBandit(e, { cloth: 0x8a2f24, pants: 0x3a2e28, mask: 0x9aa0a8, accent: 0xd8a030 });
      r.torso.scale.set(1.35, 1.12, 1.3);
      e.parts.skull.scale.set(0.9, 0.85, 0.9);
      e.part(null, box(0.9, 0.22, 0.55), e.mat(0x5a5a62), 0, 0.82, 0, r.torso); // collar armour
      // arm cannon
      const can = e.pivot('cannon', 0, -0.48, 0.2, r.armR);
      e.part(null, box(0.36, 0.36, 0.9), e.mat(0x4a4f58), 0, 0, 0.25, can);
      e.part(null, cyl(0.2, 0.24, 0.2, 8), e.mat(0xd8a030), 0, 0, 0.75, can).rotation.x = Math.PI / 2;
      const coreMat = e.mat(0x4fe3ff, 0x1a8fc0);
      e.core = e.part('core', ico(0.17, 1), coreMat, 0, 0.24, 0.15, can);
      const mz = e.pivot('muzzle', 0, 0, 0.9, can);
      e.orb = makeOrb(e, mz, 0x4fe3ff, 0.26);
      e.laser = makeLaser(e, 0x4fe3ff);
      e.hitbox(e.core, 0, 0, 0, 0.24, 3, 'core'); e.hitboxes[e.hitboxes.length - 1].weak = true;
      r.armR.rotation.x = -1.45; r.armL.rotation.x = -0.5;
    },
    enter: enterGeneric, updateEnter: updateEnterGeneric,
    firstCool: [1.0, 1.8],
    ai(e, dt) {
      e.faceCamera(dt, 3);
      // lumber toward a stop distance while not charging
      _v.copy(camPos()).sub(e.root.position).setY(0);
      const d = _v.length();
      if (!e.charge && d > (e.spawn.stopDist ?? 9)) { e.root.position.addScaledVector(_v.normalize(), TYPES.heavy.speed * dt); walkAnim(e, dt, 5); fx.addTrauma(Math.abs(Math.sin(e.t * 5)) > 0.98 ? 0.03 : 0); }
      else idleAnim(e);
      if (!e.charge) {
        e.cool -= dt;
        if (e.cool <= 0 && takeToken()) { e.hasToken = true; e.startCharge(e.spawn.chargeDur ?? 2.8, { orb: e.orb, laser: e.laser, color: 0x4fe3ff, interruptDmg: 150 }); }
      }
    },
    chargeFire(e) {
      const from = e.muzzlePos();
      fx.tracer(from, playerPoint(0.05), 0x4fe3ff, 0.45);
      fx.explosion(from, 0.5, { color: 0x4fe3ff, silent: true, trauma: 0.2 });
      sfx.beam();
      hurtPlayer(30, from, 'heavy', true);
      e.cool = rand(4, 5.5);
    },
    onDamage(e, amt, hb) { if (hb?.weak) popText(hb.c, 'WEAK POINT', '#4fe3ff', 0.7); },
    onDeath(e) { fx.explosion(e.core.getWorldPosition(new THREE.Vector3()), 1.0, { color: 0x4fe3ff }); },
  },

  barrel: {
    hp: 15, score: 25, counts: false, noBreak: true,
    build(e) {
      const red = e.mat(0xd8341e), band = e.mat(0xf2c63a);
      e.part('can', cyl(0.42, 0.42, 1.1, 10), red, 0, 0.55, 0, e.root, 0.04);
      e.part(null, cyl(0.43, 0.43, 0.16, 10), band, 0, 0.62, 0, e.root, 0);
      e.hitbox(e.parts.can, 0, 0, 0, 0.55, 1, 'body');
    },
    enter() {}, updateEnter() { return true; },
    ai() {},
    onDeath(e) {
      const p = e.root.position.clone().add(new THREE.Vector3(0, 0.6, 0));
      fx.explosion(p, 1.3, { debris: 0xd8341e });
      G.scene.remove(e.root);
      blast(p, 4.8, 220, e);
    },
  },

  boss: {
    hp: 2600, score: 5000, targetableDuringEnter: false, noBreak: false,
    build(e) {
      // portrait has sky to spare: the boss goes tall rather than wide
      e.root.scale.setScalar(e.spawn.scale ?? 1.45);
      const hull = e.mat(0xc9a15a), dark = e.mat(0x3a3530), metal = e.mat(0x7c8590), red = e.mat(0xd8341e);
      e.isBoss = true;
      e.body = e.pivot('body', 0, 0, 0);
      const hips = e.pivot('hips', 0, 3.4, 0, e.body);
      for (const sx of [-1, 1]) {
        const leg = e.pivot(sx < 0 ? 'legL' : 'legR', sx * 1.25, 0, 0, hips);
        e.part(null, box(0.8, 1.8, 0.9), metal, 0, -0.8, 0, leg, 0.06);
        e.part(null, box(0.95, 1.7, 1.05), dark, 0, -2.4, 0.1, leg, 0.06);
        e.part(null, box(1.3, 0.35, 1.7), metal, 0, -3.2, 0.25, leg, 0.06);
      }
      const torso = e.pivot('torso', 0, 0, 0, hips);
      e.part('hullMesh', box(3.2, 2.2, 2.4), hull, 0, 1.3, 0, torso, 0.07);
      e.part(null, box(3.4, 0.4, 2.6), dark, 0, 0.2, 0, torso, 0.06);
      e.part(null, box(1.2, 0.5, 0.2), e.mat(0x2a3a4a, 0x0a2030), 0, 2.0, 1.22, torso, 0.04); // visor
      for (const sx of [-1, 1]) e.part(null, box(0.3, 0.3, 0.1), red, sx * 1.2, 2.1, 1.22, torso, 0.03);
      // shoulder missile pods (destructible weak points)
      e.pods = [-1, 1].map(sx => {
        const pod = e.pivot(sx < 0 ? 'podL' : 'podR', sx * 2.15, 2.4, 0, torso);
        const m = e.part(null, box(1.1, 1.0, 1.4), e.mat(0x5c6450), 0, 0, 0, pod, 0.05);
        for (let i = 0; i < 4; i++) e.part(null, cyl(0.12, 0.12, 0.06, 6), red, -0.25 + (i % 2) * 0.5, 0.2 - Math.floor(i / 2) * 0.4, 0.7, pod, 0).rotation.x = Math.PI / 2;
        const hb = { obj: pod, off: new THREE.Vector3(0, 0, 0.2), c: new THREE.Vector3(), r0: 0.75, r: 0.75, mult: 1.5, tag: 'pod', weak: true, podHp: 300, pod, mesh: m };
        e.hitboxes.push(hb);
        return hb;
      });
      // chest core (charge beam)
      const coreMat = e.mat(0x4fe3ff, 0x1a8fc0);
      e.core = e.part('core', ico(0.45, 1), coreMat, 0, 1.2, 1.25, torso, 0.05);
      e.pivot('muzzle', 0, 1.2, 1.6, torso);
      e.orb = makeOrb(e, e.parts.muzzle, 0x4fe3ff, 0.45);
      e.laser = makeLaser(e, 0x4fe3ff);
      // chaingun arm
      const arm = e.pivot('arm', 1.9, 1.0, 0.6, torso);
      e.part(null, box(0.6, 0.6, 1.6), metal, 0, 0, 0.6, arm, 0.05);
      e.part(null, cyl(0.25, 0.25, 0.8, 8), dark, 0, 0, 1.6, arm, 0.04).rotation.x = Math.PI / 2;
      e.pivot('gunMz', 0, 0, 2.05, arm);
      flare(e, e.parts.gunMz, 0xff7020);
      e.hitbox(e.core, 0, 0, 0, 0.6, 2.5, 'core'); e.hitboxes[e.hitboxes.length - 1].weak = true;
      e.hitbox(e.parts.hullMesh, 0, 0, 0, 1.5, 1, 'body');
      e.hitbox(e.parts.hullMesh, -1.0, 0.2, 0, 1.0, 1, 'body');
      e.hitbox(e.parts.hullMesh, 1.0, 0.2, 0, 1.0, 1, 'body');
      e.phaseIdx = 0; e.cycle = ['missiles', 'gun', 'beam', 'gun', 'missiles', 'beam'];
    },
    enter(e) { e.root.position.y = 0; e.root.position.z = e.home.z - 16; },
    updateEnter(e, dt) {
      if (e.stateT < 0.2) return false;
      _v.copy(e.home).sub(e.root.position); const d = _v.length();
      walkAnim(e, dt, 3.5);
      if (Math.sin(e.t * 3.5) > 0.97) fx.addTrauma(0.12);
      if (d < 0.1) { fx.addTrauma(0.5); return true; }
      e.root.position.addScaledVector(_v.normalize(), Math.min(d, 4 * dt));
      e.faceCamera(dt, 4);
      return false;
    },
    firstCool: [1.2, 1.2],
    ai(e, dt) {
      e.faceCamera(dt, 2); idleAnim(e);
      if (e.parts.hips) e.parts.hips.position.y = 3.4 + Math.sin(e.t * 2) * 0.05;
      const rage = e.hp < e.maxHp * 0.5 ? 1.35 : 1;
      if (e.attack) { e.attack.update(dt * rage); return; }
      if (e.charge) return;
      e.cool -= dt * rage;
      if (e.cool > 0) return;
      const move = e.cycle[e.phaseIdx++ % e.cycle.length];
      if (move === 'missiles' && e.pods.some(p => p.podHp > 0)) bossMissiles(e);
      else if (move === 'beam') e.startCharge(3.2, { orb: e.orb, laser: e.laser, color: 0x4fe3ff, interruptDmg: 260 });
      else bossGun(e);
    },
    chargeFire(e) {
      const from = e.muzzlePos();
      fx.tracer(from, playerPoint(0.05), 0x4fe3ff, 0.9);
      fx.explosion(from, 0.9, { color: 0x4fe3ff, silent: true, trauma: 0.3 });
      sfx.beam();
      hurtPlayer(35, from, 'boss', true);
      e.cool = 1.5;
    },
    onDamage(e, amt, hb) {
      if (hb?.tag === 'pod' && hb.podHp > 0) {
        hb.podHp -= amt;
        if (hb.podHp <= 0) {
          const p = hb.pod.getWorldPosition(new THREE.Vector3());
          fx.explosion(p, 1.6, { debris: 0x5c6450 });
          popText(p, 'POD DESTROYED', '#ffd23f', 1.3);
          hb.pod.visible = false; hb.r0 = 0.001;
          e.hp -= 250; e.staggerDur = 1.2; if (!e.charge) e.setState('stagger');
        }
      }
    },
    onDeath(e) {
      const p = e.root.position.clone().add(new THREE.Vector3(0, 4, 0));
      for (let i = 0; i < 5; i++) setTimeout(() => fx.explosion(p.clone().add(new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-1, 1))), 1.6), i * 160);
      G.time.slowmo = 1.4; G.time.slowmoScale = 0.3;
    },
  },
};

function spin(e, dt) { for (const r of e.rotors) r.rotation.y += dt * 40; }

function bossMissiles(e) {
  const pods = e.pods.filter(p => p.podHp > 0);
  let n = 0;
  const total = pods.length * 3;
  e.attack = {
    t: 0, next: 0.45,
    update(dt) {
      this.t += dt;
      if (this.t >= this.next && n < total) {
        const pod = pods[n % pods.length];
        if (pod.podHp > 0) {
          const from = pod.pod.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0.8));
          spawnProjectile('missile', from, { target: playerPoint(0.6), source: 'boss' });
          sfx.launch();
          fx.muzzleWorld(from, new THREE.Vector3(0, 1, 0), 0xffa040, 2.5);
        }
        n++; this.next += 0.42;
      }
      if (n >= total && this.t > this.next + 0.6) { e.attack = null; e.cool = 1.8; }
    },
  };
}

function bossGun(e) {
  let shots = 0;
  e.attack = {
    t: 0,
    update(dt) {
      this.t += dt;
      const f = e.parts.flare;
      if (this.t < 0.9) { f.visible = true; f.scale.setScalar(1 + this.t * 3 + Math.sin(e.t * 50)); return; }
      if (this.t > 0.9 + shots * 0.12 && shots < 10) {
        shots++;
        const from = e.muzzlePos('gunMz');
        const hit = Math.random() < 0.3;
        const to = hit ? playerPoint(0.3) : playerPoint(2);
        fx.tracer(from, to, 0xff7030, 0.08);
        sfx.enemyShot(6);
        if (hit) hurtPlayer(3, from, 'boss'); else if (Math.random() < 0.3) sfx.whiz();
      }
      if (shots >= 10) { f.visible = false; e.attack = null; e.cool = 1.2; }
    },
  };
}

// area damage to enemies (barrels, grenades). Exposed for the grenade ability too.
export function blast(p, radius, dmg, source, w) {
  for (const e of [...G.enemies]) {
    if (!e.alive || e === source) continue;
    const d = e.root.position.distanceTo(p) - (e.isBoss ? 2 : 0);
    if (d > radius) continue;
    const amt = dmg * (1 - (d / radius) * 0.6);
    const dir = e.root.position.clone().sub(p).normalize();
    if (e.state === 'enter' && !e.root.visible) continue;
    const killed = e.damage(amt, null, e.root.position, dir, w ?? { force: 6, id: 'blast' });
    popText(e.headPos(), Math.round(amt), '#ff9a3a', 1.1);
    if (killed) onEnemyKilledHook?.(e, null, 'blast');
  }
  for (const pr of G.projectiles) if (pr.alive && pr.pos.distanceTo(p) < radius) pr.detonate(false);
}

let onEnemyKilledHook = null;
export function setKillHook(fn) { onEnemyKilledHook = fn; }

export function clearEnemies() {
  for (const e of [...G.enemies]) { e.alive = false; e.endChargeVisuals(); e.dispose(); }
  G.enemies.length = 0; G.attackTokens = 0;
}

export function spawnEnemy(type, spawn) { return new Enemy(type, spawn); }

export function updateEnemies(dt) {
  for (const e of [...G.enemies]) if (e.alive) e.update(dt);
}

// castWorld is re-exported for enemies that need line of sight checks later
export { castWorld };
