'use strict';
// Vercel sunucusuz fonksiyonu: tüm /api/* istekleri vercel.json ile buraya yönlendirilir.
const core = require('../lib/core');

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.searchParams.get('p');
    const pathname = p !== null ? '/api/' + p.replace(/^\/+/, '') : url.pathname;
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const out = await core.handle({
      method: req.method,
      pathname,
      body: body && typeof body === 'object' ? body : {},
      cookieHeader: req.headers.cookie || '',
      secure: true,
    });
    res.statusCode = out.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (out.cookies && out.cookies.length) res.setHeader('Set-Cookie', out.cookies);
    res.end(JSON.stringify(out.json));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: e.message }));
  }
};
