'use strict';
/**
 * İsim Avcısı — yerel sunucu (bağımlılık yok, Node 18+).
 * Asıl mantık lib/core.js içinde; Vercel'de api/handler.js aynı çekirdeği kullanır.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// .env dosyasını çekirdek yüklenmeden önce oku
try {
  const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env yoksa sorun değil */ }

const core = require('./lib/core');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new Error('İstek çok büyük')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Geçersiz JSON')); } });
    req.on('error', reject);
  });
}

function send(res, out) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (out.cookies && out.cookies.length) headers['Set-Cookie'] = out.cookies;
  res.writeHead(out.status, headers);
  res.end(JSON.stringify(out.json));
}

function serveStatic(res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Yasak'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Bulunamadı'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      send(res, await core.handle({ method: req.method, pathname: url.pathname, body, cookieHeader: req.headers.cookie || '', secure: false }));
    } else serveStatic(res, url);
  } catch (e) {
    console.error(e.message);
    if (!res.headersSent) send(res, { status: 500, json: { error: e.message } });
  }
}).listen(PORT, HOST, () => {
  console.log(`\n  İsim Avcısı hazır → http://localhost:${PORT}`);
  console.log(`  Model: ${process.env.GEMINI_MODEL || 'gemini-flash-latest'} | API anahtarı: ${process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith('BURAYA') ? 'var' : 'YOK (.env dosyasına GEMINI_API_KEY yaz)'} | Şifre: ${process.env.APP_PASSWORD ? 'açık' : 'kapalı (yerel kullanım)'}\n`);
});
