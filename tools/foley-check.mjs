// Render each gun's full reload offline: WAV (listen) + spectrogram/waveform PNG (look) + per-beat peaks.
// usage: node tools/foley-check.mjs [outDir]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { renderFoley } from '../src/foley.js';
import { WEAPONS } from '../src/config.js';

const SR = 48000, out = process.argv[2] || 'shots/foley';
fs.mkdirSync(out, { recursive: true });

function wav(path, x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path, b);
}
function png(path, w, h, rgb) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = buf => { let c = -1; for (const v of buf) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const c = Math.cos(a * k), s = Math.sin(a * k), xr = re[i + k + len / 2], xi = im[i + k + len / 2];
      const tr = xr * c - xi * s, ti = xr * s + xi * c;
      re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti; re[i + k] += tr; im[i + k] += ti;
    }
  }
}
const heat = v => { v = Math.max(0, Math.min(1, v)); return [Math.min(255, v * 3 * 255), Math.max(0, Math.min(255, (v * 3 - 1) * 255)), Math.max(0, Math.min(255, (v * 3 - 2) * 255))]; };

for (const w of WEAPONS) {
  const dur = w.reload + 0.9, x = new Float32Array(Math.ceil(dur * SR)), peaks = [];
  for (const [p, beat] of [...w.reloadSeq, [1, 'ready']]) {
    const b = renderFoley(w.id, beat, SR);
    if (!b) continue;
    const n0 = Math.floor(p * w.reload * SR);
    let pk = 0;
    for (let i = 0; i < b.length && n0 + i < x.length; i++) { x[n0 + i] += b[i]; pk = Math.max(pk, Math.abs(b[i])); }
    peaks.push(`${beat} ${(20 * Math.log10(pk)).toFixed(1)}dB`);
  }
  wav(`${out}/reload-${w.id}.wav`, x);
  // image: waveform strip (60px) over a log-frequency spectrogram (100 Hz – 16 kHz)
  const N = 1024, hop = 96, cols = Math.floor((x.length - N) / hop), rows = 220, H = rows + 60;
  const img = Buffer.alloc(cols * H * 3);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  for (let c = 0; c < cols; c++) {
    let mx = 0; for (let i = 0; i < hop; i++) mx = Math.max(mx, Math.abs(x[c * hop + i]));
    const hpx = Math.round(mx * 29);
    for (let y = 30 - hpx; y <= 30 + hpx; y++) { const o = (y * cols + c) * 3; img[o] = 120; img[o + 1] = 220; img[o + 2] = 255; }
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[c * hop + i] * win[i];
    fft(re, im);
    for (let r = 0; r < rows; r++) {
      const f = 100 * Math.pow(160, 1 - r / rows), bin = Math.round(f / SR * N);
      const db = 10 * Math.log10(re[bin] ** 2 + im[bin] ** 2 + 1e-12);
      const [R, G, B] = heat((db + 40) / 70), o = ((r + 60) * cols + c) * 3;
      img[o] = R; img[o + 1] = G; img[o + 2] = B;
    }
  }
  png(`${out}/reload-${w.id}.png`, cols, H, img);
  console.log(w.id.padEnd(9), `${dur.toFixed(2)}s`, peaks.join(' · '));
}
