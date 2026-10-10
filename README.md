# İsim Avcısı 🏥

Oyun ismi bulmak için Gemini destekli puanlama aracı. Ekrana bir isim gelir (her isim yapay zeka tarafından o an üretilir) →
yorumunu ve 1-5 arası puanı tek satıra yazıp Enter'a basarsın → sıradaki isim gelir. Yapay zeka, puan ve yorumlarından zevkini öğrenir.

Hem **yerelde** hem **Vercel'de** çalışır.

---

## A) Vercel'e yayınlama (adım adım)

1. **GitHub'a yükle:** Bu klasörü yeni bir GitHub deposuna at (`.gitignore` zaten `.env` ve `data/` klasörünü dışarıda bırakır).
2. **Vercel'de içe aktar:** vercel.com → *Add New… → Project* → depoyu seç → *Deploy*. (Framework: "Other" kalsın, ayar değiştirme.)
   - Alternatif: klasörde `npx vercel` yaz.
3. **Depolama ekle (geçmiş/favoriler için):** Projede **Storage** sekmesi → *Marketplace* → **Upstash for Redis** (ücretsiz plan yeter) → oluştur → projeye bağla.
   Bağlayınca `KV_REST_API_URL` ve `KV_REST_API_TOKEN` değişkenleri otomatik eklenir.
4. **Ortam değişkenlerini ekle:** *Settings → Environment Variables*:
   | Ad | Değer |
   |---|---|
   | `GEMINI_API_KEY` | Gemini anahtarın |
   | `APP_PASSWORD` | Giriş şifren (zorunlu) |
   | `GEMINI_MODEL` | (isteğe bağlı) varsayılan `gemini-flash-latest` |
5. **Yeniden deploy et:** *Deployments → son deploy → ⋯ → Redeploy*. (Değişkenler yalnızca yeni deploy'da geçerli olur.)
6. Vercel'in verdiği linki aç, şifreni gir. Bitti.

Notlar:
- Şifre girişi 30 gün hatırlanır. Şifreyi değiştirirsen herkesin oturumu düşer.
- Her isim üretimi bir Gemini çağrısıdır; fonksiyon süresi 60 sn'ye ayarlı. Vercel planın buna izin vermezse `vercel.json` içindeki `maxDuration` değerini düşür.
- Veriler Upstash Redis'te tek bir kayıt olarak tutulur (düz metin, çok az yer kaplar). **Ayarlar → Verileri indir** ile JSON yedeği alabilirsin.
- Redis bağlı değilse uygulama "Depolama bağlı değil" hatası verir; veriler kaybolmasın diye bilerek dosyaya yazmaz.

---

## B) Yerelde çalıştırma

1. **Node.js 18+** kur (https://nodejs.org → LTS). `npm install` gerekmez.
2. `.env.example` dosyasını `.env` yap, `GEMINI_API_KEY=` satırına anahtarını yaz (https://aistudio.google.com/apikey).
   Yerelde `APP_PASSWORD` boş bırakılırsa şifre sorulmaz.
3. Windows: `start.bat` · Mac/Linux: `./start.sh` (veya `node server.js`) → http://localhost:3000

Yerelde veriler `data/state.json` dosyasında tutulur.

---

## Kullanım

| Yapmak istediğin | Nasıl |
|---|---|
| Puanlayıp geç | Yorumunu yaz, puanı (1-5) başa ya da sona ekle: `havalı ama uzun 4` → **Enter** |
| Sadece puan | `3` → Enter |
| Puanla + favorile | **Shift+Enter** |
| Beğenmedim, geç | **Esc** (ya da "Atla") — atlananlar da yapay zekaya "ilgi çekmedi" diye bildirilir |
| Yıldızla puanla | Yıldızlara tıkla |

Sekmeler: **Keşfet**, **Geçmiş** (arama, sıralama, stil bazlı ortalamalar), **Favoriler**, **Ayarlar** (dil, yönlendirme, oyun bağlamı, yedek).

## Yapay zeka nasıl öğreniyor?

- Her isim ayrı bir Gemini çağrısıyla, o ana kadarki tüm puan ve yorumlara bakılarak üretilir (2-10 sn sürebilir).
- Her çağrıya 20 farklı adlandırma stratejisinden biri rastgele verilir; böylece geniş bir isim haritası taranır.
- Gönderilenler: oyun bağlamı, favoriler, beğenilen/beğenilmeyen isimler + yorumlar, atlananlar, stil ortalamaları ve daha önce gösterilen tüm isimler.
- Yorumların ne kadar açıksa o kadar iyi öğrenir: "çok uzun", "hastane hissi yok", "komik ama ucuz" gibi.

## Oyun bağlamı

`game-context.md` ilk açılışta varsayılan olarak yüklenir; sonrasında **Ayarlar → Oyun bağlamı** kutusundan düzenlersin (depolamada saklanır).
**"Hikâye / premise" bölümünü doldurmak isim kalitesini en çok artıran şeydir.**

## Dosyalar

```
lib/core.js          Ortak mantık: Gemini, prompt, depolama, şifre/oturum
server.js            Yerel sunucu
api/handler.js       Vercel fonksiyonu
vercel.json          Vercel ayarı (yönlendirme, süre)
public/              Arayüz (index.html, style.css, app.js)
game-context.md      Varsayılan oyun bağlamı
```

## Sorun giderme

- **"Depolama bağlı değil"** → Vercel'de Upstash Redis'i projeye bağla, sonra Redeploy.
- **"APP_PASSWORD ayarlanmamış"** → Vercel ortam değişkenlerine ekle, Redeploy.
- **Gemini hatası 404 / model bulunamadı** → `GEMINI_MODEL` değerini güncel bir model adıyla değiştir.
- **Gemini 429 / kota** → biraz bekle.
- **Zaman aşımı (Vercel)** → planın fonksiyon süresini aşıyor olabilir; `GEMINI_THINKING_BUDGET=0` ekleyerek hızlandırmayı dene (her modelde desteklenmeyebilir).
