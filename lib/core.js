'use strict';
/**
 * İsim Avcısı çekirdeği — hem yerel sunucu (server.js) hem Vercel (api/handler.js) kullanır.
 *  - Depolama: Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN) varsa orada, yoksa data/state.json
 *  - Şifre: APP_PASSWORD varsa giriş zorunlu (Vercel'de zorunlu)
 *  - Her isim ayrı bir Gemini çağrısıyla, güncel geri bildirime bakılarak üretilir
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'state.json');
const CONTEXT_FILE = path.join(ROOT, 'game-context.md');
const STATE_KEY = 'isim-avcisi:state';
const IS_VERCEL = !!process.env.VERCEL;

const env = () => process.env;
const model = () => env().GEMINI_MODEL || 'gemini-flash-latest';
const apiBase = () => env().GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const redisUrl = () => env().KV_REST_API_URL || env().UPSTASH_REDIS_REST_URL;
const redisToken = () => env().KV_REST_API_TOKEN || env().UPSTASH_REDIS_REST_TOKEN;
const hasKey = () => { const k = env().GEMINI_API_KEY || ''; return k.length > 8 && !k.startsWith('BURAYA'); };

// ---------- Depolama ----------
async function redis(cmd) {
  const r = await fetch(redisUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`Depolama (Redis) hatası: ${d.error || r.status}`);
  return d.result;
}

const DEFAULT_STATE = {
  history: [],     // {id, name, style, note, rating|null, comment, skipped, ts}
  favorites: [],   // {name, style, note, ts}
  current: null,
  settings: { language: 'mix', direction: '' },
  context: '',
};

function defaultContext() {
  try { return fs.readFileSync(CONTEXT_FILE, 'utf8'); } catch { return ''; }
}

async function loadState() {
  let raw = null;
  if (redisUrl() && redisToken()) raw = await redis(['GET', STATE_KEY]);
  else if (IS_VERCEL) throw new Error('Depolama bağlı değil. Vercel → Storage bölümünden Upstash Redis ekleyip projeye bağla, sonra yeniden deploy et.');
  else { try { raw = fs.readFileSync(DATA_FILE, 'utf8'); } catch { /* ilk çalıştırma */ } }
  let s = {};
  if (raw) { try { s = JSON.parse(raw); } catch { /* bozuk dosya */ } }
  const st = { ...structuredClone(DEFAULT_STATE), ...s, settings: { ...DEFAULT_STATE.settings, ...(s.settings || {}) } };
  if (!st.context) st.context = defaultContext();
  return st;
}

async function saveState(st) {
  const raw = JSON.stringify(st);
  if (redisUrl() && redisToken()) { await redis(['SET', STATE_KEY, raw]); return; }
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const norm = (s) => String(s || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Şifre / oturum ----------
const authRequired = () => !!env().APP_PASSWORD || IS_VERCEL;
const misconfigured = () => IS_VERCEL && !env().APP_PASSWORD;
const secret = () => env().SESSION_SECRET || env().APP_PASSWORD || '';
const sign = (exp) => crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');

function makeToken() { const exp = Date.now() + 30 * 864e5; return `${exp}.${sign(exp)}`; }
function validToken(t) {
  const [exp, sig] = String(t || '').split('.');
  if (!exp || !sig || !secret() || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function parseCookies(h) {
  const out = {};
  String(h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function passwordOk(input) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(String(env().APP_PASSWORD || '')).digest();
  return crypto.timingSafeEqual(a, b);
}
const cookieStr = (val, maxAge, secure) => `ia_session=${val}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

// ---------- Prompt ----------
const ANGLES = [
  'Kısa ve vurucu tek kelimelik, akılda kalıcı isimler',
  'Kelime oyunu / ikilem: hastane terimi + oyun mekaniği',
  'Absürt ve komik, kahkaha attıran isimler',
  'Karanlık, tekinsiz, hastane-korku tonlu isimler',
  'Co-op arkadaşlığı ve "birlikte rezil olma" hissi veren isimler',
  'Sinematik, film adı gibi dramatik isimler',
  'Tıbbi terim / Latince kökenli yaratıcı çarpıtmalar',
  'Uzun, slogan veya cümle gibi isimler (örn. bir uyarı ya da emir cümlesi)',
  'Acil servis, ambulans, sedye, ameliyat, nöbet gibi hastane jargonundan türeyen isimler',
  'Türkçe, esprili ve yerel isimler',
  'Steam\'de arama dostu, pazarlanabilir, İngilizce isimler',
  'Sevimli / cartoon / aile dostu tonlu isimler',
  'Fiziğin ve ragdoll sakarlığının (düşmek, devrilmek, sallanmak) öne çıktığı isimler',
  'Ağır yük taşıma, hasta/sedye nakli ve teslimat-lojistik temalı isimler',
  'İsim: Alt Başlık biçiminde, dizi/film afişi tadında isimler',
  'Soyut, atmosferik, şiirsel kısa isimler',
  'Sıra dışı birleşik kelimeler (portmanteau)',
  'Ofis / bürokrasi / vardiya esprisi içeren isimler',
  'Meslek ve unvan temalı isimler (hademe, başhekim, sedyeci...)',
  'Ters köşe: hastaneyle alakasız görünüp sonra mantıklı gelen isimler',
];

function pickAngle(lang) {
  const a = ANGLES.filter((x) => !(lang === 'tr' && /İngilizce/.test(x)) && !(lang === 'en' && /Türkçe/.test(x)));
  return a[Math.floor(Math.random() * a.length)];
}

const fmt = (h) => `- "${h.name}" (${h.rating}★)${h.comment ? ` — yorum: "${h.comment}"` : ''}`;
const newest = (arr, n) => [...arr].sort((a, b) => b.ts - a.ts).slice(0, n);

function styleStats(st) {
  const map = {};
  for (const h of st.history) { if (!h.rating || !h.style) continue; (map[h.style] ||= []).push(h.rating); }
  return Object.entries(map).filter(([, r]) => r.length >= 2)
    .map(([s, r]) => ({ s, avg: r.reduce((a, b) => a + b, 0) / r.length, n: r.length }))
    .sort((a, b) => b.avg - a.avg);
}

function seenNames(st) {
  const names = [...st.history, ...st.favorites].map((x) => x.name);
  if (st.current) names.push(st.current.name);
  return names;
}

function buildPrompt(st) {
  const ctx = String(st.context || '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const system =
`Sen deneyimli bir oyun adlandırma uzmanı ve yaratıcı yazarsın. Görevin, aşağıda anlatılan oyun için akılda kalıcı, özgün ve Steam'de öne çıkabilecek isim önerileri üretmek.

=== OYUN HAKKINDA BİLGİLER ===
${ctx || '(Bağlam boş.)'}
=== BİLGİLERİN SONU ===

Kurallar:
- Her isim oyunun temasına, mekaniğine ve tonuna bağlanabilmeli; sadece havalı durması yetmez.
- İsimler genelde 1-5 kelime olsun (nadiren daha uzun olabilir). Telaffuzu ve yazımı kolay olsun.
- Bilinen oyun, film, marka adlarını birebir kopyalama; var olan bir oyunla karışacak isimlerden kaçın.
- "style" alanı: ismin stratejisini anlatan 1-3 kelimelik KISA Türkçe etiket (örn. "Absürt komedi", "Kelime oyunu", "Tek kelime").
- "note" alanı: neden iyi olabileceğini veya espriyi anlatan tek kısa Türkçe cümle (en fazla 15 kelime).
- Yalnızca istenen JSON dizisini döndür.`;

  const rated = st.history.filter((h) => h.rating);
  const loved = newest(rated.filter((h) => h.rating >= 4), 30);
  const meh = newest(rated.filter((h) => h.rating === 3), 12);
  const disliked = newest(rated.filter((h) => h.rating <= 2), 30);
  const skipped = newest(st.history.filter((h) => h.skipped), 25);
  const favs = newest(st.favorites, 40);
  const stats = styleStats(st);
  const language = st.settings.language;
  const lang = { mix: 'Türkçe ve İngilizce isimleri karışık sun (yaklaşık yarı yarıya).', tr: 'Yalnızca Türkçe isim üret.', en: 'Yalnızca İngilizce isim üret.' }[language] || '';

  const parts = [];
  parts.push(`TEK bir yeni isim önerisi üret (dizide yalnızca 1 eleman). ${lang}`);
  parts.push(`Bu isim için ilham stratejisi (zevke uyuyorsa uygula, uymuyorsa yoruma göre esnet): ${pickAngle(language)}`);
  if (String(st.settings.direction || '').trim()) parts.push(`Kullanıcının özel yönlendirmesi (öncelikli): ${st.settings.direction.trim()}`);

  if (!rated.length && !favs.length) {
    parts.push('Henüz kullanıcı geri bildirimi yok. Geniş bir yelpazeden, cesur bir isim seç.');
  } else {
    parts.push('Kullanıcının zevkini aşağıdaki geri bildirimlerden öğren. Yorumları dikkatle oku: ne beğendiğini ve neden beğenmediğini çıkar. Çoğunlukla beğenilenlerin ruhuna yakın ama kopyası olmayan bir isim üret; ara sıra yeni bir yön dene.');
    if (favs.length) parts.push(`FAVORİLER:\n${favs.map((f) => `- "${f.name}"`).join('\n')}`);
    if (loved.length) parts.push(`ÇOK BEĞENİLENLER (4-5★):\n${loved.map(fmt).join('\n')}`);
    if (meh.length) parts.push(`ORTA (3★):\n${meh.map(fmt).join('\n')}`);
    if (disliked.length) parts.push(`BEĞENİLMEYENLER (1-2★) — bu tarzdan uzak dur:\n${disliked.map(fmt).join('\n')}`);
    if (skipped.length) parts.push(`ATLANANLAR (ilgisini çekmedi):\n${skipped.map((h) => `- "${h.name}"`).join('\n')}`);
    if (stats.length) parts.push(`STİL ORTALAMALARI:\n${stats.map((x) => `- ${x.s}: ${x.avg.toFixed(1)}★ (${x.n} isim)`).join('\n')}`);
  }
  const seen = seenNames(st);
  if (seen.length) parts.push(`DAHA ÖNCE GÖSTERİLEN İSİMLER (bunları ve çok benzerlerini TEKRAR ETME):\n${seen.slice(-400).join(' | ')}`);
  return { system, user: parts.join('\n\n') };
}

// ---------- Gemini ----------
function parseNames(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let data;
  try { data = JSON.parse(t); } catch {
    const m = t.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Gemini yanıtı JSON olarak okunamadı.');
    data = JSON.parse(m[0]);
  }
  if (!Array.isArray(data)) {
    const arr = Object.values(data).find(Array.isArray);
    if (!arr) throw new Error('Gemini yanıtında isim listesi yok.');
    data = arr;
  }
  return data;
}

async function callGeminiOnce(system, user, modelName, timeoutMs) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 1.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, style: { type: 'STRING' }, note: { type: 'STRING' } }, required: ['name', 'style'] },
      },
    },
  };
  const tb = env().GEMINI_THINKING_BUDGET;
  if (tb !== undefined && tb !== '') body.generationConfig.thinkingConfig = { thinkingBudget: Number(tb) };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${apiBase()}/models/${modelName}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env().GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'Gemini zamanında yanıt vermedi.' : `Gemini'ye ulaşılamadı: ${e.message}`);
    err.retryable = true;
    throw err;
  } finally { clearTimeout(timer); }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gemini hatası (${res.status}): ${data?.error?.message || res.statusText}`);
    err.quota = res.status === 429;
    err.retryable = [500, 502, 503, 504].includes(res.status);
    throw err;
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) {
    const err = new Error(`Gemini boş yanıt döndürdü${data?.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ''}.`);
    err.retryable = true;
    throw err;
  }
  return parseNames(text);
}

// Kota (429) dolan ya da bulunamayan modeller bir süre kenara alınır.
const cooldown = new Map(); // modelAdı -> bitişZamanı

// Geçici hatalarda (503, zaman aşımı) bekleyip tekrar dener; kota dolunca / model yoksa sıradaki modele geçer.
async function callGemini(system, user) {
  const started = Date.now();
  const budget = IS_VERCEL ? 52000 : 150000; // Vercel fonksiyon süresi 60 sn
  const extra = (env().GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash').split(',').map((x) => x.trim());
  const models = [model(), ...extra, 'gemini-2.5-flash-lite'].filter((m, i, arr) => m && arr.indexOf(m) === i);
  let lastErr;
  for (let attempt = 0; attempt < models.length * 2; attempt++) {
    const left = budget - (Date.now() - started);
    if (left < 4000) break;
    const now = Date.now();
    const m = models.find((x) => (cooldown.get(x) || 0) < now);
    if (!m) break; // hepsi dinleniyor
    try {
      return await callGeminiOnce(system, user, m, Math.min(left, IS_VERCEL ? 25000 : 90000));
    } catch (e) {
      lastErr = e;
      if (e.quota) { cooldown.set(m, Date.now() + 10 * 60 * 1000); continue; } // beklemeden sıradaki modele
      if (!e.retryable) {
        if (m === models[0]) throw e;               // asıl modelde kalıcı hata: göster
        cooldown.set(m, Date.now() + 10 * 60 * 1000); // yedek model sorunluysa atla
        continue;
      }
      await sleep(Math.min(1200 * (attempt + 1), 4000));
    }
  }
  if (lastErr && lastErr.quota) {
    throw new Error(`Tüm Gemini modellerinin ücretsiz günlük kotası dolmuş (${models.join(', ')}). Daha sonra tekrar dene ya da Google AI Studio'da faturalandırmayı aç. Son hata: ${lastErr.message}`);
  }
  throw lastErr || new Error('Gemini yanıt vermedi, tekrar dene.');
}

async function generateName(st) {
  if (!hasKey()) throw new Error('GEMINI_API_KEY bulunamadı. Ortam değişkenlerine / .env dosyasına ekle.');
  const seen = new Set(seenNames(st).map(norm));
  for (let attempt = 0; attempt < 3; attempt++) {
    const { system, user } = buildPrompt(st);
    const raw = await callGemini(system, user);
    for (const n of raw) {
      const name = String(n?.name || '').trim().replace(/^["“”]+|["“”]+$/g, '');
      if (!name || name.length > 80 || seen.has(norm(name))) continue;
      return { name, style: String(n.style || '').trim().slice(0, 30), note: String(n.note || '').trim().slice(0, 160) };
    }
  }
  throw new Error('Model yeni bir isim üretemedi, tekrar dene.');
}

// ---------- API ----------
const publicState = (st) => ({
  history: st.history, favorites: st.favorites, current: st.current, settings: st.settings,
  hasKey: hasKey(), model: model(), queueLength: 0,
});
const ok = (json, cookies) => ({ status: 200, json, cookies });
const fail = (status, error, extra = {}) => ({ status, json: { error, ...extra } });

/** Ortak istek işleyici. Dönüş: {status, json, cookies?} */
async function handle({ method, pathname, body = {}, cookieHeader = '', secure = false }) {
  const route = `${method} ${pathname}`;
  const authed = !authRequired() || validToken(parseCookies(cookieHeader).ia_session);

  if (route === 'GET /api/session') return ok({ authRequired: authRequired(), authed, misconfigured: misconfigured() });

  if (route === 'POST /api/login') {
    if (misconfigured()) return fail(500, 'Sunucuda APP_PASSWORD ayarlanmamış. Vercel → Settings → Environment Variables bölümüne ekle.');
    if (!authRequired()) return ok({ ok: true });
    if (!passwordOk(body.password)) { await sleep(700); return fail(401, 'Şifre yanlış.'); }
    return ok({ ok: true }, [cookieStr(makeToken(), 30 * 86400, secure)]);
  }
  if (route === 'POST /api/logout') return ok({ ok: true }, [cookieStr('', 0, secure)]);

  if (misconfigured()) return fail(500, 'Sunucuda APP_PASSWORD ayarlanmamış.');
  if (!authed) return fail(401, 'Giriş gerekli.', { login: true });

  const st = await loadState();

  if (route === 'GET /api/state') return ok(publicState(st));
  if (route === 'GET /api/context') return ok({ text: st.context });
  if (route === 'GET /api/export') return ok({ exportedAt: new Date().toISOString(), history: st.history, favorites: st.favorites, settings: st.settings, context: st.context });

  if (route === 'POST /api/next') {
    st.current = await generateName(st);
    await saveState(st);
    return ok({ current: st.current, queueLength: 0 });
  }

  if (route === 'POST /api/rate') {
    const rating = Number(body.rating);
    if (!body.name || !Number.isInteger(rating) || rating < 1 || rating > 5) return fail(400, 'İsim ve 1-5 arası puan gerekli.');
    const entry = { id: uid(), name: String(body.name), style: String(body.style || ''), note: String(body.note || ''), rating, comment: String(body.comment || '').trim().slice(0, 1000), skipped: false, ts: Date.now() };
    st.history.push(entry);
    if (body.favorite && !st.favorites.some((f) => norm(f.name) === norm(entry.name))) st.favorites.push({ name: entry.name, style: entry.style, note: entry.note, ts: Date.now() });
    if (st.current && norm(st.current.name) === norm(entry.name)) st.current = null;
    await saveState(st);
    return ok({ entry, favorites: st.favorites });
  }

  if (route === 'POST /api/skip') {
    if (!body.name) return fail(400, 'İsim gerekli.');
    const entry = { id: uid(), name: String(body.name), style: String(body.style || ''), note: String(body.note || ''), rating: null, comment: '', skipped: true, ts: Date.now() };
    st.history.push(entry);
    if (st.current && norm(st.current.name) === norm(entry.name)) st.current = null;
    await saveState(st);
    return ok({ entry });
  }

  if (route === 'POST /api/favorite') {
    if (!body.name) return fail(400, 'İsim gerekli.');
    const i = st.favorites.findIndex((f) => norm(f.name) === norm(body.name));
    let favorited;
    if (i >= 0) { st.favorites.splice(i, 1); favorited = false; }
    else { st.favorites.push({ name: String(body.name), style: String(body.style || ''), note: String(body.note || ''), ts: Date.now() }); favorited = true; }
    await saveState(st);
    return ok({ favorited, favorites: st.favorites });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/history/')) {
    const id = decodeURIComponent(pathname.slice('/api/history/'.length));
    st.history = st.history.filter((h) => h.id !== id);
    await saveState(st);
    return ok({ ok: true });
  }

  if (route === 'PUT /api/settings') {
    st.settings.language = ['mix', 'tr', 'en'].includes(body.language) ? body.language : 'mix';
    st.settings.direction = String(body.direction || '').slice(0, 500);
    await saveState(st);
    return ok({ settings: st.settings });
  }

  if (route === 'PUT /api/context') {
    st.context = String(body.text || '').slice(0, 20000);
    await saveState(st);
    return ok({ ok: true });
  }

  return fail(404, 'Bulunamadı');
}

module.exports = { handle };