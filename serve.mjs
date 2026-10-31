// Tiny static server. Binds to all interfaces so a phone on the same Wi-Fi can open it.
//   node serve.mjs            -> http://localhost:8000 + LAN URLs printed below
import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT) || 8000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
};
const root = import.meta.dirname;

const seen = new Set();
http.createServer(async (req, res) => {
  // log remote devices so "can't connect from my phone" can be told apart from "connected but broken"
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip !== '127.0.0.1' && ip !== '::1' && (!seen.has(ip) || req.url === '/')) { seen.add(ip); console.log(`[${new Date().toLocaleTimeString()}] ${ip} ${req.method} ${req.url}`); }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^([/\\]|\.\.)+/, '');
  try {
    const data = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`dust rail prototype on http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) console.log(`  phone (same network): http://${a.address}:${PORT}`);
  }
  console.log('  phone requests are logged below; if nothing appears when the phone loads the page, the request is blocked before it reaches node');
});
