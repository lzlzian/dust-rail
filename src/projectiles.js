// Shootable incoming projectiles: rockets, boss missiles, lobbed grenades and drone bolts.
// Their *shootable* radius is r * settings.projHitMult (see combat.js), visualised by the HUD danger markers.
import * as THREE from 'three';
import { G, rand } from './state.js';
import { settings } from './config.js';
import { toon, outline } from './world.js';
import * as fx from './fx.js';
import { sfx } from './audio.js';
import { hurtPlayer } from './player.js';
import { blast } from './enemies.js';
import { popText } from './hud.js';
import { castWorld } from './combat.js';

const GRAV = 14;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);

const geos = {};
function geo(k, make) { return geos[k] ??= make(); }
const mats = {};
function mat(k, make) { return mats[k] ??= make(); }

function buildRocket(scale = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo('rb', () => new THREE.CylinderGeometry(0.11, 0.11, 0.7, 8).rotateX(Math.PI / 2)), mat('rb', () => toon(0xd8d2c4)));
  const nose = new THREE.Mesh(geo('rn', () => new THREE.ConeGeometry(0.11, 0.25, 8).rotateX(Math.PI / 2).translate(0, 0, 0.47)), mat('rn', () => toon(0xd8341e)));
  const fin = new THREE.Mesh(geo('rf', () => new THREE.BoxGeometry(0.4, 0.04, 0.16).translate(0, 0, -0.3)), mat('rf', () => toon(0x3a3a3a)));
  const fin2 = fin.clone(); fin2.rotation.z = Math.PI / 2;
  const glow = new THREE.Mesh(geo('rg', () => new THREE.IcosahedronGeometry(0.15, 0).translate(0, 0, -0.42)), mat('rg', () => new THREE.MeshBasicMaterial({ color: 0xffd060, fog: false })));
  const blink = new THREE.Mesh(geo('rk', () => new THREE.IcosahedronGeometry(0.07, 0).translate(0, 0.12, 0.15)), new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false }));
  for (const m of [body, nose, fin, fin2]) outline(m, 0.03);
  g.add(body, nose, fin, fin2, glow, blink);
  g.scale.setScalar(scale);
  g.userData.blink = blink;
  return g;
}

function buildGrenade() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(geo('gb', () => new THREE.IcosahedronGeometry(0.16, 0)), mat('gb', () => toon(0x3a5a2a)));
  const cap = new THREE.Mesh(geo('gc', () => new THREE.BoxGeometry(0.08, 0.1, 0.08).translate(0, 0.17, 0)), mat('gc', () => toon(0xbbbbbb)));
  const blink = new THREE.Mesh(geo('gk', () => new THREE.IcosahedronGeometry(0.06, 0).translate(0, 0.24, 0)), new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false }));
  outline(b, 0.03); outline(cap, 0.02);
  g.add(b, cap, blink);
  g.userData.blink = blink;
  return g;
}

function buildBolt() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(geo('bc', () => new THREE.IcosahedronGeometry(0.13, 0)), mat('bc', () => new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })));
  const shell = new THREE.Mesh(geo('bs', () => new THREE.IcosahedronGeometry(0.22, 0)), mat('bs', () => new THREE.MeshBasicMaterial({ color: 0xff3a20, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
  g.add(core, shell);
  return g;
}

export class Projectile {
  constructor(kind, from, { target, source }) {
    this.kind = kind; this.source = source;
    this.pos = from.clone();
    this.alive = true; this.shootable = true; this.t = 0; this.trailT = 0;
    this.target = target.clone();
    const sp = settings.game.projSpeed;
    if (kind === 'rocket') {
      this.r = 0.28; this.dmg = 16; this.speed = 8 * sp;
      this.vel = target.clone().sub(from).normalize().multiplyScalar(this.speed);
      this.mesh = buildRocket(1.15);
    } else if (kind === 'missile') {
      this.r = 0.3; this.dmg = 10; this.speed = 3;
      this.vel = new THREE.Vector3(rand(-3, 3), rand(5, 7), 2).multiplyScalar(sp);
      this.mesh = buildRocket(1.0);
    } else if (kind === 'grenade') {
      this.r = 0.24; this.dmg = 14;
      const T = 1.55 / sp;
      this.vel = target.clone().sub(from).divideScalar(T); this.vel.y += 0.5 * GRAV * T;
      this.fuse = -1;
      this.mesh = buildGrenade();
    } else {
      this.r = 0.2; this.dmg = 5; this.speed = 10 * sp;
      this.vel = target.clone().sub(from).normalize().multiplyScalar(this.speed);
      this.mesh = buildBolt();
    }
    this.mesh.position.copy(this.pos);
    G.scene.add(this.mesh);
    G.projectiles.push(this);
    G.stats.proj.spawned++;
  }

  // seconds until it reaches the player (rough, for danger markers)
  get eta() {
    const d = this.pos.distanceTo(G.camera.position);
    return d / Math.max(1, this.vel.length());
  }

  update(dt) {
    this.t += dt;
    const cam = G.camera.position;
    const sp = settings.game.projSpeed;
    if (this.kind === 'rocket') {
      _v.copy(cam).setY(cam.y - 0.15).sub(this.pos).normalize().multiplyScalar(this.speed);
      this.vel.lerp(_v, 1 - Math.exp(-0.8 * dt));
    } else if (this.kind === 'missile') {
      this.speed = Math.min(12 * sp, this.speed + 7 * sp * dt);
      if (this.t > 0.45) {
        _v.copy(this.target).sub(this.pos).normalize().multiplyScalar(this.speed);
        this.vel.lerp(_v, 1 - Math.exp(-(this.t > 1.2 ? 4 : 2.2) * dt));
        this.target.lerp(cam, 1 - Math.exp(-1.5 * dt));
      } else this.vel.multiplyScalar(Math.exp(-1.5 * dt));
    } else if (this.kind === 'grenade') {
      if (this.fuse < 0) this.vel.y -= GRAV * sp * sp * dt;
    }
    this.pos.addScaledVector(this.vel, dt);

    if (this.kind === 'grenade') {
      if (this.fuse < 0 && this.pos.y <= 0.16) {
        this.pos.y = 0.16; this.vel.set(0, 0, 0); this.fuse = 0.45;
        fx.impact(this.pos.clone(), new THREE.Vector3(0, 1, 0), 'world');
      }
      if (this.fuse >= 0) { this.fuse -= dt; if (this.fuse <= 0) return this.detonate(true); }
      this.mesh.rotation.x += dt * 9; this.mesh.rotation.z += dt * 5;
    } else {
      this.mesh.quaternion.setFromUnitVectors(Z, _w.copy(this.vel).normalize());
    }
    this.mesh.position.copy(this.pos);
    const bl = this.mesh.userData.blink;
    if (bl) bl.visible = Math.sin(this.t * (this.kind === 'grenade' && this.fuse >= 0 ? 60 : 22)) > 0;
    if (this.kind !== 'bolt' && this.kind !== 'grenade') {
      this.trailT -= dt;
      if (this.trailT <= 0) { this.trailT = 0.025; fx.smokeTrail(this.pos.clone().addScaledVector(_w, -0.45), 0xe0d4c0, 0.2); }
    } else if (this.kind === 'bolt' && Math.random() < 0.5) fx.chargeMote(this.pos.clone(), this.pos.clone().addScaledVector(this.vel, -0.05), 0xff3a20);

    // reached the player?
    if (this.kind !== 'grenade' && this.pos.distanceTo(cam) < 0.9) return this.detonate(true);
    if (this.kind !== 'grenade' && this.pos.y < 0.05) return this.detonate(false);
    if (this.t > 12) return this.remove();
  }

  // hitPlayer: true when it reached the player (cover may still block it)
  detonate(hitPlayer) {
    if (!this.alive) return;
    const cam = G.camera.position;
    const big = this.kind !== 'bolt';
    if (hitPlayer) {
      if (this.kind === 'grenade') {
        const d = this.pos.distanceTo(_v.copy(cam).setY(0));
        if (d < 3.4) hurtPlayer(this.dmg * (1 - d / 6), this.pos, this.source + ' grenade');
      } else {
        // pull the visible explosion out in front of the lens so it reads
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
        this.pos.copy(cam).addScaledVector(fwd, 3).add(new THREE.Vector3(0, -0.6, 0));
        this.nearCam = true;
        if (hurtPlayer(this.dmg, this.pos, this.source + ' ' + this.kind) === false) G.stats.proj.blocked++;
        else G.stats.proj.hitPlayer++;
      }
    }
    // hits on the player stay small: the vignette + shake carry the message, the fireball must not blind you
    if (big) fx.explosion(this.pos.clone(), this.nearCam ? 0.35 : this.kind === 'grenade' ? 1.0 : 0.75, { trauma: this.nearCam ? 0.2 : 0.7 });
    else { fx.explosion(this.pos.clone(), 0.3, { color: 0xff3a20, silent: true, trauma: 0.1 }); }
    this.remove();
  }

  // shot down by the player
  intercept(w) {
    if (!this.alive) return;
    G.stats.proj.intercepted++;
    sfx.intercept();
    popText(this.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), 'INTERCEPT!', '#4fe3ff', this.kind === 'bolt' ? 0.8 : 1.1);
    G.score += this.kind === 'bolt' ? 25 : 75;
    const p = this.pos.clone();
    if (this.kind !== 'bolt') {
      fx.explosion(p, 0.8, { trauma: 0.2 });
      blast(p, 2.8, 90, null, { force: 5, id: 'intercept' });
    } else fx.explosion(p, 0.3, { color: 0xff3a20, silent: true, trauma: 0.05 });
    fx.hitstop(0.03);
    this.remove();
  }

  remove() {
    this.alive = false;
    G.scene.remove(this.mesh);
    const i = G.projectiles.indexOf(this);
    if (i >= 0) G.projectiles.splice(i, 1);
  }
}

export function spawnProjectile(kind, from, opts) { return new Projectile(kind, from, opts); }

export function updateProjectiles(dt) {
  for (const p of [...G.projectiles]) if (p.alive) p.update(dt);
}

export function clearProjectiles() { for (const p of [...G.projectiles]) p.remove(); }

// player's thrown grenade (ability) — not shootable, explodes on landing
export class PlayerGrenade {
  constructor(from, target) {
    this.pos = from.clone(); this.alive = true; this.t = 0;
    const T = 0.75;
    this.vel = target.clone().sub(from).divideScalar(T); this.vel.y += 0.5 * GRAV * T;
    this.mesh = buildGrenade(); this.mesh.scale.setScalar(1.3);
    G.scene.add(this.mesh);
  }
  update(dt) {
    this.t += dt;
    this.vel.y -= GRAV * dt;
    const prev = this.pos.clone();
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos); this.mesh.rotation.x += dt * 12;
    const d = this.pos.clone().sub(prev); const len = d.length();
    const hitWorld = len > 0 && castWorld(prev, d.divideScalar(len), len).t < len;
    if (this.pos.y <= 0.2 || hitWorld || this.t > 3) {
      this.alive = false; G.scene.remove(this.mesh);
      fx.explosion(this.pos.clone(), 1.5, { trauma: 0.8 });
      blast(this.pos, 5.5, 260, null, { force: 9, id: 'grenade' });
    }
  }
}
