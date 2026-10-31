// Procedural mechanical foley for reloads, pumps and bolts. Every beat is rendered sample by sample into a mono
// buffer from a few physical-ish primitives:
//   hit    contact between parts: bright transient + short inharmonic resonances of the part's material + a low thump
//   slide  sliding contact: stick-slip micro-impacts through a resonance sweeping f0 → f1 (scrapes, rattles, springs)
//   brass  spent casings: ringing brass that bounces and settles
// Short decays and no reverb keep it dry and close, like foley recorded right next to the gun.
// Pure functions with no WebAudio, so it renders in node too (see tools/foley-check.mjs).

const rnd = (a, b) => a + Math.random() * (b - a);

// [freq Hz, decay time constant s, amp] per material. Real parts ring briefly; long decays read as bells.
const MAT = {
  steel: { modes: [[2350, 0.010, 1], [3610, 0.007, 0.7], [5230, 0.005, 0.5], [7420, 0.0035, 0.35], [9800, 0.0025, 0.2]], tick: 1, thump: [0, 0] },
  heavy: { modes: [[1180, 0.016, 1], [1890, 0.012, 0.75], [2790, 0.009, 0.55], [4020, 0.006, 0.4], [5650, 0.004, 0.25]], tick: 1.2, thump: [115, 0.9] },
  polymer: { modes: [[640, 0.006, 1], [1010, 0.005, 0.7], [1650, 0.004, 0.45], [2600, 0.003, 0.3]], tick: 0.6, thump: [170, 0.5] },
  alu: { modes: [[1420, 0.012, 1], [2330, 0.009, 0.7], [3560, 0.007, 0.5], [5100, 0.005, 0.3]], tick: 0.9, thump: [150, 0.4] },
  shell: { modes: [[1700, 0.005, 1], [2950, 0.004, 0.6], [4800, 0.003, 0.35]], tick: 0.7, thump: [210, 0.6] },
  brass: { modes: [[4150, 0.045, 1], [6870, 0.032, 0.6], [9620, 0.02, 0.35], [11900, 0.012, 0.2]], tick: 0.4, thump: [0, 0] },
};

// one decaying sine (recursive oscillator, cheap enough to render on a phone)
function mode(o, sr, t, f, tau, amp) {
  if (f >= sr * 0.45) return;
  const n0 = Math.floor(t * sr), N = Math.min(o.length - n0, Math.ceil(tau * 7 * sr));
  const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w), k = Math.exp(-1 / (tau * sr));
  let s1 = Math.sin(w), s0 = 0, e = amp;
  for (let i = 0; i < N; i++) { o[n0 + i] += e * s0; const s = c * s1 - s0; s0 = s1; s1 = s; e *= k; }
}
// broadband transient: under a millisecond of differentiated noise, the "t" of a click
function tick(o, sr, t, amp, len = 0.0006, bright = 1) {
  const n0 = Math.floor(t * sr), N = Math.min(o.length - n0, Math.ceil(len * 6 * sr)), k = Math.exp(-1 / (len * sr));
  let e = amp, prev = 0;
  for (let i = 0; i < N; i++) { const x = Math.random() * 2 - 1; o[n0 + i] += e * (bright * (x - prev) * 0.5 + (1 - bright) * x); prev = x; e *= k; }
}
// mass: a very short pitch-dropping sine, the weight you feel when a part seats
function thump(o, sr, t, f, amp, tau = 0.012) {
  const n0 = Math.floor(t * sr), N = Math.min(o.length - n0, Math.ceil(tau * 6 * sr)), k = Math.exp(-1 / (tau * sr));
  let ph = 0, e = amp;
  for (let i = 0; i < N; i++) {
    ph += 2 * Math.PI * f * (0.55 + 0.45 * Math.exp(-i / (sr * 0.008))) / sr;
    o[n0 + i] += e * Math.min(1, i / (sr * 0.0006)) * Math.sin(ph); e *= k;
  }
}

function hit(o, sr, t, mat, amp, { pitch = 1, damp = 1, thumpK = 1 } = {}) {
  const M = MAT[mat];
  tick(o, sr, t, amp * 0.9 * M.tick);
  for (const [f, tau, a] of M.modes) mode(o, sr, t + 0.0002, f * pitch * rnd(0.97, 1.03), tau * damp * rnd(0.85, 1.15), amp * a * rnd(0.8, 1.1) * 0.5);
  if (M.thump[0] && thumpK) thump(o, sr, t, M.thump[0] * rnd(0.92, 1.08), amp * M.thump[1] * thumpK);
}

// sliding contact through a swept band-pass (RBJ, 0 dB peak). rough = share of sparse stick-slip impulses vs smooth hiss;
// a high q makes it sing like a spring under tension.
function slide(o, sr, t, dur, f0, f1, amp, { grain = 900, rough = 0.6, q = 4, shape = 0.7 } = {}) {
  const n0 = Math.floor(t * sr), N = Math.min(o.length - n0, Math.floor(dur * sr));
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, a1 = 0, a2 = 0;
  const g = amp * Math.sqrt(q / 4) * 1.6;
  for (let i = 0; i < N; i++) {
    const u = i / N;
    if ((i & 15) === 0) {
      const w = 2 * Math.PI * Math.min(f0 * Math.pow(f1 / f0, u), sr * 0.45) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
      b0 = al / a0; a1 = -2 * Math.cos(w) / a0; a2 = (1 - al) / a0;
    }
    let x = (Math.random() * 2 - 1) * (1 - rough);
    if (Math.random() < grain / sr) x += (Math.random() * 2 - 1) * rough * 7;
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    o[n0 + i] += y * Math.pow(Math.sin(Math.PI * u), shape) * g;
  }
}

// a casing leaving the gun and settling on the ground: a clink, then bounces that get quicker and quieter
function brass(o, sr, t, amp, ground = 0.3) {
  hit(o, sr, t, 'brass', amp, { pitch: rnd(0.93, 1.08) });
  let tt = t + ground + rnd(0, 0.12), a = amp * 0.7, gap = rnd(0.06, 0.08);
  for (let i = 0; i < 4 && a > 0.01; i++) {
    hit(o, sr, tt, 'brass', a, { pitch: rnd(0.95, 1.05), damp: 0.8 });
    tt += gap; gap *= 0.62; a *= 0.5;
  }
}

// ------------------------------------------------------------------ recipes
// Each beat writes into o (mono) starting at 0: [length in s (tails included), recipe, make-up gain for quiet beats].
// Each gun gets its own parts, materials and order, so no two reloads sound alike.
const R = {
  smg: {
    magOut: [0.62, (o, s) => {
      hit(o, s, 0, 'steel', 0.25, { pitch: 1.3, damp: 0.6 }); // mag release button
      slide(o, s, 0.006, 0.075, 1500, 800, 0.32, { rough: 0.5 }); // polymer mag sliding out of the well
      hit(o, s, 0.085, 'polymer', 0.3); // clears the well
      hit(o, s, 0.38, 'polymer', 0.16, { damp: 1.6, thumpK: 1.5 }); hit(o, s, 0.47, 'polymer', 0.06, { damp: 1.4 }); // drops into the sand
    }, 1.8],
    magIn: [0.25, (o, s) => {
      slide(o, s, 0, 0.05, 700, 1500, 0.32);
      hit(o, s, 0.052, 'polymer', 0.55); // mag meets the well
      hit(o, s, 0.07, 'steel', 0.6, { pitch: 0.9 }); // catch snaps over it
    }],
    rack: [0.32, (o, s) => {
      hit(o, s, 0, 'steel', 0.3, { pitch: 1.2 }); // grab the handle
      slide(o, s, 0.008, 0.07, 1200, 2600, 0.36, { rough: 0.4, q: 10 }); // pull against the spring
      hit(o, s, 0.08, 'steel', 0.45); // handle hits the back stop
      slide(o, s, 0.135, 0.03, 2600, 1500, 0.3); // let go
      hit(o, s, 0.165, 'heavy', 0.95, { thumpK: 1.2 }); hit(o, s, 0.175, 'steel', 0.22); // bolt slams home + rattle
    }],
  },
  ar: {
    magOut: [0.6, (o, s) => {
      hit(o, s, 0, 'steel', 0.3, { pitch: 1.1 });
      slide(o, s, 0.006, 0.09, 1900, 900, 0.36, { rough: 0.55 }); // aluminium mag drags out
      hit(o, s, 0.1, 'alu', 0.3);
      hit(o, s, 0.36, 'alu', 0.2, { damp: 1.6, thumpK: 1.5 }); hit(o, s, 0.44, 'alu', 0.07, { damp: 1.3 }); // into the sand
    }, 1.6],
    magIn: [0.3, (o, s) => {
      slide(o, s, 0, 0.05, 900, 1800, 0.36);
      hit(o, s, 0.052, 'alu', 0.55); // first contact
      hit(o, s, 0.09, 'steel', 0.7, { pitch: 0.85 }); // "click … CLACK": the latch
      thump(o, s, 0.105, 95, 0.55, 0.015); tick(o, s, 0.105, 0.25, 0.002, 0); // palm slap to seat it
    }],
    rack: [0.25, (o, s) => {
      hit(o, s, 0, 'steel', 0.35, { pitch: 1.4, damp: 0.6 }); // thumb on the bolt catch
      slide(o, s, 0.005, 0.02, 2400, 1400, 0.3);
      hit(o, s, 0.025, 'heavy', 1.0, { pitch: 0.95, thumpK: 1.4 }); hit(o, s, 0.04, 'steel', 0.2); // carrier slams forward
    }],
  },
  revolver: {
    cylOpen: [0.2, (o, s) => {
      hit(o, s, 0, 'steel', 0.35, { pitch: 1.35, damp: 0.7 }); // thumb latch
      slide(o, s, 0.01, 0.035, 2600, 3400, 0.16, { rough: 0.7 }); // crane swings out
      hit(o, s, 0.05, 'steel', 0.4, { pitch: 1.1 });
    }, 1.6],
    eject: [0.9, (o, s) => {
      slide(o, s, 0, 0.05, 1800, 2600, 0.2); // ejector rod
      for (let i = 0; i < 6; i++) brass(o, s, 0.05 + rnd(0, 0.06), rnd(0.14, 0.22), rnd(0.25, 0.4)); // six empties
    }, 1.6],
    speedload: [0.2, (o, s) => {
      slide(o, s, 0, 0.04, 1400, 2400, 0.2);
      for (let i = 0; i < 6; i++) hit(o, s, 0.005 + i * 0.006 + rnd(0, 0.003), 'brass', 0.07, { damp: 0.4 }); // rounds drop into chambers
      hit(o, s, 0.06, 'steel', 0.35, { pitch: 1.2 }); slide(o, s, 0.065, 0.02, 2000, 2600, 0.12); // twist the knob, pull the loader
    }, 1.6],
    cylClose: [0.2, (o, s) => {
      slide(o, s, 0, 0.03, 3000, 2200, 0.2);
      hit(o, s, 0.035, 'heavy', 0.75, { pitch: 1.35 }); hit(o, s, 0.04, 'steel', 0.3); // cylinder locks into the frame
    }, 1.3],
    spin: [0.55, (o, s) => {
      let t = 0, gap = 0.016;
      for (let i = 0; i < 13; i++) { hit(o, s, t, 'steel', 0.22 - i * 0.011, { pitch: 1.5, damp: 0.5, thumpK: 0 }); t += gap; gap *= 1.12; } // ratchet winding down
    }, 2.2],
    ready: [0.15, (o, s) => {
      hit(o, s, 0, 'steel', 0.3, { pitch: 1.2 }); slide(o, s, 0.008, 0.03, 2200, 3000, 0.1, { q: 8 }); hit(o, s, 0.045, 'steel', 0.5, { pitch: 0.95 }); // hammer cocks: click-clack
    }, 1.6],
  },
  shotgun: {
    shell: [0.2, (o, s) => {
      slide(o, s, 0, 0.045, 800, 1500, 0.32, { rough: 0.45, q: 6 }); // shell pushes past the gate against the spring
      hit(o, s, 0.012, 'steel', 0.25, { pitch: 1.2, damp: 0.6 }); // loading gate flips
      hit(o, s, 0.05, 'shell', 0.6); // seats in the tube
      slide(o, s, 0.055, 0.03, 1700, 1300, 0.07, { q: 14 }); // spring settles
    }],
    pump: [0.32, (o, s) => {
      slide(o, s, 0, 0.07, 1100, 650, 0.45, { rough: 0.6 }); // forend rattles back
      hit(o, s, 0.075, 'heavy', 0.7, { pitch: 1.05 }); // "shk"
      slide(o, s, 0.11, 0.05, 700, 1200, 0.4);
      hit(o, s, 0.165, 'heavy', 1.0, { pitch: 0.9, thumpK: 1.4 }); hit(o, s, 0.172, 'steel', 0.3); // "CHK"
    }],
  },
  sniper: {
    boltUp: [0.12, (o, s) => { hit(o, s, 0, 'steel', 0.45, { pitch: 1.1 }); slide(o, s, 0.004, 0.03, 2000, 2700, 0.18); }, 1.2],
    boltBack: [0.75, (o, s) => {
      slide(o, s, 0, 0.11, 1500, 3200, 0.36, { rough: 0.35 }); // long polished steel pull
      hit(o, s, 0.115, 'steel', 0.6, { pitch: 0.9 });
      brass(o, s, 0.13, 0.18, 0.35); // the case flicks out
    }],
    magOut: [0.18, (o, s) => { hit(o, s, 0, 'steel', 0.25, { pitch: 1.3 }); slide(o, s, 0.006, 0.06, 1600, 900, 0.24); }, 2.0],
    magIn: [0.18, (o, s) => { slide(o, s, 0, 0.045, 900, 1700, 0.28); hit(o, s, 0.047, 'alu', 0.5, { pitch: 0.9 }); hit(o, s, 0.06, 'steel', 0.45); }],
    boltFwd: [0.22, (o, s) => {
      slide(o, s, 0, 0.08, 3000, 1500, 0.36, { rough: 0.4 });
      hit(o, s, 0.03, 'shell', 0.25, { pitch: 1.3 }); // strips a round off the mag
      hit(o, s, 0.085, 'heavy', 0.7, { pitch: 1.1 }); // chambered
    }],
    boltDown: [0.2, (o, s) => { hit(o, s, 0, 'heavy', 0.9, { pitch: 0.95, thumpK: 1.3 }); hit(o, s, 0.008, 'steel', 0.3); }],
  },
};

const LEVEL = 0.42; // loudest recipe (a bolt slam) renders ≈ 2.1 raw; this keeps every beat under the limiter
export const hasFoley = (gun, beat) => !!R[gun]?.[beat];
export const foleyBeats = () => Object.entries(R).flatMap(([g, b]) => Object.keys(b).map(k => [g, k]));

export function renderFoley(gun, beat, sr) {
  const r = R[gun]?.[beat];
  if (!r) return null;
  const o = new Float32Array(Math.ceil(r[0] * sr));
  r[1](o, sr);
  let peak = 0;
  const g = LEVEL * (r[2] ?? 1);
  for (let i = 0; i < o.length; i++) o[i] *= g;
  for (let i = 0; i < o.length; i++) peak = Math.max(peak, Math.abs(o[i]));
  if (peak > 0.95) for (let i = 0; i < o.length; i++) o[i] *= 0.95 / peak; // safety only; recipes set the real levels
  return o;
}
