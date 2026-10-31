// Boot, frame sizing (incl. simulated portrait/landscape frames), main loop, screens.
import * as THREE from 'three';
import { G, freshStats } from './state.js';
import { settings, saveSettings, resetSettings, WEAPONS } from './config.js';
import { buildSky } from './world.js';
import { initFx, updateFx, clearFx } from './fx.js';
import { initAudio, setVolume } from './audio.js';
import { initWeapons, updateWeapons, updateViewmodel, layoutViewmodel, selectWeapon, resetWeapons, W, onKill, setWeaponKillHook } from './weapons.js';
import { initInput, updateInput, cancelAim } from './input.js';
import { updateCamera, rig } from './camera.js';
import { initHud, resizeOverlay, applyHudLayout, updateHudDom, drawOverlay, banner, clearHudFx, popScreenText } from './hud.js';
import { initAbilities, updateAbilities, resetAbilities, AB, grenadeAim } from './abilities.js';
import { buildLevel, startEncounter, startRange, updateLevel, LV, ENCOUNTERS, setRunCompleteHook, resetWorldState } from './level.js';
import { updateEnemies, setKillHook } from './enemies.js';
import { updateProjectiles } from './projectiles.js';
import { resetPlayer, setDownHook } from './player.js';
import { initPanel, closePanel, statsText, statsJson, spawnAhead, rebuildPanel } from './debug.js';

const $ = id => document.getElementById(id);
const frame = $('frame'), canvas = $('gl');

// ------------------------------------------------------------------ renderer + scenes
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.autoClear = false;
G.renderer = renderer;
G.scene = new THREE.Scene();
G.camera = new THREE.PerspectiveCamera(60, 1, 0.08, 700);
const { sky } = buildSky(G.scene);
buildLevel(G.scene);
initFx(G.scene);
initWeapons();
initHud(i => { if (live()) selectWeapon(i); });
initInput(canvas, frame);
initAbilities(frame);
applyHudLayout();
setVolume(settings.volume);
const live = () => (G.mode === 'run' || G.mode === 'range') && !G.paused;


// ------------------------------------------------------------------ sizing
function resize() {
  const iw = window.innerWidth, ih = window.innerHeight;
  let w = iw, h = ih;
  const sim = settings.aspect !== 'fill';
  if (settings.aspect === 'portrait') { h = ih - 24; w = Math.round(h * 9 / 19.5); if (w > iw - 24) { w = iw - 24; h = Math.round(w * 19.5 / 9); } }
  if (settings.aspect === 'landscape') { w = iw - 24; h = Math.round(w * 9 / 19.5); if (h > ih - 24) { h = ih - 24; w = Math.round(h * 19.5 / 9); } }
  Object.assign(frame.style, { width: w + 'px', height: h + 'px', left: Math.round((iw - w) / 2) + 'px', top: Math.round((ih - h) / 2) + 'px' });
  frame.classList.toggle('sim', sim);
  G.view.w = w; G.view.h = h; G.view.dpr = renderer.getPixelRatio();
  renderer.setSize(w, h, false);
  resizeOverlay();
  layoutViewmodel();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// ------------------------------------------------------------------ game flow
function startGame(mode) {
  initAudio();
  if (matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {}).finally(() => setTimeout(resize, 300));
  }
  $('start').classList.add('hidden'); $('end').classList.add('hidden');
  G.stats = freshStats(); G.score = 0; G.combo = 0;
  resetPlayer(); resetWeapons(); resetAbilities(); clearHudFx(); cancelAim();
  G.mode = mode; G.paused = false;
  if (mode === 'range') startRange();
  else { rig.pos.copy(ENCOUNTERS[0].path[0]); startEncounter(0, true); }
}

function showEnd(title) {
  G.mode = 'end';
  cancelAim();
  $('endTitle').textContent = title;
  $('endStats').innerHTML = `<pre style="white-space:pre-wrap;margin:0;font-size:11px">${statsText()}</pre>`;
  $('btnRetry').style.display = title === 'DOWNED' ? '' : 'none';
  $('end').classList.remove('hidden');
}
setDownHook(() => setTimeout(() => showEnd('DOWNED'), 700));
setRunCompleteHook(() => showEnd('RUN COMPLETE'));
setKillHook((e) => onKill(e, { id: 'blast', j: { killstop: 0.05 } }, null, false));

$('btnRun').onclick = () => startGame('run');
$('btnRange').onclick = () => startGame('range');
$('btnRestart').onclick = () => startGame('run');
$('btnRetry').onclick = () => {
  $('end').classList.add('hidden');
  resetPlayer(); resetWeapons(); resetAbilities(); clearHudFx();
  G.mode = 'run';
  startEncounter(LV.idx, false);
};
$('btnCopy').onclick = () => copy();
function copy() {
  const txt = statsJson();
  (navigator.clipboard?.writeText(txt) ?? Promise.reject()).then(() => popScreenText('COPIED', '#7dff8a'), () => { console.log(txt); popScreenText('SEE CONSOLE', '#fff'); });
}

initPanel({
  changed(key) {
    if (key === 'aspect' || key.startsWith('hud.vm') || key === 'hud.viewmodel') resize();
    if (key.startsWith('hud.')) applyHudLayout();
  },
  spawn(type) { if (G.mode === 'run' || G.mode === 'range') spawnAhead(type, rig); closePanel(); },
  juiceAll(on) { for (const k of Object.keys(settings.juice)) if (k !== 'master') settings.juice[k] = on; saveSettings(); rebuildPanel(); },
  restart() { closePanel(); startGame('run'); },
  range() { closePanel(); startGame('range'); },
  jump(i) {
    closePanel();
    if (G.mode !== 'run') startGame('run');
    resetPlayer();
    startEncounter(i, false);
  },
  reset() { resetSettings(); setVolume(settings.volume); applyHudLayout(); resize(); rebuildPanel(); },
  copy,
});

// ------------------------------------------------------------------ loop
let last = performance.now();
const fpsEl = document.createElement('div');
Object.assign(fpsEl.style, { position: 'absolute', left: '50%', bottom: '2px', transform: 'translateX(-50%)', font: '10px monospace', color: 'rgba(255,255,255,.45)', pointerEvents: 'none' });
frame.appendChild(fpsEl);
let fpsAcc = 0, fpsN = 0;

function loop(t) {
  requestAnimationFrame(loop);
  const rdt = Math.min(0.05, (t - last) / 1000);
  last = t;
  G.time.real += rdt;
  fpsAcc += rdt; fpsN++;
  if (fpsAcc > 0.5) { fpsEl.textContent = Math.round(fpsN / fpsAcc) + ' fps · ' + G.view.w + '×' + G.view.h + ' · vfov ' + Math.round(G.view.vfov) + '°'; fpsAcc = 0; fpsN = 0; }

  const playing = (G.mode === 'run' || G.mode === 'range' || G.mode === 'end') && !G.paused;
  if (playing) {
    let scale = settings.game.gameSpeed;
    if (G.time.slowmo > 0) { G.time.slowmo -= rdt; scale *= G.time.slowmoScale; }
    if (G.time.focus > 0) scale *= 0.35;
    let gdt = rdt * scale, pdt = G.time.focus > 0 ? rdt * settings.game.gameSpeed : gdt;
    if (G.time.hitstop > 0) { G.time.hitstop -= rdt; gdt = 0; pdt = 0; }
    G.time.now += gdt;
    if (G.mode !== 'end') {
      updateInput(pdt, rdt);
      updateWeapons(pdt, rdt);
      updateAbilities(rdt, gdt);
      updateLevel(gdt);
    }
    updateEnemies(gdt);
    updateProjectiles(gdt);
    updateFx(gdt, rdt);
    G.comboT -= gdt; if (G.comboT <= 0) G.combo = 0;
  } else if (G.mode === 'menu') {
    // slow idle sway behind the title card
    const E = ENCOUNTERS[0];
    rig.pos.set(E.stop.x + Math.sin(t / 3000) * 1.5, E.stop.y + 0.4, E.stop.z + 4);
    const m = new THREE.Matrix4().lookAt(rig.pos, E.look, new THREE.Vector3(0, 1, 0));
    rig.quat.setFromRotationMatrix(m);
    updateFx(rdt, rdt);
  }
  if (!G.paused) updateCamera(rdt);
  updateViewmodel(G.paused ? 0 : rdt, rig.moving);
  sky.position.copy(G.camera.position);

  renderer.clear();
  renderer.render(G.scene, G.camera);
  if (settings.hud.viewmodel && !G.aim.scoped && G.mode !== 'menu') { renderer.clearDepth(); renderer.render(G.vmScene, G.vmCamera); }
  updateHudDom(W, AB);
  drawOverlay(G.paused ? 0 : rdt, W, grenadeAim);
}
requestAnimationFrame(loop);

// expose for console poking / automated tests
window.DR = { G, settings, W, LV, startGame, selectWeapon, startEncounter, spawnAhead: t => spawnAhead(t, rig) };
