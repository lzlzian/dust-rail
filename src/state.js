// Shared mutable game context. Prototype-grade: every system reads/writes through G.
import { WEAPONS } from './config.js';

export const G = {
  scene: null, camera: null, renderer: null,
  vmScene: null, vmCamera: null,
  enemies: [], projectiles: [], colliders: [],
  player: { hp: 100, maxHp: 100, cover: false, coverT: 0, alive: true, hurtT: 0, hurtDirs: [] },
  time: { now: 0, real: 0, scale: 1, hitstop: 0, focus: 0, slowmo: 0, slowmoScale: 1 },
  view: { w: 1, h: 1, dpr: 1, focalPx: 1, vfov: 60, hfov: 60 },
  mode: 'menu',            // menu | run | range | end
  paused: false,
  score: 0, combo: 0, comboT: 0,
  attackTokens: 0,
  aim: { x: 0, y: 0, visible: false, bloom: 0, climb: 0, scoped: false, scopeT: 0, autoT: 0, tags: [] },
  stats: null,
};

export function freshStats() {
  return {
    started: performance.now(),
    weapons: Object.fromEntries(WEAPONS.map(w => [w.id, { shots: 0, hits: 0, crits: 0, kills: 0, dmg: 0, time: 0 }])),
    schemesUsed: {},
    proj: { spawned: 0, intercepted: 0, hitPlayer: 0, blocked: 0 },
    charge: { started: 0, interrupted: 0, killed: 0, landed: 0, blocked: 0 },
    dmgTaken: {},
    abilities: { cover: 0, grenade: 0, focus: 0, medkit: 0 },
    misTaps: 0,
    encounters: [],
    downs: 0,
  };
}
G.stats = freshStats();

export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
