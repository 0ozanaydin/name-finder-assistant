(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const norm = (s) => String(s || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  const S = { history: [], favorites: [], current: null, settings: {}, hasKey: false, model: '', queueLength: 0 };
  let busy = false;
  let lastSaved = null;

  async function api(url, method = 'GET', body) {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && data.login) { showLogin(); throw new Error(data.error || 'Giriş gerekli.'); }
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  }

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), isErr ? 5000 : 2200);
  }

  // ----- Giriş çözümleme: "yorum 4" ya da "4 yorum" -----
  function parseInput(text) {
    let t = text.trim().replace(/\s*(\/\s*5|⭐|★|yıldız)\s*$/i, '');
    let m = t.match(/(?:^|\s)([1-5])$/);
    if (m) return { rating: Number(m[1]), comment: t.slice(0, m.index).trim() };
    m = t.match(/^([1-5])(?:\s+|$)/);
    if (m) return { rating: Number(m[1]), comment: t.slice(m[0].length).trim() };
    return { rating: 0, comment: t };
  }

  function isFav(name) { return S.favorites.some((f) => norm(f.name) === norm(name)); }

  // ----- Keşfet -----
  function renderStars(n) {
    const box = $('#stars');
    box.textContent = '';
    for (let i = 1; i <= 5; i++) {
      box.append(h('span', { class: i <= n ? 'on' : '', 'data-n': i }, '★'));
    }
  }

  function renderCard(state = {}) {
    const card = $('#card');
    card.classList.toggle('loading', !!state.loading);
    const c = S.current;
    $('#name').textContent = state.loading ? 'Yeni isim getiriliyor…' : (c ? c.name : '—');
    $('#style').textContent = c && !state.loading ? c.style : '';
    $('#note').textContent = c && !state.loading ? c.note : '';
    $('#queueInfo').textContent = S.queueLength ? `Sırada ${S.queueLength} isim hazır` : '';
    const err = $('#cardError');
    err.textContent = '';
    err.classList.toggle('hidden', !state.error);
    if (state.error) {
      err.append(state.error, h('button', { type: 'button', onclick: () => loadNext() }, 'Tekrar dene'));
    }
    renderStars(parseInput($('#input').value).rating);
    const fav = c && isFav(c.name);
    $('#favBtn').textContent = fav ? '♥ Favoride' : '♡ Favori';
    $('#favBtn').classList.toggle('on', !!fav);
  }

  function renderLast() {
    const box = $('#last');
    if (!lastSaved) return box.classList.add('hidden');
    box.classList.remove('hidden');
    box.textContent = '';
    box.append('Son kaydedilen: ', h('b', {}, lastSaved.name), ` — ${stars(lastSaved.rating)}`, lastSaved.comment ? ` — "${lastSaved.comment}"` : '');
  }

  async function loadNext() {
    S.current = null;
    renderCard({ loading: true });
    try {
      const r = await api('/api/next', 'POST');
      S.current = r.current;
      S.queueLength = r.queueLength;
      renderCard();
      $('#input').focus();
    } catch (e) {
      renderCard({ error: e.message });
    }
  }

  async function submit(withFav) {
    if (!S.current || busy) return;
    const { rating, comment } = parseInput($('#input').value);
    if (!rating) {
      const inp = $('#input');
      inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
      toast('1-5 arası bir puan yazmalısın (örn: "havalı 4").', true);
      return;
    }
    busy = true;
    try {
      const c = S.current;
      const r = await api('/api/rate', 'POST', { name: c.name, style: c.style, note: c.note, rating, comment, favorite: !!withFav });
      S.history.push(r.entry);
      S.favorites = r.favorites;
      lastSaved = r.entry;
      $('#input').value = '';
      renderLast(); renderCounts();
      await loadNext();
    } catch (e) { toast(e.message, true); }
    finally { busy = false; }
  }

  async function skip() {
    if (!S.current || busy) return;
    busy = true;
    try {
      const c = S.current;
      const r = await api('/api/skip', 'POST', { name: c.name, style: c.style, note: c.note });
      S.history.push(r.entry);
      $('#input').value = '';
      renderCounts();
      await loadNext();
    } catch (e) { toast(e.message, true); }
    finally { busy = false; }
  }

  async function toggleFav(item) {
    try {
      const r = await api('/api/favorite', 'POST', { name: item.name, style: item.style, note: item.note });
      S.favorites = r.favorites;
      renderCounts(); renderCard(S.current ? {} : {}); renderHistory(); renderFavs();
    } catch (e) { toast(e.message, true); }
  }

  // ----- Geçmiş -----
  function renderStats() {
    const map = {};
    for (const x of S.history) if (x.rating && x.style) (map[x.style] ||= []).push(x.rating);
    const rows = Object.entries(map).map(([s, r]) => ({ s, avg: r.reduce((a, b) => a + b, 0) / r.length, n: r.length })).sort((a, b) => b.avg - a.avg);
    const box = $('#styleStats');
    box.textContent = '';
    for (const r of rows.slice(0, 10)) {
      box.append(h('div', { class: 'stat' }, h('span', {}, r.s), h('div', { class: 'bar' }, h('i', { style: `width:${(r.avg / 5) * 100}%` })), h('span', {}, `${r.avg.toFixed(1)}★ · ${r.n}`)));
    }
  }

  function itemRow(x, withDelete) {
    const date = new Date(x.ts).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return h('div', { class: 'item' },
      h('div', { class: 't' }, x.name),
      h('div', { class: 's' }, x.rating ? stars(x.rating) : (x.skipped ? 'atlandı' : '')),
      x.comment ? h('div', { class: 'c' }, x.comment) : null,
      h('div', { class: 'm' }, x.style ? h('span', { class: 'chip' }, x.style) : null, date),
      h('div', { class: 'btns' },
        h('button', { class: 'fav' + (isFav(x.name) ? ' on' : ''), type: 'button', title: 'Favori', onclick: () => toggleFav(x) }, isFav(x.name) ? '♥' : '♡'),
        withDelete ? h('button', { type: 'button', title: 'Sil', onclick: () => delHistory(x.id) }, '✕') : null));
  }

  function renderHistory() {
    renderStats();
    const q = norm($('#histSearch').value);
    const sort = $('#histSort').value;
    const hide = $('#histHideSkipped').checked;
    let rows = S.history.filter((x) => !(hide && x.skipped));
    if (q) rows = rows.filter((x) => norm(x.name).includes(q) || norm(x.comment).includes(q));
    rows = [...rows].sort((a, b) => sort === 'high' ? (b.rating || 0) - (a.rating || 0) : sort === 'low' ? (a.rating || 9) - (b.rating || 9) : b.ts - a.ts);
    const box = $('#histList');
    box.textContent = '';
    if (!rows.length) return box.append(h('div', { class: 'empty' }, 'Henüz kayıt yok.'));
    rows.forEach((x) => box.append(itemRow(x, true)));
  }

  async function delHistory(id) {
    try {
      await api('/api/history/' + encodeURIComponent(id), 'DELETE');
      S.history = S.history.filter((x) => x.id !== id);
      renderCounts(); renderHistory();
    } catch (e) { toast(e.message, true); }
  }

  // ----- Favoriler -----
  function renderFavs() {
    const box = $('#favList');
    box.textContent = '';
    if (!S.favorites.length) return box.append(h('div', { class: 'empty' }, 'Henüz favori yok. Keşfet sekmesinde ♡ Favori\'ye bas ya da Shift+Enter ile kaydet.'));
    [...S.favorites].sort((a, b) => b.ts - a.ts).forEach((f) => {
      const last = [...S.history].reverse().find((x) => norm(x.name) === norm(f.name) && x.rating);
      box.append(itemRow({ ...f, rating: last?.rating || 0, comment: last?.comment || '', skipped: false }, false));
    });
  }

  function renderCounts() {
    $('#cntHistory').textContent = S.history.filter((x) => !x.skipped).length;
    $('#cntFavs').textContent = S.favorites.length;
  }

  // ----- Ayarlar -----
  async function renderSettings() {
    $('#setLang').value = S.settings.language || 'mix';
    $('#setDir').value = S.settings.direction || '';
    $('#sysInfo').textContent = `Model: ${S.model} · API anahtarı: ${S.hasKey ? 'var ✔' : 'YOK ✖'} · Toplam kayıt: ${S.history.length}`;
    try { $('#setCtx').value = (await api('/api/context')).text; } catch (e) { toast(e.message, true); }
  }

  // ----- Sekmeler -----
  function switchTab(name) {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + name));
    if (name === 'history') renderHistory();
    if (name === 'favs') renderFavs();
    if (name === 'settings') renderSettings();
    if (name === 'discover') $('#input').focus();
  }

  // ----- Olaylar -----
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
  $('#form').addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); submit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); skip(); }
  });
  $('#input').addEventListener('input', () => renderStars(parseInput($('#input').value).rating));
  $('#stars').addEventListener('click', (e) => {
    const n = e.target.dataset?.n;
    if (!n) return;
    const { comment } = parseInput($('#input').value);
    $('#input').value = (comment ? comment + ' ' : '') + n;
    renderStars(Number(n));
    $('#input').focus();
  });
  $('#favBtn').addEventListener('click', () => { if (S.current) toggleFav(S.current); $('#input').focus(); });
  $('#skipBtn').addEventListener('click', skip);
  ['histSearch', 'histSort', 'histHideSkipped'].forEach((id) => $('#' + id).addEventListener('input', renderHistory));
  $('#copyFavs').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(S.favorites.map((f) => f.name).join('\n')); toast('Favoriler panoya kopyalandı.'); }
    catch { toast('Kopyalanamadı.', true); }
  });
  $('#saveSettings').addEventListener('click', async () => {
    try {
      const r = await api('/api/settings', 'PUT', { language: $('#setLang').value, direction: $('#setDir').value });
      S.settings = r.settings; S.queueLength = 0;
      toast('Ayarlar kaydedildi.');
      switchTab('discover');
      if (S.current) { /* mevcut isim kalsın */ } else loadNext();
    } catch (e) { toast(e.message, true); }
  });
  $('#saveCtx').addEventListener('click', async () => {
    try { await api('/api/context', 'PUT', { text: $('#setCtx').value }); S.queueLength = 0; toast('Bağlam kaydedildi; sonraki öneriler bunu kullanacak.'); }
    catch (e) { toast(e.message, true); }
  });

  // ----- Giriş / yedek -----
  function showLogin(msg) {
    $('#login').classList.remove('hidden');
    const err = $('#loginErr');
    err.textContent = msg || '';
    err.classList.toggle('hidden', !msg);
    setTimeout(() => $('#pw').focus(), 50);
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', 'POST', { password: $('#pw').value });
      $('#pw').value = '';
      $('#login').classList.add('hidden');
      $('#logoutBtn').classList.remove('hidden');
      boot();
    } catch (err) { showLogin(err.message); }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/logout', 'POST'); } catch { /* yoksay */ }
    location.reload();
  });
  $('#exportBtn').addEventListener('click', async () => {
    try {
      const data = await api('/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `isim-avcisi-yedek-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
    } catch (err) { toast(err.message, true); }
  });

  // ----- Başlangıç -----
  async function init() {
    renderStars(0);
    let sess;
    try { sess = await api('/api/session'); }
    catch (e) { return renderCard({ error: 'Sunucuya ulaşılamadı: ' + e.message }); }
    if (sess.misconfigured) return showLogin('Sunucuda APP_PASSWORD ayarlanmamış (Vercel → Settings → Environment Variables).');
    $('#logoutBtn').classList.toggle('hidden', !sess.authRequired);
    if (sess.authRequired && !sess.authed) return showLogin();
    boot();
  }

  async function boot() {
    try {
      Object.assign(S, await api('/api/state'));
    } catch (e) { return renderCard({ error: 'Sunucuya ulaşılamadı: ' + e.message }); }
    renderCounts();
    const b = $('#banner');
    if (!S.hasKey) {
      b.textContent = 'GEMINI_API_KEY bulunamadı. .env dosyasına anahtarını yaz ve sunucuyu yeniden başlat.';
      b.classList.remove('hidden');
    }
    const lastRated = [...S.history].reverse().find((x) => x.rating);
    if (lastRated) { lastSaved = lastRated; renderLast(); }
    if (S.current) renderCard(); else loadNext();
  }

  init();
})();
