// The level: a desert canyon built from primitives, five on-rails stops, waves, and the endless range.
// Encounters are laid out vertically (towers, roofs, flyers) so a tall portrait view has something to show,
// and split into arcade camera beats (front, left flank, right flank) so portrait never has to show a wide arc.
import * as THREE from 'three';
import { G, rand, smooth, clamp } from './state.js';
import { settings } from './config.js';
import { StaticBatch, jitter, boxCollider, sphereCollider } from './world.js';
import { spawnEnemy, clearEnemies } from './enemies.js';
import { clearProjectiles } from './projectiles.js';
import { rig, resetLook, panTo, panning } from './camera.js';
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
// overturned wagon: wooden bed on its side with two wheels facing the camera
function wagon(x, z, ry) {
  box(x, 0, z, 3.4, 1.2, 1.3, C.wood, { ry });
  B.add(new THREE.BoxGeometry(3.5, 0.14, 1.35), { x, y: 1.1, z, ry }, C.woodDark, 0, 0.03);
  const c = Math.cos(ry), s = Math.sin(ry);
  for (const lx of [-1.05, 1.05]) B.add(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 10).rotateX(Math.PI / 2), { x: x + lx * c + 0.7 * s, y: 0.62, z: z - lx * s + 0.7 * c, ry }, C.woodDark, 0.03);
}
// rusty shipping container, long side to the camera
function container(x, z, ry) {
  box(x, 0, z, 6, 2.6, 2.4, C.rust, { ry });
  const c = Math.cos(ry), s = Math.sin(ry);
  for (let i = -2; i <= 2; i++) B.add(new THREE.BoxGeometry(0.12, 2.3, 0.06), { x: x + i * 1.15 * c + 1.22 * s, y: 1.3, z: z - i * 1.15 * s + 1.22 * c, ry }, 0x8a4a2a, 0, 0.02);
}
// a stack of old tires
function tires(x, z, n = 3) {
  for (let i = 0; i < n; i++) B.add(new THREE.TorusGeometry(0.42, 0.17, 6, 12).rotateX(Math.PI / 2), { x: x + rand(-0.06, 0.06), y: 0.17 + i * 0.32, z: z + rand(-0.06, 0.06) }, 0x2a2420, 0.03, 0.04);
  boxCollider(x, 0, z, 1.1, n * 0.32 + 0.05, 1.1);
}

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
// Each encounter: stop (camera), look target, path from the previous stop, barrels, beats.
// A beat is one arcade camera angle (yaw in degrees from the rail direction, + = right) with its own waves.
// The camera holds a beat until all of its waves are cleared, then pans to the next beat at that lull.
// Portrait shows only about ±30° side to side, so each beat keeps its targets within roughly ±22° of its yaw.
// wave: { spawns, delay (s after previous wave), nextAt (advance when <= this many counted enemies alive) }
const D2R = Math.PI / 180;
// world [x, y, z] at a bearing (deg, + = right) and ground distance from a stop. Every stop looks down -Z,
// so beat yaws, spawn bearings and the cover they hide behind all share one frame.
const at = (S, deg, d, y = 0) => [+(S.x + Math.sin(deg * D2R) * d).toFixed(2), y, +(S.z - Math.cos(deg * D2R) * d).toFixed(2)];
const XZ = p => [p[0], p[2]];
const face = deg => -deg * D2R; // ry that turns a prop at this bearing to face the stop
const S0 = V(0, EYE, -10), S1 = V(2, EYE, -47), S2 = V(0, EYE, -93), S3 = V(0, EYE, -133), S4 = V(0, EYE, -176);

export const ENCOUNTERS = [
  {
    name: 'THE GATE', stop: S0, look: V(0, 3.4, -26), path: [V(0, EYE, 6), S0],
    barrels: [at(S0, -20, 13), at(S0, 19, 15), at(S0, -47, 10.5)],
    beats: [
      { yaw: 0, waves: [
        { spawns: [
          { type: 'grunt', at: at(S0, -16, 10) }, { type: 'grunt', at: at(S0, 14, 12), delay: 0.5 },
          { type: 'grunt', at: [-3.6, 5.15, -30], delay: 1.0, scale: 1.1 },
        ] },
      ] },
      { yaw: -55, label: 'LEFT FLANK', waves: [
        { spawns: [
          { type: 'grunt', at: at(S0, -50, 12.2) }, { type: 'grunt', at: at(S0, -60, 12.2), delay: 0.4 },
          { type: 'grenadier', at: at(S0, -62, 13.2), enter: 'run', from: at(S0, -62, 15.6), delay: 0.9 },
          { type: 'grunt', at: at(S0, -45, 13.5), enter: 'run', from: at(S0, -85, 14), delay: 1.6 },
        ] },
      ] },
      { yaw: 0, label: 'FRONT', waves: [
        { spawns: [
          { type: 'grunt', at: [0.5, 0, -23], enter: 'run', from: [0, 0, -36] },
          { type: 'grunt', at: [-1.8, 0, -24], enter: 'run', from: [-1, 0, -38], delay: 0.6 },
          { type: 'rocketeer', at: [3.6, 5.15, -30], delay: 0.8 },
        ] },
      ] },
    ],
  },
  {
    name: 'SCRAPYARD', stop: S1, look: V(2, 3.6, -64), path: [S0, V(0, EYE, -24), V(1, EYE, -35), S1],
    barrels: [at(S1, -5, 11.5), at(S1, 54, 9)],
    beats: [
      { yaw: 0, waves: [
        { spawns: [{ type: 'grenadier', at: at(S1, -17, 10.6) }, { type: 'grunt', at: at(S1, 17, 11.3), delay: 0.4 }] },
        { delay: 0.5, nextAt: 1, spawns: [
          { type: 'rocketeer', at: [8, 4.62, -63.4], enter: 'popup' },
          { type: 'drone', at: at(S1, -10, 10, 6.5), wander: 2 }, { type: 'drone', at: at(S1, 8, 12, 8), delay: 0.8, wander: 2 },
        ] },
      ] },
      { yaw: 52, label: 'RIGHT FLANK', waves: [
        { spawns: [
          { type: 'grunt', at: at(S1, 60, 11.2) },
          { type: 'grunt', at: at(S1, 44, 11), enter: 'run', from: at(S1, 85, 13), delay: 0.6 },
          { type: 'rocketeer', at: at(S1, 48, 15.2, 2.6), delay: 1.0 },
        ] },
      ] },
      { yaw: 0, label: 'FRONT', waves: [
        { spawns: [
          { type: 'heavy', at: [2.5, 0, -74], enter: 'run', from: [2.5, 0, -82], stopDist: 13 },
          { type: 'sniper', at: [-6.3, 8.15, -72.7], delay: 1.5 },
        ] },
      ] },
    ],
  },
  {
    name: 'WATCHTOWERS', stop: S2, look: V(0, 6.5, -110), path: [S1, V(2.5, EYE, -61), V(1.5, EYE, -77), S2],
    barrels: [at(S2, -8, 11), at(S2, 9, 14), at(S2, 42, 11)],
    beats: [
      { yaw: 0, waves: [
        { spawns: [
          { type: 'sniper', at: [-3.9, 9.15, -107.5] },
          { type: 'grunt', at: at(S2, -17, 9), delay: 0.4 }, { type: 'grunt', at: at(S2, 15, 11), delay: 0.7 },
        ] },
        { delay: 0.5, nextAt: 1, spawns: [
          { type: 'sniper', at: [5.1, 12.15, -113.4] },
          { type: 'drone', at: at(S2, -8, 9, 8), wander: 2 }, { type: 'drone', at: at(S2, 8, 10, 10), delay: 0.5, wander: 2 }, { type: 'drone', at: at(S2, 0, 7, 6.5), delay: 1.0, wander: 2 },
        ] },
      ] },
      { yaw: 52, label: 'RIGHT FLANK', waves: [
        { spawns: [
          { type: 'rocketeer', at: at(S2, 55, 15, 3.5), enter: 'popup' },
          { type: 'grenadier', at: at(S2, 48, 10.2), delay: 0.5 },
          { type: 'grunt', at: at(S2, 60, 11.5), enter: 'run', from: at(S2, 82, 14), delay: 1.0 },
        ] },
      ] },
      { yaw: -52, label: 'LEFT FLANK', waves: [
        { spawns: [
          { type: 'grunt', at: at(S2, -57, 14.2) },
          { type: 'rocketeer', at: at(S2, -46, 18, 6.15), delay: 0.5 },
          { type: 'drone', at: at(S2, -60, 10, 7), wander: 2, delay: 0.3 }, { type: 'drone', at: at(S2, -44, 11, 9), wander: 2, delay: 0.9 },
        ] },
      ] },
    ],
  },
  {
    name: 'DEAD MAN\'S PASS', stop: S3, look: V(0, 2.4, -150), path: [S2, V(-1.5, EYE, -105), V(-1, EYE, -119), S3],
    barrels: [[-2.2, 0, -141], [3, 0, -142.5], at(S3, 45, 8.5)],
    beats: [
      { yaw: 0, waves: [
        { spawns: [
          { type: 'grenadier', at: at(S3, -19, 14) }, { type: 'grenadier', at: at(S3, 18, 16), delay: 0.6 },
          { type: 'grunt', at: at(S3, 3, 11), delay: 0.3 },
        ] },
      ] },
      { yaw: 50, label: 'RIGHT FLANK', waves: [
        { spawns: [
          { type: 'grunt', at: at(S3, 50, 12.3) },
          { type: 'rocketeer', at: at(S3, 60, 15.4), delay: 0.5 },
          { type: 'grunt', at: at(S3, 42, 12), enter: 'run', from: at(S3, 80, 15), delay: 0.9 },
        ] },
      ] },
      { yaw: -50, label: 'LEFT FLANK', waves: [
        { spawns: [
          { type: 'grenadier', at: at(S3, -45, 13.2) },
          { type: 'grunt', at: at(S3, -58, 10.6), delay: 0.3 },
          { type: 'drone', at: at(S3, -50, 10, 7), wander: 2, delay: 0.8 },
        ] },
      ] },
      { yaw: 0, label: 'FRONT', waves: [
        { spawns: [
          { type: 'heavy', at: [-3.5, 0, -150], enter: 'run', from: [-4, 0, -170] },
          { type: 'heavy', at: [4.5, 0, -152], enter: 'run', from: [5, 0, -172], delay: 1.6, chargeDur: 3.2 },
          { type: 'drone', at: [0, 7, -140], delay: 2.5, wander: 2.5 },
        ] },
      ] },
    ],
  },
  {
    name: 'THE WARDEN', stop: S4, look: V(0, 5, -196), path: [S3, V(-2.5, EYE, -143), V(-1.5, EYE, -158), S4],
    boss: true,
    beats: [{ yaw: 0, waves: [
      { nextAt: 1, spawns: [{ type: 'boss', at: [0, 0, -195] }] },
      { delay: 14, nextAt: 1, spawns: [{ type: 'drone', at: at(S4, -15, 11, 8), wander: 2.5 }, { type: 'drone', at: at(S4, 15, 12, 9), delay: 0.5, wander: 2.5 }] },
      { delay: 18, nextAt: 1, spawns: [{ type: 'grunt', at: at(S4, -20, 12.6) }, { type: 'grunt', at: at(S4, 20, 13.6), delay: 0.4 }, { type: 'grenadier', at: [0, 0, -186], enter: 'run', from: [-14, 0, -186] }] },
      { delay: 22, nextAt: 1, spawns: [{ type: 'drone', at: at(S4, -12, 10, 10), wander: 2.5 }, { type: 'drone', at: at(S4, 14, 9, 7), wander: 2.5 }, { type: 'rocketeer', at: at(S4, 20, 13.6) }] },
    ] }],
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
  crate(-2.5, -18.6); crate(-3.5, -18.9, 0.9, 0.3); crate(2.7, -20.6); crate(3.8, -20.8, 0.9, -0.2); crate(2.9, -20.6, 0.8, 0.5, 1.2);
  // left flank: overturned wagon + the shack the grenadier runs out of
  wagon(...XZ(at(S0, -55, 11)), face(-55));
  shack(...XZ(at(S0, -62, 17)), 5, 3.2, 4.5, face(-62));
  // --- E1 scrapyard
  shack(-9, -60, 5, 3.4, 4.5, 0.15); shack(8, -63.6, 6, 4.4, 5, -0.1, C.red);
  crate(-0.8, -56.1); crate(0.3, -55.9, 0.9, 0.4);
  box(4.9, 0, -56.6, 3.8, 1.3, 1.9, C.rust, { ry: 0.2 }); box(4.9, 1.3, -56.8, 2.2, 0.8, 1.7, 0x8a4a2a, { ry: 0.2 }); // car wreck
  for (const [wx, wz] of [[3.5, -56], [6.3, -56.2], [3.6, -57.6], [6.3, -57.9]]) B.add(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8).rotateZ(Math.PI / 2), { x: wx, y: 0.4, z: wz, ry: 0.2 }, 0x2a2420, 0.03);
  tower(-6.3, -72.7, 8, 2.6);
  for (let i = 0; i < 6; i++) rock(rand(-14, -6), 0.4, rand(-52, -68), rand(0.6, 1.2), C.rust, { sy: 0.6, collide: false });
  // right flank: shipping container (a rocketeer climbs on top) + junk pile
  container(...XZ(at(S1, 48, 15)), face(48));
  { const [x, , z] = at(S1, 60, 10); crate(x, z, 1.2, face(60)); tires(x + 1.1, z + 0.6, 3); tires(x - 0.9, z - 0.7, 2); }
  // --- E2 watchtowers
  tower(-3.9, -107.5, 9); tower(5.1, -113.4, 12);
  sandbags(-2.3, -100.7, 3, face(-17)); sandbags(2.6, -102.7, 3, face(15));
  // right flank: shack with a rooftop perch + crates · left flank: rock outcrop + lookout tower
  shack(...XZ(at(S2, 55, 16.2)), 5, 3.4, 4.5, face(55));
  { const [x, , z] = at(S2, 48, 9); crate(x, z, 1.2, face(48)); crate(x + 0.9, z - 0.6, 0.9, 0.5); }
  { const [x, , z] = at(S2, -57, 13); rock(x, 0.5, z, 1.5, C.rock1, { sy: 0.75 }); rock(x - 1.3, 0.3, z + 0.6, 0.9, C.rock3, { sy: 0.7 }); }
  tower(...XZ(at(S2, -46, 18)), 6, 2.4);
  // --- E3 pass
  sandbags(-4.2, -145.3, 3.2, face(-19)); sandbags(4.6, -147.3, 3.2, face(18)); sandbags(0.5, -143, 2.6);
  rock(-9, 1, -150, 2.6, C.rock1, { sy: 0.8 }); rock(10, 1, -155, 3, C.rock2, { sy: 0.8 });
  // right flank: crate + boulder, crate stack · left flank: crate + sandbag nest
  { const [x, , z] = at(S3, 50, 11); crate(x, z, 1.1, face(50)); rock(x + 1.2, 0.4, z - 0.5, 0.8, C.rock2, { sy: 0.8 }); }
  { const [x, , z] = at(S3, 60, 14.3); crate(x, z, 1.3, face(60)); crate(x - 0.9, z - 0.5, 0.9, 0.3); }
  crate(...XZ(at(S3, -58, 9.4)));
  sandbags(...XZ(at(S3, -45, 12)), 3, face(-45));
  // --- E4 arena
  for (const [x, z, w, h] of [[-12, -195, 6, 5], [12, -197, 6, 6], [-6, -206, 4, 7], [7, -208, 5, 8]]) box(x, 0, z, w, h, 2, 0x8a7a68);
  sandbags(-3.9, -186.8, 3, face(-20)); sandbags(4.3, -187.7, 3, face(20));
  for (let i = 0; i < 8; i++) rock(rand(-16, 16), 0.3, rand(-182, -210), rand(0.5, 1.1), C.rock3, { sy: 0.6, collide: false });

  B.build(scene);
}

// ------------------------------------------------------------------ flow
// phases: move (riding the rail) → fight (a beat's waves) → turn (lull, cue, pan to the next beat) → … → clear
export const LV = { idx: 0, phase: 'idle', t: 0, beatIdx: 0, waveIdx: 0, waveT: 0, curve: null, moveDur: 1, rangeT: 0, encStart: 0, cued: false, panned: false };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), UP = V(0, 1, 0), _a = V(0, 0, 0), _b = V(0, 0, 0), _c = V(0, 0, 0);
const LULL = 0.35; // breath between the last kill of a beat and the cue for the next one

function lookQuat(eye, dir, out) { _m.lookAt(eye, _a.copy(eye).add(dir), UP); return out.setFromRotationMatrix(_m); }

const counted = () => G.enemies.filter(e => e.alive && e.counts).length;

export function resetWorldState() {
  clearEnemies(); clearProjectiles(); clearFx(); G.cue = null;
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
  for (const b of E.barrels ?? []) spawnEnemy('barrel', { at: b });
  LV.encStart = G.time.now;
  startBeat(0);
  banner(E.name, E.boss ? 'BOSS' : `ENCOUNTER ${LV.idx + 1}`);
}

function startBeat(i) {
  LV.beatIdx = i; LV.phase = 'fight'; LV.waveIdx = -1; LV.waveT = 99; G.cue = null;
  panTo(ENCOUNTERS[LV.idx].beats[i].yaw); // no-op when the camera is already there
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
    const beat = E.beats[LV.beatIdx];
    // boss down = encounter over, adds and all
    if (E.boss && LV.waveIdx >= 0 && !G.enemies.some(e => e.alive && e.isBoss)) {
      for (const e of [...G.enemies]) if (e.alive && e.counts) e.die();
      LV.waveIdx = beat.waves.length - 1;
    }
    const next = beat.waves[LV.waveIdx + 1];
    const cur = beat.waves[LV.waveIdx];
    if (next && LV.waveT >= (next.delay ?? 0) && counted() <= (cur?.nextAt ?? 0)) {
      LV.waveIdx++; LV.waveT = 0; spawnWave(next);
    } else if (!next && counted() === 0 && LV.waveT > 0.2 && !G.projectiles.length) {
      // beat cleared and nothing still in the air: that's the lull
      if (LV.beatIdx + 1 < E.beats.length) { LV.phase = 'turn'; LV.t = 0; LV.cued = LV.panned = false; return; }
      LV.phase = 'clear'; LV.t = 0;
      G.stats.encounters.push({ name: E.name, secs: +(G.time.now - LV.encStart).toFixed(1), hp: Math.round(G.player.hp) });
      G.time.slowmo = 0.7; G.time.slowmoScale = 0.3;
      sfx.clear();
      setTimeout(() => banner(LV.idx === ENCOUNTERS.length - 1 ? 'RUN COMPLETE' : 'AREA CLEAR'), 250);
    }
    return;
  }
  if (LV.phase === 'turn') {
    LV.t += dt;
    const from = E.beats[LV.beatIdx], to = E.beats[LV.beatIdx + 1], turns = to.yaw !== from.yaw;
    if (!LV.cued && LV.t >= LULL) {
      LV.cued = true;
      if (turns) { G.cue = { dir: Math.sign(to.yaw - from.yaw), label: to.label ?? '', t: G.time.real }; sfx.cue(); }
    }
    if (!LV.panned && LV.t >= LULL + settings.look.cueTime) {
      LV.panned = true;
      // beat camera pans for you; in auto/free look modes the cue is all you get
      if (turns && settings.look.mode === 'beats') { const d = panTo(to.yaw); if (d) sfx.pan(d); }
    }
    if (LV.panned && !panning()) startBeat(LV.beatIdx + 1);
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
// every slot sits inside the forward beat's ±22° so the range never needs a pan
const RANGE_SLOTS = {
  ground: [at(S2, -17, 9), at(S2, 15, 11), at(S2, 0, 12.6), at(S2, -8, 13.5), at(S2, 7, 15)],
  tower: [[-3.9, 9.15, -107.5], [5.1, 12.15, -113.4]],
  air: [at(S2, -10, 9, 8), at(S2, 8, 10, 10), at(S2, 0, 7, 6.5), at(S2, -4, 13, 11), at(S2, 12, 9, 7)],
};
export function startRange() {
  resetWorldState(); resetLook();
  LV.idx = 2; LV.phase = 'range'; LV.rangeT = 0; LV.spawnT = 0.5;
  const E = ENCOUNTERS[2];
  rig.pos.copy(E.stop); lookQuat(E.stop, _b.copy(E.look).sub(E.stop).normalize(), rig.quat);
  rig.moving = false;
  setStage('SHOOTING RANGE', 'ENDLESS');
  banner('SHOOTING RANGE', 'ENDLESS');
  for (const b of [at(S2, -8, 11), at(S2, 9, 14)]) spawnEnemy('barrel', { at: b });
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
