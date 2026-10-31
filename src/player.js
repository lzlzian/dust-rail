// Player health, damage intake (with cover blocking) and directional hurt feedback.
import * as THREE from 'three';
import { G } from './state.js';
import { settings } from './config.js';
import { sfx, haptic } from './audio.js';
import { addTrauma } from './fx.js';
import { popScreenText } from './hud.js';

let onDown = () => {};
export function setDownHook(fn) { onDown = fn; }

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

// returns false when blocked by cover
export function hurtPlayer(amount, srcPos, source, isCharge = false) {
  const P = G.player;
  if (!P.alive || G.mode === 'end' || G.mode === 'menu') return true;
  if (P.cover) {
    sfx.blocked();
    popScreenText('BLOCKED', '#bfe0ff', 0.8);
    if (isCharge) G.stats.charge.blocked++;
    return false;
  }
  amount *= settings.game.enemyDmg;
  P.hp -= amount;
  G.stats.dmgTaken[source] = (G.stats.dmgTaken[source] ?? 0) + Math.round(amount);
  if (isCharge) G.stats.charge.landed++;
  P.hurtT = Math.min(1.2, P.hurtT + 0.4 + amount / 40);
  if (srcPos) {
    _v.copy(srcPos).sub(G.camera.position).applyQuaternion(_q.copy(G.camera.quaternion).invert());
    P.hurtDirs.push({ a: Math.atan2(_v.x, -_v.z), t: 1 });
  }
  addTrauma(0.3 + amount / 50);
  sfx.hurt(amount > 15);
  haptic(amount > 15 ? [60, 40, 80] : [35]);
  G.combo = 0;
  if (P.hp <= 0) {
    if (settings.game.god) P.hp = 1;
    else { P.hp = 0; P.alive = false; G.stats.downs++; onDown(); }
  }
  return true;
}

export function healPlayer(n) {
  const P = G.player;
  P.hp = Math.min(P.maxHp, P.hp + n);
}

export function resetPlayer() {
  const P = G.player;
  P.hp = P.maxHp; P.alive = true; P.cover = false; P.coverT = 0; P.hurtT = 0; P.hurtDirs.length = 0;
}
