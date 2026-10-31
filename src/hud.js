// HUD: DOM widgets (health, ammo, buttons) + a 2D overlay canvas for everything screen-space
// (reticles, damage numbers, hit markers, telegraph rings, off-screen arrows, projectile markers, debug overlays).
import * as THREE from 'three';
import { G, clamp, lerp, rand } from './state.js';
import { WEAPONS, SCHEMES, settings, J } from './config.js';
import { project, pxRadius, pick, projRadius } from './combat.js';

let ctx, cv;
const $ = id => document.getElementById(id);
const items = { nums: [], texts: [], screen: [], markers: [], ripples: [] };
const _pp = { x: 0, y: 0, behind: false, dist: 0 };

export const ICONS = {
  revolver: '<svg viewBox="0 0 48 24"><path d="M6 7h26v3h8v4h-8v1H18l-3 7H8l3-8H6z"/><circle cx="20" cy="11" r="4"/></svg>',
  smg: '<svg viewBox="0 0 48 24"><path d="M4 6h30v3h8v3h-8v3H24l-2 7h-5l1-7h-6l-2 4H6l2-5H4z"/><path d="M25 15h4v8h-4z"/></svg>',
  ar: '<svg viewBox="0 0 48 24"><path d="M2 8h8l2-2h26v3h8v3h-8v2H26l-2 8h-5l1-8h-6l-3 3H8l1-3H2z"/><path d="M28 14h5l2 7h-4z"/></svg>',
  shotgun: '<svg viewBox="0 0 48 24"><path d="M2 9l8-2h36v5H26v2h-4l-3 2H9l-7 3z"/><path d="M28 12h10v3H28z"/></svg>',
  sniper: '<svg viewBox="0 0 48 24"><path d="M2 11l7-2h4V7h12v2h22v3H26v2h-8l-3 4H9l-7 2z"/><path d="M14 3h10v3H14z"/></svg>',
  cover: '<svg viewBox="0 0 24 24"><path d="M12 2l9 3v6c0 6-4 10-9 11C7 21 3 17 3 11V5z"/></svg>',
  grenade: '<svg viewBox="0 0 24 24"><circle cx="11" cy="14" r="7"/><path d="M9 4h5v4H9zM14 5l5-3 1 2-5 3z"/></svg>',
  focus: '<svg viewBox="0 0 24 24"><path d="M6 2h12v2l-4 7v2l4 7v2H6v-2l4-7v-2L6 4z"/></svg>',
  medkit: '<svg viewBox="0 0 24 24"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>',
};

export function initHud(onWeapon, onScheme) {
  cv = $('overlay'); ctx = cv.getContext('2d');
  const wrap = $('weapons');
  WEAPONS.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'wbtn ui'; b.innerHTML = ICONS[w.id] + `<span class="key">${i + 1}</span>`;
    b.addEventListener('pointerdown', e => { e.stopPropagation(); onWeapon(i); });
    wrap.appendChild(b);
  });
  for (const id of ['cover', 'grenade', 'focus', 'medkit']) $('ab' + id[0].toUpperCase() + id.slice(1)).querySelector('.ic').innerHTML = ICONS[id];
  $('scheme').addEventListener('pointerdown', e => { e.stopPropagation(); onScheme(); });
}

export function resizeOverlay() {
  cv.width = Math.round(G.view.w * G.view.dpr); cv.height = Math.round(G.view.h * G.view.dpr);
}

export function applyHudLayout() {
  const hud = $('hud');
  hud.className = 'layout-' + settings.hud.layout;
  hud.style.setProperty('--bs', settings.hud.buttonSize + 'px');
}

// ------------------------------------------------------------------ spawners
export function popDamage(p, dmg, crit, enemy) {
  if (!J('numbers')) return;
  if (items.nums.length > 40) items.nums.shift();
  items.nums.push({ p: p.clone(), ox: 0, oy: 0, vx: rand(-60, 60), vy: rand(-260, -200), t: 0, life: crit ? 1.0 : 0.8, text: String(dmg), crit, size: clamp(16 + Math.sqrt(dmg) * 2.2, 16, 46) * (crit ? 1.25 : 1) });
}
export function popText(p, text, color = '#fff4dc', scale = 1) {
  items.texts.push({ p: p.clone(), t: 0, life: 1.0, text, color, scale });
}
export function popScreenText(text, color = '#fff4dc', scale = 1) {
  if (items.screen.some(s => s.text === text && s.t < 0.3)) return;
  items.screen.push({ t: 0, life: 0.8, text, color, scale });
}
export function hitMarker(x, y, kind) { items.markers.push({ x, y, kind, t: 0, life: kind === 'kill' ? 0.35 : 0.2 }); }
export function tapRipple(x, y) { items.ripples.push({ x, y, t: 0, life: 0.3 }); }

let bannerTimer = 0;
export function banner(text, sub = '') {
  const b = $('banner');
  b.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), 2000);
}
export function setStage(name, prog) { $('stageName').textContent = name; $('stageProg').textContent = prog; }

// ------------------------------------------------------------------ DOM update
let lastHp = -1, lastAmmo = '', lastScore = -1, lastIdx = -1, lastScheme = '';
export function updateHudDom(W, abilities) {
  const P = G.player, w = WEAPONS[W.idx];
  if (P.hp !== lastHp) {
    lastHp = P.hp;
    const pct = Math.max(0, P.hp / P.maxHp) * 100;
    $('hpFill').style.width = pct + '%'; $('hpGhost').style.width = pct + '%';
    $('hpText').textContent = Math.ceil(P.hp);
    $('hpBar').classList.toggle('low', pct < 30);
  }
  const ammo = W.ammo[W.idx] + '/' + w.mag;
  if (ammo !== lastAmmo) {
    lastAmmo = ammo;
    $('ammoNum').textContent = W.ammo[W.idx]; $('ammoMax').textContent = '/' + w.mag;
    $('ammo').classList.toggle('empty', W.ammo[W.idx] === 0);
  }
  if (W.reloadPop) { W.reloadPop = false; const a = $('ammo'); a.classList.remove('pop'); void a.offsetWidth; a.classList.add('pop'); }
  $('reloadBar').classList.toggle('on', W.reloading);
  if (W.reloading) $('reloadBar').firstChild.style.width = Math.min(100, (W.reloadT / w.reload) * 100) + '%';
  if (G.score !== lastScore) { lastScore = G.score; $('score').textContent = G.score.toLocaleString(); }
  $('combo').textContent = G.combo > 1 ? `x${G.combo} COMBO` : '';
  const sc = settings.schemes[w.id];
  if (W.idx !== lastIdx || sc !== lastScheme) {
    lastIdx = W.idx; lastScheme = sc;
    $('wName').textContent = w.name;
    $('scheme').textContent = SCHEMES[sc].short + ' ↻';
    [...$('weapons').children].forEach((b, i) => b.classList.toggle('on', i === W.idx));
  }
  for (const [id, a] of Object.entries(abilities)) {
    const el = $('ab' + id[0].toUpperCase() + id.slice(1));
    el.style.setProperty('--cd', a.cd > 0 ? (a.cd / a.cdMax).toFixed(3) : 0);
    el.classList.toggle('active', !!a.active);
    el.classList.toggle('disabled', a.charges === 0 && !a.active);
    const ch = el.querySelector('.ch');
    if (ch) ch.textContent = a.charges !== undefined ? a.charges : '';
  }
}

// ------------------------------------------------------------------ overlay drawing
function text(t, x, y, size, fill, stroke = '#1b120c', lw = 0, align = 'center') {
  ctx.font = `italic 900 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw || Math.max(3, size * 0.22);
  ctx.strokeStyle = stroke; ctx.strokeText(t, x, y);
  ctx.fillStyle = fill; ctx.fillText(t, x, y);
}

function edgeArrow(x, y, color, p, label, scale = 1) {
  // clamp to the frame edge, point toward (x, y)
  const w = G.view.w, h = G.view.h, cx = w / 2, cy = h / 2, m = 34;
  const dx = x - cx, dy = y - cy;
  const s = Math.min((w / 2 - m) / Math.abs(dx || 1e-3), (h / 2 - m - 40) / Math.abs(dy || 1e-3));
  const ax = cx + dx * s, ay = cy + dy * s, a = Math.atan2(dy, dx);
  ctx.save(); ctx.translate(ax, ay); ctx.scale(scale, scale);
  ctx.save(); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-8, -14); ctx.lineTo(-2, 0); ctx.lineTo(-8, 14); ctx.closePath();
  ctx.fillStyle = color; ctx.strokeStyle = '#1b120c'; ctx.lineWidth = 4; ctx.stroke(); ctx.fill();
  ctx.restore();
  if (p !== undefined) { ctx.beginPath(); ctx.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke(); }
  if (label) text(label, 0, 36, 13, color);
  ctx.restore();
  return { ax, ay, a };
}

function drawThumbZones() {
  const mode = settings.hud.thumbZones;
  if (mode === 'off') return;
  const w = G.view.w, h = G.view.h;
  // Rough one-thumb reach model for a ~6" phone held at the bottom. Units scale with frame width.
  const piv = [];
  if (mode === 'right' || mode === 'both') piv.push([w * 1.02, h * 1.0]);
  if (mode === 'left' || mode === 'both') piv.push([-w * 0.02, h * 1.0]);
  const R = Math.min(w, h * 0.5);
  ctx.save();
  ctx.fillStyle = 'rgba(255,40,40,.24)'; ctx.fillRect(0, 0, w, h);
  for (const [px, py] of piv) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(px, py, R * 1.0, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  for (const [px, py] of piv) {
    ctx.fillStyle = 'rgba(255,210,60,.2)'; ctx.beginPath(); ctx.arc(px, py, R * 1.0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(80,255,120,.24)'; ctx.beginPath(); ctx.arc(px, py, R * 0.78, 0, Math.PI * 2); ctx.arc(px, py, R * 0.3, 0, Math.PI * 2, true); ctx.fill();
    ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
    for (const [k, c] of [[1, '#ffd23f'], [0.78, '#7dff8a']]) { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(px, py, R * k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  text('THUMB ZONES: green easy · yellow stretch · red hard', w / 2, h * 0.16, 11, '#fff', '#1b120c', 3);
  ctx.restore();
}

function reticle(w, x, y, onTarget) {
  const col = onTarget ? '#ff3b2f' : '#ffffff';
  const sp = G.view.focalPx * Math.tan((w.spread + G.aim.bloom) * Math.PI / 180);
  ctx.save(); ctx.translate(x, y);
  ctx.lineCap = 'round';
  const both = (fn) => { ctx.strokeStyle = '#1b120c'; ctx.lineWidth = 5; fn(); ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 2.2; fn(); ctx.stroke(); };
  if (w.id === 'revolver') { both(() => { ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); }); both(() => { ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, Math.PI * 2); }); }
  else if (w.id === 'shotgun') { const r = Math.max(18, sp); both(() => { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); }); both(() => { ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.moveTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6)); ctx.lineTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6)); } }); }
  else if (w.id === 'smg') { const g = 7 + sp; both(() => { ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; ctx.moveTo(Math.cos(a) * g, Math.sin(a) * g); ctx.lineTo(Math.cos(a) * (g + 8), Math.sin(a) * (g + 8)); } }); }
  else if (w.id === 'ar') { const g = 6 + sp; both(() => { ctx.beginPath(); ctx.moveTo(-g - 10, 0); ctx.lineTo(-g, 0); ctx.moveTo(g, 0); ctx.lineTo(g + 10, 0); ctx.moveTo(0, g); ctx.lineTo(0, g + 10); ctx.moveTo(0, -g - 10); ctx.lineTo(0, -g); }); both(() => { ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, Math.PI * 2); }); }
  else { both(() => { ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); }); both(() => { ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, Math.PI * 2); }); }
  // auto-trigger dwell ring
  if (settings.schemes[w.id] === 'drag-autofire' && onTarget) {
    const p = clamp(G.aim.autoT / Math.max(0.01, settings.autoFireDelay), 0, 1);
    ctx.beginPath(); ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.strokeStyle = '#ff3b2f'; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.restore();
}

function drawScope(z) {
  const w = G.view.w, h = G.view.h, cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.47;
  ctx.save();
  ctx.globalAlpha = clamp(z * 1.4 - 0.2, 0, 1);
  ctx.fillStyle = '#0a0705';
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.arc(cx, cy, r, 0, Math.PI * 2, true); ctx.fill();
  const g = ctx.createRadialGradient(cx, cy, r * 0.75, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.75)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - 10, cy); ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy + 10); ctx.lineTo(cx, cy + r); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - 10); ctx.stroke();
  ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r * 0.55, cy); ctx.moveTo(cx + r * 0.55, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy + r * 0.55); ctx.lineTo(cx, cy + r); ctx.stroke();
  for (let i = 1; i < 5; i++) { ctx.fillStyle = '#111'; ctx.fillRect(cx + i * r * 0.1 - 1.5, cy - 4, 3, 8); ctx.fillRect(cx - i * r * 0.1 - 1.5, cy - 4, 3, 8); ctx.fillRect(cx - 4, cy + i * r * 0.1 - 1.5, 8, 3); }
  ctx.fillStyle = '#ff3b2f'; ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = '#1b120c'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (z > 0.9) text('RELEASE TO FIRE', cx, cy + r * 0.72, 12, 'rgba(255,244,220,.8)', '#000', 3);
  ctx.restore();
}

function drawCover(k, reloading) {
  const w = G.view.w, h = G.view.h, top = h - h * 0.42 * k;
  ctx.save();
  ctx.fillStyle = '#7a4f2c'; ctx.fillRect(-10, top, w + 20, h);
  ctx.fillStyle = '#5e3b20';
  for (let i = 0; i < 4; i++) ctx.fillRect(-10, top + 20 + i * 52, w + 20, 6);
  ctx.strokeStyle = '#1b120c'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-10, top); ctx.lineTo(w + 10, top); ctx.stroke();
  ctx.fillStyle = '#9a6a3a'; ctx.fillRect(-10, top + 3, w + 20, 10);
  if (k > 0.8) text(reloading ? 'IN COVER · reloading' : 'IN COVER', w / 2, top + 36, 14, '#ffd23f');
  ctx.restore();
}

export function drawOverlay(rdt, Wst, grenadeAim) {
  const w = G.view.w, h = G.view.h;
  ctx.setTransform(G.view.dpr, 0, 0, G.view.dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (G.mode === 'menu') return;
  const tele = settings.tele, wpn = WEAPONS[Wst.idx], now = G.time.real;

  drawThumbZones();

  // debug: hitboxes with on-screen pixel size
  if (settings.hud.hitboxes || settings.hud.targetPx) {
    ctx.save(); ctx.lineWidth = 1.5;
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible) continue;
      for (const hb of e.hitboxes) {
        project(hb.c, _pp); if (_pp.behind) continue;
        const r = pxRadius(hb.r, _pp.dist);
        if (settings.hud.hitboxes) { ctx.strokeStyle = hb.tag === 'head' ? '#ffd23f' : hb.weak ? '#4fe3ff' : 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(_pp.x, _pp.y, r, 0, Math.PI * 2); ctx.stroke(); }
        if (settings.hud.targetPx && (hb.tag === 'head' || hb === e.hitboxes[0])) text(`${hb.tag} ${Math.round(r * 2)}px`, _pp.x + r + 4, _pp.y, 10, '#fff', '#000', 3, 'left');
      }
    }
    ctx.restore();
  }

  // projectile danger markers (ring = the actual shootable area)
  if (settings.hud.projMarkers) {
    for (const p of G.projectiles) {
      project(p.pos, _pp);
      const r = Math.max(10, pxRadius(projRadius(p), _pp.dist));
      const urgent = p.eta < 1.0;
      const col = urgent ? '#ff3b2f' : '#ffb03a';
      const off = _pp.behind || _pp.x < 0 || _pp.x > w || _pp.y < 0 || _pp.y > h;
      if (off) { edgeArrow(_pp.x, _pp.y, col); continue; }
      ctx.save(); ctx.translate(_pp.x, _pp.y);
      const pulse = 1 + Math.sin(now * (urgent ? 30 : 14)) * 0.08;
      ctx.lineWidth = 4; ctx.strokeStyle = '#1b120c';
      const c = r * pulse, k = Math.max(6, c * 0.45);
      const corners = () => { ctx.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(sx * c, sy * (c - k)); ctx.lineTo(sx * c, sy * c); ctx.lineTo(sx * (c - k), sy * c); } };
      corners(); ctx.stroke(); ctx.lineWidth = 2.2; ctx.strokeStyle = col; corners(); ctx.stroke();
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.strokeStyle = col; ctx.stroke();
      ctx.restore();
    }
  }

  // charge-up telegraphs
  for (const e of G.enemies) {
    if (!e.alive || !e.charge) continue;
    const c = e.charge, p = clamp(c.t / c.dur, 0, 1);
    const hb = e.hitboxes.find(b => b.tag === 'core') || e.hitboxes[0];
    project(hb.c, _pp);
    const off = _pp.behind || _pp.x < 20 || _pp.x > w - 20 || _pp.y < 60 || _pp.y > h - 60;
    const col = `rgb(255,${Math.round(lerp(210, 50, p))},${Math.round(lerp(60, 30, p))})`;
    if (tele.ring && !off) {
      const R = lerp(90, 30, p);
      ctx.save(); ctx.translate(_pp.x, _pp.y);
      ctx.lineWidth = 7; ctx.strokeStyle = '#1b120c'; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, R + 7, -Math.PI / 2, -Math.PI / 2 + (1 - p) * Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (tele.icon && !off) {
      const hp = project(e.headPos(), { x: 0, y: 0, behind: false, dist: 0 });
      const s = 26 + Math.sin(now * (8 + p * 20)) * 4 + p * 8;
      text('!!', hp.x, hp.y - 14, s, p > 0.7 ? '#ff3b2f' : '#ffd23f', '#1b120c', 6);
    }
    if (tele.offscreen && off) {
      edgeArrow(_pp.x, _pp.y, col, 1 - p, '!!');
      // edge glow on that side
      const g = ctx.createRadialGradient(clamp(_pp.x, 0, w), clamp(_pp.y, 0, h), 0, clamp(_pp.x, 0, w), clamp(_pp.y, 0, h), Math.max(w, h) * 0.45);
      g.addColorStop(0, `rgba(255,60,30,${0.35 * (0.5 + p)})`); g.addColorStop(1, 'rgba(255,60,30,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
  }

  // small arrows for every other off-screen enemy, so you know there's something to pan to
  if (settings.hud.offscreenEnemies) {
    for (const e of G.enemies) {
      if (!e.alive || !e.counts || e.charge || !e.root.visible || !e.targetable) continue;
      project(e.hitboxes[0].c, _pp);
      if (_pp.behind || _pp.x < 0 || _pp.x > w || _pp.y < 0 || _pp.y > h) edgeArrow(_pp.x, _pp.y, '#fff4dc', undefined, '', 0.6);
    }
  }

  // paint tags
  if (G.aim.tags.length) {
    const groups = new Map();
    for (const t of G.aim.tags) { const k = t.proj || t.enemy; groups.set(k, { t, n: (groups.get(k)?.n ?? 0) + 1 }); }
    for (const { t, n } of groups.values()) {
      const pos = t.proj ? t.proj.pos : t.hb.c;
      project(pos, _pp); if (_pp.behind) continue;
      ctx.save(); ctx.translate(_pp.x, _pp.y); ctx.rotate(now * 3);
      const s = 13 + n * 1.5;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0); ctx.closePath();
      ctx.lineWidth = 5; ctx.strokeStyle = '#1b120c'; ctx.stroke(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#ff3b2f'; ctx.stroke();
      ctx.restore();
      text('x' + n, _pp.x + s + 10, _pp.y - s, 14, '#ff3b2f');
    }
  }

  // world texts
  for (let i = items.texts.length - 1; i >= 0; i--) {
    const o = items.texts[i]; o.t += rdt;
    if (o.t > o.life) { items.texts.splice(i, 1); continue; }
    project(o.p, _pp); if (_pp.behind) continue;
    const k = o.t / o.life, pop = o.t < 0.08 ? 1.5 - (o.t / 0.08) * 0.5 : 1;
    ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    text(o.text, _pp.x, _pp.y - o.t * 40, 18 * o.scale * pop, o.color);
    ctx.globalAlpha = 1;
  }
  // damage numbers (Borderlands-style pop + arc)
  for (let i = items.nums.length - 1; i >= 0; i--) {
    const o = items.nums[i]; o.t += rdt;
    if (o.t > o.life) { items.nums.splice(i, 1); continue; }
    o.vy += 620 * rdt; o.ox += o.vx * rdt; o.oy += o.vy * rdt;
    project(o.p, _pp); if (_pp.behind) continue;
    const k = o.t / o.life, pop = o.t < 0.07 ? 1.8 - (o.t / 0.07) * 0.8 : 1;
    ctx.globalAlpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
    const x = _pp.x + o.ox, y = _pp.y + o.oy - 10;
    if (o.crit) { text('CRITICAL', x, y - o.size * 0.75, 11 * pop, '#ff3b2f', '#1b120c', 3); text(o.text, x, y, o.size * pop, '#ffd23f'); }
    else text(o.text, x, y, o.size * pop, '#fff4dc');
    ctx.globalAlpha = 1;
  }

  // reticle
  const aimY = G.aim.y - G.aim.climb;
  if (G.aim.visible && !G.aim.scoped && G.view.zoom < 0.2 && G.player.alive) {
    const sc = settings.schemes[wpn.id];
    if ((sc === 'offset-hold' || sc === 'paint') && settings.reticleOffset > 0) {
      ctx.save(); ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(G.aim.x, G.aim.y + settings.reticleOffset - 26); ctx.lineTo(G.aim.x, aimY + 18); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(G.aim.x, G.aim.y + settings.reticleOffset, 24, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.stroke();
      ctx.restore();
    }
    const onT = G.aim.onTarget || (() => { const p = pick(G.aim.x, aimY, settings.aimAssist * 0.6); return !!(p.enemy || p.proj); })();
    reticle(wpn, G.aim.x, aimY, onT);
  }
  // tap ripples
  for (let i = items.ripples.length - 1; i >= 0; i--) {
    const o = items.ripples[i]; o.t += rdt;
    if (o.t > o.life) { items.ripples.splice(i, 1); continue; }
    const k = o.t / o.life;
    ctx.beginPath(); ctx.arc(o.x, o.y, 8 + k * 26, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - k)})`; ctx.lineWidth = 2.5; ctx.stroke();
  }
  // hit markers
  for (let i = items.markers.length - 1; i >= 0; i--) {
    const o = items.markers[i]; o.t += rdt;
    if (o.t > o.life) { items.markers.splice(i, 1); continue; }
    const k = o.t / o.life, kill = o.kind === 'kill', crit = o.kind === 'crit';
    const s = (kill ? 16 : crit ? 12 : 9) * (1 + (1 - k) * 0.4), g = kill ? 6 : 4;
    ctx.save(); ctx.translate(o.x, o.y); if (kill) ctx.rotate(k * 0.4);
    ctx.globalAlpha = 1 - k * k;
    const lines = () => { ctx.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(sx * g, sy * g); ctx.lineTo(sx * (g + s), sy * (g + s)); } };
    ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = '#1b120c'; lines(); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = kill ? '#ff3b2f' : crit ? '#ffd23f' : '#fff'; lines(); ctx.stroke();
    ctx.restore();
  }

  if (G.player.coverT > 0.02) drawCover(G.player.coverT, Wst.reloading);
  if (G.view.zoom > 0.02) drawScope(G.view.zoom);

  // grenade aim (dragging from the button)
  if (grenadeAim) {
    ctx.save(); ctx.translate(grenadeAim.x, grenadeAim.y);
    ctx.lineWidth = 5; ctx.strokeStyle = '#1b120c'; ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffd23f'; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.arc(0, 0, 30, now * 3, now * 3 + Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    text('RELEASE TO THROW', grenadeAim.x, grenadeAim.y - 46, 12, '#ffd23f');
  }

  // screen texts
  for (let i = items.screen.length - 1; i >= 0; i--) {
    const o = items.screen[i]; o.t += rdt;
    if (o.t > o.life) { items.screen.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - (o.t / o.life) ** 3;
    text(o.text, w / 2, h * 0.58 - o.t * 30, 20 * o.scale, o.color);
    ctx.globalAlpha = 1;
  }

  // hurt vignette + direction arcs
  const P = G.player;
  P.hurtT = Math.max(0, P.hurtT - rdt * 1.6);
  const low = P.hp / P.maxHp < 0.3 ? 0.18 + Math.sin(now * 6) * 0.08 : 0;
  const va = Math.min(0.75, P.hurtT * 0.55 + low);
  if (va > 0.01) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(200,20,10,0)'); g.addColorStop(1, `rgba(200,20,10,${va})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  for (let i = P.hurtDirs.length - 1; i >= 0; i--) {
    const d = P.hurtDirs[i]; d.t -= rdt * 1.2;
    if (d.t <= 0) { P.hurtDirs.splice(i, 1); continue; }
    const R = Math.min(w, h) * 0.38, a = d.a - Math.PI / 2;
    ctx.beginPath(); ctx.arc(w / 2, h * 0.45, R, a - 0.35, a + 0.35);
    ctx.strokeStyle = `rgba(255,50,30,${d.t})`; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke();
  }
  if (G.time.focus > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(60,180,255,0)'); g.addColorStop(1, 'rgba(60,180,255,.28)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
}

export function clearHudFx() { for (const k of Object.keys(items)) items[k].length = 0; }
