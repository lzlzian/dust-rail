// Test bench: every knob that answers one of the six de-risking questions, live-editable on device.
import * as THREE from 'three';
import { G } from './state.js';
import { settings, saveSettings, resetSettings, getPath, setPath, WEAPONS, DEFAULTS } from './config.js';
import { setVolume } from './audio.js';
import { spawnEnemy } from './enemies.js';
import { ENCOUNTERS } from './level.js';

const $ = id => document.getElementById(id);

const sel = (key, label, options) => ({ key, label, type: 'select', options });
const rng = (key, label, min, max, step, fmt = v => v) => ({ key, label, type: 'range', min, max, step, fmt });
const chk = (key, label) => ({ key, label, type: 'check' });

function sections(hooks) {
  return [
    {
      title: '1 · PORTRAIT FRAMING', q: 'Portrait keeps the side-to-side view constant, so a tall phone gets a tall view: use it for towers, roofs and flyers. Rotate the phone (or pick a simulated frame) to compare against landscape. Turn on "target px" to see how big heads and bodies really are on screen.',
      items: [
        sel('aspect', 'Simulated frame', [['fill', 'Fill window / device'], ['portrait', 'Portrait 9:19.5'], ['landscape', 'Landscape 19.5:9']]),
        sel('fovFit', 'FOV fit', [['auto', 'Auto (portrait: horiz · landscape: vert)'], ['horizontal', 'Horizontal (portrait = tall view)'], ['vertical', 'Vertical (portrait = narrow)']]),
        rng('hFov', 'Horizontal FOV (portrait)', 40, 90, 1, v => v + '°'),
        rng('maxVFov', 'Max vertical FOV', 70, 120, 1, v => v + '°'),
        rng('vFov', 'Vertical FOV (landscape)', 40, 90, 1, v => v + '°'),
        chk('hud.targetPx', 'Show target size (px)'),
        chk('hud.hitboxes', 'Show hitboxes'),
      ],
    },
    {
      title: '1b · CAMERA BEATS', q: 'Portrait only shows about ±30° side to side, so each stop is split into arcade camera angles: the front, then left/right flank sub-encounters. At each lull a cue points the way and the camera pans there.',
      items: [
        rng('look.panSpeed', 'Pan speed', 30, 200, 5, v => v + '°/s'),
        rng('look.cueTime', 'Cue before a pan', 0, 1.2, 0.05, v => Math.round(v * 1000) + 'ms'),
        chk('hud.offscreenEnemies', 'Arrows for off-screen enemies'),
      ],
    },
    {
      title: '2 · GUN CONTROLS', q: 'Trackpad aim (Nikke-style) on every gun: the reticle stays where you left it; touch anywhere and drag to move it. SMG, AR and revolver fire while held. Shotgun: hold to tighten the pattern, release to fire. Sniper: hold to scope in on the reticle, drag to fine-aim, release to fire.',
      items: [
        rng('sensitivity', 'Drag sensitivity', 0.5, 3, 0.05, v => v.toFixed(2) + 'x'),
        rng('aimAssist', 'Aim assist radius', 0, 90, 1, v => v + 'px'),
        rng('recoilClimb', 'Recoil climb (SMG/AR)', 0, 3, 0.1, v => v.toFixed(1) + 'x'),
        sel('spreadPattern', 'Spread pattern', [['center', 'Center-weighted'], ['uniform', 'Uniform disc']]),
        rng('scopeSensitivity', 'Scope drag sensitivity', 0.15, 1.5, 0.05, v => v.toFixed(2) + 'x'),
        rng('scopeSway', 'Scope sway', 0, 3, 0.1, v => v.toFixed(1) + 'x'),
      ],
    },
    {
      title: '3 · SHOOTING PROJECTILES', q: 'Rockets, missiles, grenades and drone bolts can be shot down. The bracket around each one shows its real hit area.',
      items: [
        rng('projHitMult', 'Projectile hitbox size', 0.5, 4, 0.1, v => v.toFixed(1) + 'x'),
        rng('projAssist', 'Projectile assist bonus', 0, 4, 0.1, v => v.toFixed(1) + 'x'),
        rng('game.projSpeed', 'Projectile speed', 0.4, 1.8, 0.05, v => v.toFixed(2) + 'x'),
        chk('hud.projMarkers', 'Danger brackets'),
        { type: 'buttons', buttons: [['Spawn rocketeer', () => hooks.spawn('rocketeer')], ['Spawn grenadier', () => hooks.spawn('grenadier')], ['Spawn drone', () => hooks.spawn('drone')]] },
      ],
    },
    {
      title: '4 · CHARGE-UP TELEGRAPHS', q: 'Heavies (blue arm cannon), snipers (red laser) and the boss charge big attacks. Turn layers off one at a time to find the minimum that still reads. Interrupt a charge by dumping damage into the enemy, or hit the glowing core for double credit.',
      items: [
        chk('tele.glow', 'Charging orb + particles'),
        chk('tele.laser', 'Laser sight to camera'),
        chk('tele.ring', 'Shrinking countdown ring'),
        chk('tele.outline', 'Outline flashes red'),
        chk('tele.icon', '"!!" over head'),
        chk('tele.offscreen', 'Off-screen arrow + edge glow'),
        chk('tele.audio', 'Rising whine'),
        chk('tele.haptic', 'Haptic ticks (Android)'),
        chk('tele.slowmo', 'Danger slow-mo at 60%'),
        { type: 'buttons', buttons: [['Spawn heavy', () => hooks.spawn('heavy')], ['Spawn sniper', () => hooks.spawn('sniper')]] },
      ],
    },
    {
      title: '5 · JUICE', q: 'Set master to 0 and back to 1 to feel the difference. Each layer can be isolated.',
      items: [
        rng('juice.master', 'Master intensity', 0, 2, 0.05, v => v.toFixed(2) + 'x'),
        ...['shake', 'kick', 'recoil', 'flash', 'tracers', 'impact', 'numbers', 'markers', 'hitstop', 'gibs', 'shells', 'fovPunch', 'lean', 'sound', 'haptics'].map(k => chk('juice.' + k, { shake: 'Screen shake', kick: 'Camera kick', recoil: 'Viewmodel recoil', flash: 'Muzzle flash + light', tracers: 'Tracers', impact: 'Impact particles + decals', numbers: 'Damage numbers', markers: 'Hit markers + tick', hitstop: 'Hit-stop (freeze frames)', gibs: 'Gibs / debris', shells: 'Shell casings', fovPunch: 'FOV punch', lean: 'Camera leans to reticle', sound: 'Sound', haptics: 'Haptics (Android)' }[k])),
        { type: 'buttons', buttons: [['All layers on', () => hooks.juiceAll(true)], ['All layers off', () => hooks.juiceAll(false)]] },
      ],
    },
    {
      title: '6 · HUD REAL ESTATE', q: 'Three button layouts for the same 4 abilities + 5 guns. Thumb zones show what one hand (or two) can comfortably reach.',
      items: [
        sel('hud.layout', 'Layout', [['bottom', 'Bottom bar (2 rows)'], ['arc', 'Thumb arc (right hand)'], ['rails', 'Side rails (bottom clear)']]),
        rng('hud.buttonSize', 'Button size', 44, 90, 1, v => v + 'px'),
        sel('hud.thumbZones', 'Thumb zones', [['off', 'Off'], ['right', 'Right thumb'], ['left', 'Left thumb'], ['both', 'Both thumbs']]),
        chk('hud.viewmodel', 'Show gun viewmodel'),
        rng('hud.vmScale', 'Viewmodel scale', 0.6, 1.6, 0.05, v => v.toFixed(2) + 'x'),
      ],
    },
    {
      title: 'GAME', q: '',
      items: [
        chk('game.god', 'God mode (HP never hits 0)'),
        rng('game.enemyDmg', 'Enemy damage', 0, 3, 0.1, v => v.toFixed(1) + 'x'),
        rng('game.gameSpeed', 'Game speed', 0.25, 1.5, 0.05, v => v.toFixed(2) + 'x'),
        rng('game.attackTokens', 'Max simultaneous attackers', 1, 6, 1),
        rng('volume', 'Volume', 0, 1, 0.05, v => Math.round(v * 100) + '%'),
        { type: 'jump' },
        { type: 'buttons', buttons: [['Restart run', () => hooks.restart()], ['Shooting range', () => hooks.range()], ['Reset all settings', () => hooks.reset()]] },
      ],
    },
    { title: 'STATS', q: 'Per-session numbers to compare between playtesters.', items: [{ type: 'stats' }, { type: 'buttons', buttons: [['Copy stats JSON', () => hooks.copy()]] }] },
  ];
}

let hooksRef = null;
export function initPanel(hooks) {
  hooksRef = hooks;
  $('gear').addEventListener('pointerdown', e => { e.stopPropagation(); openPanel(); });
  $('panelClose').addEventListener('click', closePanel);
  build();
}

function build() {
  const body = $('panelBody');
  body.innerHTML = '';
  sections(hooksRef).forEach((s, si) => {
    const d = document.createElement('details');
    if (si < 2) d.open = true;
    d.innerHTML = `<summary>${s.title}</summary>` + (s.q ? `<div class="q">${s.q}</div>` : '');
    for (const it of s.items) d.appendChild(control(it));
    body.appendChild(d);
  });
}

function control(it) {
  const row = document.createElement('div');
  if (it.type === 'html') { row.className = 'desc'; row.innerHTML = it.html; return row; }
  if (it.type === 'buttons') {
    row.className = 'btns';
    for (const [label, fn] of it.buttons) { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; row.appendChild(b); }
    return row;
  }
  if (it.type === 'stats') { row.innerHTML = '<pre id="statsPre"></pre>'; return row; }
  if (it.type === 'jump') {
    row.className = 'row';
    row.innerHTML = `<label>Jump to encounter</label><select>${ENCOUNTERS.map((e, i) => `<option value="${i}">${i + 1}. ${e.name}</option>`).join('')}</select>`;
    const s = row.querySelector('select');
    s.value = '';
    s.onchange = () => hooksRef.jump(+s.value);
    return row;
  }
  row.className = 'row';
  const v = getPath(settings, it.key);
  if (it.type === 'select') {
    row.innerHTML = `<label>${it.label}</label><select>${it.options.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`;
    const s = row.querySelector('select'); s.value = v;
    s.onchange = () => apply(it.key, s.value);
  } else if (it.type === 'range') {
    row.innerHTML = `<label>${it.label}</label><input type="range" min="${it.min}" max="${it.max}" step="${it.step}"><span class="val"></span>`;
    const r = row.querySelector('input'), val = row.querySelector('.val');
    r.value = v; val.textContent = it.fmt(+v);
    r.oninput = () => { val.textContent = it.fmt(+r.value); apply(it.key, +r.value); };
  } else {
    row.innerHTML = `<label>${it.label}</label><input type="checkbox">`;
    const c = row.querySelector('input'); c.checked = !!v;
    c.onchange = () => apply(it.key, c.checked);
  }
  return row;
}

function apply(key, v) {
  setPath(settings, key, v);
  saveSettings();
  if (key === 'volume') setVolume(v);
  hooksRef.changed(key);
}

export function openPanel() {
  G.paused = true;
  $('panel').classList.remove('hidden');
  const pre = $('statsPre'); if (pre) pre.textContent = statsText();
}
export function closePanel() {
  $('panel').classList.add('hidden');
  G.paused = false;
}
export function rebuildPanel() { build(); }

// ------------------------------------------------------------------ stats
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '-');
export function statsText() {
  const s = G.stats;
  const lines = [];
  lines.push('WEAPON      shots  acc  crit kills');
  for (const w of WEAPONS) {
    const x = s.weapons[w.id];
    if (!x.shots) continue;
    lines.push(`${w.id.padEnd(10)} ${String(x.shots).padStart(5)} ${pct(x.hits, x.shots).padStart(4)} ${pct(x.crits, x.hits).padStart(5)} ${String(x.kills).padStart(5)}`);
  }
  const p = s.proj;
  lines.push(`\nPROJECTILES  spawned ${p.spawned} · shot down ${p.intercepted} (${pct(p.intercepted, p.spawned)}) · hit you ${p.hitPlayer} · blocked ${p.blocked}`);
  const c = s.charge;
  lines.push(`CHARGE ATTACKS  started ${c.started} · interrupted ${c.interrupted} · killed mid-charge ${c.killed} · landed ${c.landed} · blocked ${c.blocked}`);
  const dt = Object.entries(s.dmgTaken).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  lines.push(`DAMAGE TAKEN  ${dt || 'none'}`);
  lines.push(`ABILITIES  ${Object.entries(s.abilities).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  if (s.encounters.length) lines.push('ENCOUNTERS\n' + s.encounters.map(e => `  ${e.name.padEnd(16)} ${String(e.secs).padStart(5)}s  hp ${e.hp}`).join('\n'));
  lines.push(`downs ${s.downs} · score ${G.score}`);
  return lines.join('\n');
}
export function statsJson() {
  return JSON.stringify({ when: new Date().toISOString(), ua: navigator.userAgent, view: { w: G.view.w, h: G.view.h, vfov: +G.view.vfov.toFixed(1) }, settings, stats: G.stats, score: G.score }, null, 2);
}

export function spawnAhead(type, rig) {
  // spawn where the camera is looking (it may be turned toward a flank), not down the rail
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion); fwd.y = 0; fwd.normalize();
  const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const base = rig.pos.clone().addScaledVector(fwd, type === 'heavy' ? 18 : 13).addScaledVector(side, (Math.random() - 0.5) * 8);
  base.y = type === 'drone' ? 6 + Math.random() * 3 : 0;
  const from = base.clone().addScaledVector(fwd, 10);
  spawnEnemy(type, { at: base.toArray(), enter: type === 'drone' ? undefined : 'run', from: from.toArray(), stopDist: 9, wander: 2.5 });
}
export { DEFAULTS };
