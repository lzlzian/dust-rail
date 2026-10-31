// The level: a desert canyon built from primitives, five on-rails stops, waves, and the endless range.
// Encounters are laid out vertically (towers, roofs, flyers) so a tall portrait view has something to show.
import * as THREE from 'three';
import { G, rand, smooth, clamp } from './state.js';
import { StaticBatch, jitter, boxCollider, sphereCollider } from './world.js';
import { spawnEnemy, clearEnemies } from './enemies.js';
import { clearProjectiles } from './projectiles.js';
import { rig, resetLook } from './camera.js';
import { banner, setStage } from './hud.js';
import { sfx } from './audio.js';
import { clearFx } from './fx.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const EYE = 1.7;

// ------------------------------------------------------------------ geometry helpers
let B;
const C = { sand: 0xe2b679, sandDark: 0xc99a5e, road: 0xb98a58, wood: 0xa8733f, woodDark: 0x7a4f2c, metal: 0x7c8590, rust: 0xa65a32, rock1: 0xc4683a, rock2: 0xd88a4e, rock3: 0xb25530, rockTop: 0xe0a060, sandbag: 0xcdb486, tin: 0x9aa6a8, red: 0xd8341e, yellow: 0xf2c63a };

function box(x, y, z, w, h, d, color, { ry = 0, collide = true, ol = 0.05, fv = 0.07 } = {}) {
  B.add(new THREE.BoxGeometry(w, h, d), { x, y: y + h / 2, z, ry }, color, ol, fv);
  if (collide) boxCollider(x, y, z, w, h, d, ry);
}
function crate(x, z, s = 1.2, ry = 0, y = 0) {
  box(x, y, z, s, s, s, C.wood, { ry });
  B.add(new THREE.BoxGeometry(s * 1.03, s * 0.12, s * 1.03), { x, y: y + s * 0.5, z, ry }, C.woodDark, 0, 0.03);
  B.add(new THREE.BoxGeometry(s * 1.03, s * 1.03, s * 0.12), { x, y: y + s * 0.5, z, ry: ry + Math.PI / 4 }, C.woodDark, 0, 0.03);
}
function sandbags(x, z, w = 3, ry = 0) {
  for (let r = 0; r < 2; r++) for (let i = 0; i < Math.round(w / 0.75); i++) {
    const lx = -w / 2 + 0.375 + i * 0.75 + (r % 2) * 0.3;
    if (lx > w / 2) continue;
    const c = Math.cos(ry), s = Math.sin(ry);
    B.add(new THREE.BoxGeometry(0.72, 0.42, 0.55, 1, 1, 1), { x: x + lx * c, y: 0.21 + r * 0.42, z: z - lx * s, ry, sx: 1, sy: 1, sz: 1 }, C.sandbag, 0.035, 0.1);
  }
  boxCollider(x, 0, z, w, 0.84, 0.6, ry);
}
function rock(x, y, z, r, color, { sx = 1, sy = 1, sz = 1, collide = true, det = 1, seed = Math.random() * 10 } = {}) {
  const g = jitter(new THREE.IcosahedronGeometry(r, det), r * 0.45, seed);
  B.add(g, { x, y, z, sx, sy, sz }, color, 0.12, 0.09);
  if (collide) sphereCollider(x, y, z, r * Math.min(sx, sy, sz) * 0.9);
}
function mesa(x, z, w, h, d, collide = false) {
  const layers = [C.rock3, C.rock1, C.rock2, C.rock1];
  let y = 0, k = 1;
  const n = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    const lh = h / n;
    const g = jitter(new THREE.BoxGeometry(w * k, lh, d * k, 3, 1, 3), Math.min(w, d) * 0.12, x + z + i);
    B.add(g, { x, y: y + lh / 2, z, ry: rand(-0.1, 0.1) }, layers[i % layers.length], 0.18, 0.06);
    y += lh * 0.98; k *= rand(0.82, 0.95);
  }
  B.add(jitter(new THREE.BoxGeometry(w * k * 1.04, 0.5, d * k * 1.04, 2, 1, 2), 0.4, x), { x, y: y + 0.2, z }, C.rockTop, 0.15, 0.05);
  if (collide) boxCollider(x, 0, z, w, h, d);
}
function cactus(x, z, h = 3) {
  const g = 0x5f8f3a;
  B.add(new THREE.CylinderGeometry(0.28, 0.32, h, 7), { x, y: h / 2, z }, g, 0.05);
  B.add(new THREE.CylinderGeometry(0.18, 0.2, h * 0.35, 6), { x: x + 0.55, y: h * 0.6, z }, g, 0.04);
  B.add(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 6), { x: x + 0.38, y: h * 0.45, z, rz: Math.PI / 2 }, g, 0.04);
  B.add(new THREE.CylinderGeometry(0.16, 0.18, h * 0.3, 6), { x: x - 0.5, y: h * 0.5, z }, g, 0.04);
  B.add(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 6), { x: x - 0.32, y: h * 0.38, z, rz: Math.PI / 2 }, g, 0.04);
}
function shack(x, z, w, h, d, ry = 0, roofColor = C.rust) {
  box(x, 0, z, w, h, d, C.tin, { ry });
  B.add(new THREE.BoxGeometry(w + 0.6, 0.18, d + 0.6), { x, y: h + 0.09, z, ry, rz: 0.06 }, roofColor, 0.05);
  B.add(new THREE.BoxGeometry(1.0, 1.9, 0.08), { x: x + Math.sin(ry) * (d / 2 + 0.02), y: 0.95, z: z + Math.cos(ry) * (d / 2 + 0.02), ry }, C.woodDark, 0.03);
  B.add(new THREE.BoxGeometry(0.9, 0.7, 0.06), { x: x + Math.sin(ry) * (d / 2 + 0.02) + 1.4 * Math.cos(ry), y: 1.6, z: z + Math.cos(ry) * (d / 2 + 0.02) - 1.4 * Math.sin(ry), ry }, 0x3a2a20, 0.03);
}
// tower with a solid cabin on top; enemies pop up from inside the cabin
function tower(x, z, H, cabin = 2.8) {
  for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.add(new THREE.BoxGeometry(0.3, H, 0.3), { x: x + lx * cabin * 0.38, y: H / 2, z: z + lz * cabin * 0.38 }, C.woodDark, 0.04);
  for (let i = 1; i < 4; i++) B.add(new THREE.BoxGeometry(cabin * 0.8, 0.14, 0.14), { x, y: (H * i) / 4, z: z + cabin * 0.38 }, C.wood, 0.03);
  box(x, H, z, cabin, 1.25, cabin, C.wood);
  B.add(new THREE.BoxGeometry(cabin + 0.3, 0.16, cabin + 0.3), { x, y: H + 1.25, z }, C.woodDark, 0.04);
  B.add(new THREE.ConeGeometry(cabin * 0.85, 1.4, 4), { x, y: H + 3.4, z, ry: Math.PI / 4 }, C.rust, 0.06);
  for (const [lx, lz] of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) B.add(new THREE.BoxGeometry(0.14, 2.1, 0.14), { x: x + lx * cabin * 0.45, y: H + 2.3, z: z + lz * cabin * 0.45 }, C.woodDark, 0.03);
  boxCollider(x, 0, z, cabin * 0.8, H, cabin * 0.8);
}
function barrelSpawn(x, z) { return { type: 'barrel', at: [x, 0, z] }; }

function road(a, b) {
  const d = b.clone().sub(a); const len = d.length();
  B.add(new THREE.BoxGeometry(5, 0.04, len + 4), { x: (a.x + b.x) / 2, y: 0.0, z: (a.z + b.z) / 2, ry: Math.atan2(d.x, d.z) }, C.road, 0, 0.05);
}

function ground() {
  const g = new THREE.PlaneGeometry(320, 360, 64, 72).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const ax = Math.max(0, Math.abs(x) - 16);
    p.setY(i, ax > 0 ? Math.pow(ax, 1.25) * 0.12 + Math.sin(x * 0.11) * Math.cos(z * 0.13) * ax * 0.05 : 0);
  }
  B.add(g, { z: -110, y: -0.02 }, C.sand, 0, 0.06);
}

// ------------------------------------------------------------------ encounters
// Each: stop (camera), look target, path from the previous stop, waves.
// wave: { spawns, delay (s after previous wave), nextAt (advance when <= this many counted enemies alive) }
export const ENCOUNTERS = [
  {
    name: 'THE GATE', stop: V(0, EYE, -10), look: V(0, 3.4, -26), path: [V(0, EYE, 6), V(0, EYE, -10)],
    waves: [
      { spawns: [
        { type: 'grunt', at: [-4.4, 0, -19.4] }, { type: 'grunt', at: [4.4, 0, -21.6], delay: 0.5 },
        { type: 'grunt', at: [-3.6, 5.15, -30], delay: 1.0, scale: 1.1 },
        barrelSpawn(-7.2, -20.5), barrelSpawn(6.8, -24),
      ] },
      { delay: 0.5, spawns: [
        { type: 'grunt', at: [0.5, 0, -23], enter: 'run', from: [0, 0, -36] },
        { type: 'grunt', at: [-1.8, 0, -24], enter: 'run', from: [-1, 0, -38], delay: 0.6 },
        { type: 'rocketeer', at: [3.6, 5.15, -30], delay: 0.8 },
      ] },
    ],
  },
  {
    name: 'SCRAPYARD', stop: V(2, EYE, -47), look: V(3, 3.6, -64), path: [V(0, EYE, -10), V(0, EYE, -24), V(1, EYE, -35), V(2, EYE, -47)],
    waves: [
      { spawns: [
        { type: 'grenadier', at: [-2.5, 0, -56.6] }, { type: 'grunt', at: [6.2, 0, -57.8], delay: 0.4 },
        { type: 'grunt', at: [9, 0, -54], enter: 'run', from: [18, 0, -54], delay: 0.8 },
        barrelSpawn(0.5, -58.5), barrelSpawn(-6, -52),
      ] },
      { delay: 0.5, nextAt: 1, spawns: [
        { type: 'rocketeer', at: [10.6, 4.62, -63], enter: 'popup' },
        { type: 'drone', at: [-3, 6.5, -56], wander: 2.5 }, { type: 'drone', at: [5, 8, -59], delay: 0.8, wander: 2 },
        { type: 'grunt', at: [-7, 0, -53], enter: 'run', from: [-16, 0, -56], delay: 1.5 },
      ] },
      { delay: 1, spawns: [
        { type: 'heavy', at: [2.5, 0, -74], enter: 'run', from: [2.5, 0, -82], stopDist: 13 },
        { type: 'sniper', at: [-9, 8.15, -72], delay: 1.5 },
      ] },
    ],
  },
  {
    name: 'WATCHTOWERS', stop: V(0, EYE, -93), look: V(0, 6.5, -110), path: [V(2, EYE, -47), V(2.5, EYE, -61), V(1.5, EYE, -77), V(0, EYE, -93)],
    waves: [
      { spawns: [
        { type: 'sniper', at: [-8, 9.15, -106] },
        { type: 'grunt', at: [-3.2, 0, -99.6], delay: 0.4 }, { type: 'grunt', at: [3.6, 0, -101.6], delay: 0.7 },
        barrelSpawn(-4.5, -103), barrelSpawn(8.5, -100),
      ] },
      { delay: 0.5, nextAt: 1, spawns: [
        { type: 'sniper', at: [9, 12.15, -112] },
        { type: 'drone', at: [-5, 9, -100], wander: 3 }, { type: 'drone', at: [4, 11, -102], delay: 0.5, wander: 3 }, { type: 'drone', at: [0, 7, -98], delay: 1.0, wander: 2.5 },
      ] },
      { delay: 1, spawns: [
        { type: 'rocketeer', at: [-8, 9.15, -106], delay: 0.2 },
        { type: 'rocketeer', at: [9, 12.15, -112], delay: 1.2 },
        { type: 'grenadier', at: [0, 0, -105.6], delay: 0.6 },
      ] },
    ],
  },
  {
    name: 'DEAD MAN\'S PASS', stop: V(0, EYE, -133), look: V(0, 2.4, -150), path: [V(0, EYE, -93), V(-1.5, EYE, -105), V(-1, EYE, -119), V(0, EYE, -133)],
    waves: [
      { spawns: [
        { type: 'grenadier', at: [-5, 0, -145.6] }, { type: 'grenadier', at: [5.5, 0, -147.6], delay: 0.6 },
        { type: 'grunt', at: [0.5, 0, -143.6], delay: 0.3 },
        barrelSpawn(-2.2, -141), barrelSpawn(3, -142.5),
      ] },
      { delay: 0.5, spawns: [
        { type: 'heavy', at: [-3.5, 0, -150], enter: 'run', from: [-4, 0, -170] },
        { type: 'heavy', at: [4.5, 0, -152], enter: 'run', from: [5, 0, -172], delay: 1.6, chargeDur: 3.2 },
        { type: 'drone', at: [0, 7, -140], delay: 2.5, wander: 3 },
      ] },
    ],
  },
  {
    name: 'THE WARDEN', stop: V(0, EYE, -176), look: V(0, 5, -196), path: [V(0, EYE, -133), V(-2.5, EYE, -143), V(-1.5, EYE, -158), V(0, EYE, -176)],
    boss: true,
    waves: [
      { nextAt: 1, spawns: [{ type: 'boss', at: [0, 0, -195] }] },
      { delay: 14, nextAt: 1, spawns: [{ type: 'drone', at: [-6, 8, -186], wander: 3 }, { type: 'drone', at: [6, 9, -188], delay: 0.5, wander: 3 }] },
      { delay: 18, nextAt: 1, spawns: [{ type: 'grunt', at: [-6.5, 0, -187.6] }, { type: 'grunt', at: [6.5, 0, -188.6], delay: 0.4 }, { type: 'grenadier', at: [0, 0, -186], enter: 'run', from: [-14, 0, -186] }] },
      { delay: 22, nextAt: 1, spawns: [{ type: 'drone', at: [-4, 10, -186], wander: 3 }, { type: 'drone', at: [4, 7, -184], wander: 3 }, { type: 'rocketeer', at: [6.5, 0, -188.6] }] },
    ],
  },
];

export function buildLevel(scene) {
  B = new StaticBatch();
  G.colliders.length = 0;
  ground();
  // road along the rail
  const pts = [V(0, 0, 10)];
  for (const e of ENCOUNTERS) for (const p of e.path.slice(1)) pts.push(V(p.x, 0, p.z));
  pts.push(V(0, 0, -215));
  for (let i = 0; i < pts.length - 1; i++) road(pts[i], pts[i + 1]);

  // canyon walls + distant mesas
  for (let z = 20; z > -240; z -= rand(11, 15)) {
    mesa(rand(-34, -26), z, rand(10, 15), rand(12, 26), rand(10, 14));
    mesa(rand(26, 34), z, rand(10, 15), rand(12, 26), rand(10, 14));
  }
  for (let i = 0; i < 14; i++) mesa(rand(-140, 140), rand(-330, -250), rand(20, 40), rand(25, 60), rand(15, 30));
  for (let i = 0; i < 30; i++) { const s = Math.random() < 0.5 ? -1 : 1; rock(s * rand(14, 22), rand(0, 0.6), rand(-210, 15), rand(0.8, 2.4), [C.rock1, C.rock2, C.rock3][i % 3], { sy: rand(0.5, 0.9), collide: false }); }
  for (let i = 0; i < 12; i++) { const s = Math.random() < 0.5 ? -1 : 1; cactus(s * rand(9, 17), rand(-215, 5), rand(2.2, 3.6)); }

  // --- E0 the gate
  box(-9, 0, -30, 11, 4, 1.2, C.wood); box(9, 0, -30, 11, 4, 1.2, C.wood);
  for (let i = -14; i <= 14; i += 1.6) if (Math.abs(i) > 3) B.add(new THREE.ConeGeometry(0.32, 0.9, 5), { x: i, y: 4.4, z: -30 }, C.woodDark, 0.03);
  tower(-3.6, -30, 5, 2.4); tower(3.6, -30, 5, 2.4);
  B.add(new THREE.BoxGeometry(5.6, 1.3, 0.3), { x: 0, y: 5.6, z: -29.2 }, C.yellow, 0.05);
  B.add(new THREE.BoxGeometry(1.2, 0.9, 0.34), { x: 0, y: 5.6, z: -29.15 }, 0x1b120c, 0);
  crate(-4.4, -18.4); crate(-3.3, -18.6, 0.9, 0.3); crate(4.4, -20.6); crate(5.6, -20.8, 0.9, -0.2); crate(4.6, -20.6, 0.8, 0.5, 1.2);
  // --- E1 scrapyard
  shack(-9, -60, 5, 3.4, 4.5, 0.15); shack(10.6, -63, 6, 4.4, 5, -0.1, C.red);
  crate(-2.5, -55.5); crate(-1.4, -55.3, 0.9, 0.4);
  box(6.2, 0, -56.6, 3.8, 1.3, 1.9, C.rust, { ry: 0.2 }); box(6.2, 1.3, -56.8, 2.2, 0.8, 1.7, 0x8a4a2a, { ry: 0.2 }); // car wreck
  for (const [wx, wz] of [[4.8, -56], [7.6, -56.2], [4.9, -57.6], [7.6, -57.9]]) B.add(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8).rotateZ(Math.PI / 2), { x: wx, y: 0.4, z: wz, ry: 0.2 }, 0x2a2420, 0.03);
  tower(-9, -72, 8, 2.6);
  for (let i = 0; i < 6; i++) rock(rand(-14, -6), 0.4, rand(-52, -68), rand(0.6, 1.2), C.rust, { sy: 0.6, collide: false });
  // --- E2 watchtowers
  tower(-8, -106, 9); tower(9, -112, 12);
  sandbags(-3.2, -98.6, 3); sandbags(3.6, -100.6, 3);
  crate(-6, -96); crate(7, -97, 1.0, 0.4);
  // --- E3 pass
  sandbags(-5, -144.6, 3.2, 0.1); sandbags(5.5, -146.6, 3.2, -0.1); sandbags(0.5, -142.6, 2.6);
  rock(-9, 1, -150, 2.6, C.rock1, { sy: 0.8 }); rock(10, 1, -155, 3, C.rock2, { sy: 0.8 });
  crate(-8, -138); crate(8.5, -140, 1.1, 0.3);
  // --- E4 arena
  for (const [x, z, w, h] of [[-12, -195, 6, 5], [12, -197, 6, 6], [-6, -206, 4, 7], [7, -208, 5, 8]]) box(x, 0, z, w, h, 2, 0x8a7a68);
  sandbags(-6.5, -186.6, 3); sandbags(6.5, -187.6, 3);
  for (let i = 0; i < 8; i++) rock(rand(-16, 16), 0.3, rand(-182, -210), rand(0.5, 1.1), C.rock3, { sy: 0.6, collide: false });

  B.build(scene);
}

// ------------------------------------------------------------------ flow
export const LV = { idx: 0, phase: 'idle', t: 0, waveIdx: 0, waveT: 0, curve: null, moveDur: 1, prevLook: new THREE.Vector3(), rangeT: 0, encStart: 0 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), UP = V(0, 1, 0), _a = V(0, 0, 0), _b = V(0, 0, 0), _c = V(0, 0, 0);

function lookQuat(eye, dir, out) { _m.lookAt(eye, _a.copy(eye).add(dir), UP); return out.setFromRotationMatrix(_m); }

const counted = () => G.enemies.filter(e => e.alive && e.counts).length;

export function resetWorldState() {
  clearEnemies(); clearProjectiles(); clearFx();
}

export function startEncounter(i, fromPath) {
  const E = ENCOUNTERS[i];
  LV.idx = i;
  resetWorldState();
  if (!fromPath) resetLook();
  if (fromPath) {
    LV.phase = 'move'; LV.t = 0;
    LV.curve = new THREE.CatmullRomCurve3(E.path, false, 'catmullrom', 0.4);
    LV.moveDur = LV.curve.getLength() / 6 + 0.4;
    LV.fromLook = (i > 0 ? ENCOUNTERS[i - 1].look.clone().sub(ENCOUNTERS[i - 1].stop) : V(0, 0, -1)).normalize();
  } else arrive();
  setStage(E.name, `${i + 1} / ${ENCOUNTERS.length}`);
}

function arrive() {
  const E = ENCOUNTERS[LV.idx];
  rig.pos.copy(E.stop); lookQuat(E.stop, _b.copy(E.look).sub(E.stop).normalize(), rig.quat);
  rig.moving = false; rig.speed = 0;
  LV.phase = 'fight'; LV.waveIdx = -1; LV.waveT = 99; LV.encStart = G.time.now;
  banner(E.name, E.boss ? 'BOSS' : `ENCOUNTER ${LV.idx + 1}`);
}

function spawnWave(w) {
  for (const s of w.spawns) spawnEnemy(s.type, s);
}

let onRunComplete = () => {};
export function setRunCompleteHook(fn) { onRunComplete = fn; }

export function updateLevel(dt) {
  if (G.mode === 'range') return updateRange(dt);
  const E = ENCOUNTERS[LV.idx];
  if (LV.phase === 'move') {
    LV.t += dt;
    const u = smooth(clamp(LV.t / LV.moveDur, 0, 1));
    const p = LV.curve.getPointAt(u);
    rig.speed = rig.pos.distanceTo(p) / Math.max(dt, 1e-4);
    rig.pos.copy(p); rig.moving = true;
    const tan = LV.curve.getTangentAt(Math.min(0.999, Math.max(0.001, u)));
    const toLook = _c.copy(E.look).sub(E.stop).normalize();
    const dir = _b.copy(LV.fromLook).lerp(tan, smooth(clamp(u / 0.3, 0, 1)));
    dir.lerp(toLook, smooth(clamp((u - 0.55) / 0.45, 0, 1))).normalize();
    lookQuat(rig.pos, dir, _q);
    rig.quat.slerp(_q, 1 - Math.exp(-10 * dt));
    if (LV.t >= LV.moveDur) arrive();
    return;
  }
  if (LV.phase === 'fight') {
    LV.waveT += dt;
    // boss down = encounter over, adds and all
    if (E.boss && LV.waveIdx >= 0 && !G.enemies.some(e => e.alive && e.isBoss)) {
      for (const e of [...G.enemies]) if (e.alive && e.counts) e.die();
      LV.waveIdx = E.waves.length - 1;
    }
    const next = E.waves[LV.waveIdx + 1];
    const cur = E.waves[LV.waveIdx];
    if (next && LV.waveT >= (next.delay ?? 0) && counted() <= (cur?.nextAt ?? 0)) {
      LV.waveIdx++; LV.waveT = 0; spawnWave(next);
    } else if (!next && counted() === 0 && LV.waveT > 0.2) {
      LV.phase = 'clear'; LV.t = 0;
      G.stats.encounters.push({ name: E.name, secs: +(G.time.now - LV.encStart).toFixed(1), hp: Math.round(G.player.hp) });
      G.time.slowmo = 0.7; G.time.slowmoScale = 0.3;
      sfx.clear();
      setTimeout(() => banner(LV.idx === ENCOUNTERS.length - 1 ? 'RUN COMPLETE' : 'AREA CLEAR'), 250);
    }
    return;
  }
  if (LV.phase === 'clear') {
    LV.t += dt;
    if (LV.t > 2.0) {
      // leftover barrels/projectiles get cleared on the move
      if (LV.idx + 1 < ENCOUNTERS.length) startEncounter(LV.idx + 1, true);
      else { LV.phase = 'done'; onRunComplete(); }
    }
  }
}

// ------------------------------------------------------------------ endless range (all enemy types, towers stop)
const RANGE_SLOTS = {
  ground: [[-3.2, 0, -99.6], [3.6, 0, -101.6], [0, 0, -105.6], [-6, 0, -97.2], [7, 0, -98.2]],
  tower: [[-8, 9.15, -106], [9, 12.15, -112]],
  air: [[-5, 9, -100], [4, 11, -102], [0, 7, -98], [-2, 12, -106], [6, 8, -96]],
};
export function startRange() {
  resetWorldState(); resetLook();
  LV.idx = 2; LV.phase = 'range'; LV.rangeT = 0; LV.spawnT = 0.5;
  const E = ENCOUNTERS[2];
  rig.pos.copy(E.stop); lookQuat(E.stop, _b.copy(E.look).sub(E.stop).normalize(), rig.quat);
  rig.moving = false;
  setStage('SHOOTING RANGE', 'ENDLESS');
  banner('SHOOTING RANGE', 'ENDLESS');
  spawnEnemy('barrel', barrelSpawn(-4.5, -103)); spawnEnemy('barrel', barrelSpawn(8.5, -100));
}
function updateRange(dt) {
  LV.rangeT += dt; LV.spawnT -= dt;
  const want = Math.min(6, 2 + Math.floor(LV.rangeT / 30));
  if (LV.spawnT > 0 || counted() >= want) return;
  LV.spawnT = rand(0.6, 1.6);
  const used = s => G.enemies.some(e => e.alive && e.home.distanceTo(V(...s)) < 1.5);
  const pickSlot = list => { const free = list.filter(s => !used(s)); return free.length ? free[Math.floor(Math.random() * free.length)] : null; };
  const r = Math.random();
  const heavies = G.enemies.filter(e => e.alive && e.type === 'heavy').length;
  let type, slot, extra = {};
  if (r < 0.14 && heavies === 0) { type = 'heavy'; slot = [rand(-4, 4), 0, -108]; extra = { enter: 'run', from: [rand(-5, 5), 0, -125], stopDist: rand(8, 13) }; }
  else if (r < 0.32) { type = Math.random() < 0.6 ? 'sniper' : 'rocketeer'; slot = pickSlot(RANGE_SLOTS.tower); }
  else if (r < 0.52) { type = 'drone'; slot = pickSlot(RANGE_SLOTS.air); extra = { wander: 2.5 }; }
  else { type = ['grunt', 'grunt', 'grenadier', 'rocketeer'][Math.floor(Math.random() * 4)]; slot = pickSlot(RANGE_SLOTS.ground); if (slot && Math.random() < 0.4) extra = { enter: 'run', from: [slot[0] + (slot[0] > 0 ? 10 : -10), 0, slot[2] + 2] }; }
  if (!slot) return;
  spawnEnemy(type, { at: slot, ...extra });
}
