// Ability buttons: COVER (hold), NADE (tap = throw at reticle, drag from button = aim), FOCUS (slow-mo), HEAL.
import * as THREE from 'three';
import { G } from './state.js';
import { sfx, haptic } from './audio.js';
import { healPlayer } from './player.js';
import { PlayerGrenade } from './projectiles.js';
import { screenRay, castWorld } from './combat.js';
import { W, startReload } from './weapons.js';
import { popScreenText } from './hud.js';
import { cancelAim } from './input.js';

export const AB = {
  cover: { active: false, cd: 0, cdMax: 1 },
  grenade: { charges: 3, cd: 0, cdMax: 5 },
  focus: { cd: 0, cdMax: 16, active: false },
  medkit: { charges: 2, cd: 0, cdMax: 3 },
};
const nades = [];
export let grenadeAim = null;
let frameEl;

export function resetAbilities() {
  AB.grenade.charges = 3; AB.medkit.charges = 2;
  for (const a of Object.values(AB)) { a.cd = 0; a.active = false; }
  G.time.focus = 0; G.player.cover = false;
  for (const n of nades) G.scene.remove(n.mesh);
  nades.length = 0;
}

const live = () => (G.mode === 'run' || G.mode === 'range') && !G.paused && G.player.alive;

function local(e) { const r = frameEl.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

export function initAbilities(frame) {
  frameEl = frame;
  for (const id of Object.keys(AB)) {
    const el = document.getElementById('ab' + id[0].toUpperCase() + id.slice(1));
    let start = null;
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (!live()) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* */ }
      const [x, y] = local(e);
      start = { x, y, id: e.pointerId };
      if (id === 'cover') triggerAbility('cover', true);
      else if (id === 'grenade') grenadeAim = null;
      else triggerAbility(id, true);
    });
    el.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start.id || id !== 'grenade') return;
      const [x, y] = local(e);
      if (Math.hypot(x - start.x, y - start.y) > 24 && AB.grenade.charges > 0 && AB.grenade.cd <= 0) grenadeAim = { x, y };
      else if (grenadeAim) grenadeAim = { x, y };
    });
    const end = e => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (id === 'cover') triggerAbility('cover', false);
      if (id === 'grenade') {
        if (grenadeAim) triggerAbility('grenade', true, grenadeAim.x, grenadeAim.y);
        else triggerAbility('grenade', true, G.aim.x, G.aim.y - G.aim.climb);
        grenadeAim = null;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}

export function triggerAbility(id, down, x, y) {
  if (!live()) return;
  const a = AB[id];
  if (id === 'cover') {
    if (down && !G.player.cover) { G.player.cover = true; a.active = true; cancelAim(); sfx.cover(); G.stats.abilities.cover++; startReload(); }
    if (!down && G.player.cover) { G.player.cover = false; a.active = false; sfx.cover(); }
    return;
  }
  if (!down) return;
  if (a.cd > 0 || a.charges === 0) { sfx.dry(); return; }
  G.stats.abilities[id]++;
  if (id === 'grenade') {
    const { o, d } = screenRay(x ?? G.view.w / 2, y ?? G.view.h / 2);
    const hit = castWorld(o, d, 40);
    const target = o.clone().addScaledVector(d, Math.min(hit.t, 30));
    target.y = Math.max(0.1, target.y);
    const from = o.clone().add(new THREE.Vector3(0.25, -0.3, 0).applyQuaternion(G.camera.quaternion));
    nades.push(new PlayerGrenade(from, target));
    a.charges--; a.cd = a.cdMax * 0.3; sfx.lob(); haptic([20]);
  } else if (id === 'focus') {
    G.time.focus = 5; a.cd = a.cdMax; a.active = true;
    sfx.focus(true); popScreenText('FOCUS', '#4fe3ff', 1.4);
    document.getElementById('gl').classList.add('focus');
  } else if (id === 'medkit') {
    if (G.player.hp >= G.player.maxHp) { popScreenText('FULL HEALTH', '#fff4dc', 0.9); G.stats.abilities[id]--; return; }
    healPlayer(40); a.charges--; a.cd = a.cdMax; sfx.heal(); popScreenText('+40', '#7dff8a', 1.4); haptic([10, 40, 10]);
  }
}

export function updateAbilities(rdt, gdt) {
  for (const a of Object.values(AB)) a.cd = Math.max(0, a.cd - rdt);
  if (G.time.focus > 0) {
    G.time.focus -= rdt;
    if (G.time.focus <= 0) { AB.focus.active = false; sfx.focus(false); document.getElementById('gl').classList.remove('focus'); }
  }
  for (let i = nades.length - 1; i >= 0; i--) { nades[i].update(gdt); if (!nades[i].alive) nades.splice(i, 1); }
  // cover auto-reload completes faster
  if (G.player.cover && W.reloading) W.reloadT += rdt * 0.5;
}
