# 📡 HOMAK CAST — Kablosuz Ekran Yansıtma

> **EN:** HOMAK CAST is a wireless screen-mirroring system: a Windows receiver (Electron + built-in signaling server), a zero-install web sender for iPhone / Android / PC browsers, and an Android app. Pairing is done with a one-time 6-digit code or QR, video and audio travel over WebRTC, and one stream can be mirrored to every monitor of the receiver PC. The whole project was built with AI-assisted "vibe coding" ([Claude Code](https://claude.com/claude-code)).

**HOMAK CAST**; Windows 10/11 üzerinde çalışan alıcı (Receiver), tarayıcıdan çalışan web göndericisi (Sender) ve Android uygulamasından oluşur. Telefon, tablet veya bilgisayarın ekranını/kamerasını harici ekrana, monitöre ya da HDMI projektöre kablosuz aktarır.

🎬 **Tanıtım videosu:** [`promo/homak-cast-tanitim.mp4`](promo/homak-cast-tanitim.mp4)

---

## ✨ Özellikler

| | |
|---|---|
| 🔢 **Kodla eşleştirme** | 6 haneli tek kullanımlık kod + QR. Eşleşince kod geçersiz olur, yayın kesilince yenisi üretilir. |
| 🌐 **Kurulumsuz gönderici** | iPhone, Android veya PC tarayıcısından ekran ve kamera paylaşımı. Uygulama gerekmez. |
| 📱 **Android uygulaması** | Arka planda da kesintisiz ekran yayını (`android/`). |
| ⚡ **Düşük gecikme** | WebRTC, 60 FPS, ses dahil; ağ dışı bağlantılar için STUN/TURN. |
| 🪞 **Ayna modu** | Tek yayın, receiver PC'ye bağlı tüm monitör ve projektörlerde tam ekran. |
| 🖥️ **Çoklu monitör** | Yayının hangi ekranda açılacağı seçilir, F11 ile tam ekran. |
| 🔊 **Ses çıkışı seçimi** | Yayın sesi seçilen hoparlöre/HDMI cihazına yönlenir. |
| 🔒 **Otomatik HTTPS** | HTTP ve HTTPS aynı portta; kendinden imzalı sertifika makineye özel üretilir, ağ değişince yenilenir. |
| 🌍 **Tüm ağ kartları** | Wi-Fi ve Ethernet dahil her kartın adresi listelenir, ağ değişince güncellenir. |
| 🛡️ **Güvenlik** | 5 yanlış kodda IP geçici engellenir; isteğe bağlı kullanıcı onayı (30 sn, varsayılan kapalı). |
| 🧰 **Kurulum sihirbazı** | HTTP/HTTPS portu ve isteğe bağlı alan adı seçilir (varsayılan **80 / 443**), güvenlik duvarı kuralları eklenir. |
| 🧭 **Sistem tepsisi** | Pencere kapansa da arkada çalışır; yeni kod üret, yayını durdur, Windows ile başlat. |

---

## 🚀 Hızlı Başlangıç

### Kullanıcı olarak
1. `Cast-Setup-1.0.0.exe` kurulum dosyasını alıcı PC'de çalıştırın (portable sürüm de var).
2. Sihirbazda portları onaylayın (varsayılan 80 ve 443). İsterseniz bir alan adı girin.
3. Receiver açılınca ekranda kod, QR ve bağlantı adresleri görünür.

### Gönderen cihazdan
1. QR kodu okutun **veya** tarayıcıya receiver ekranındaki adresi yazın (ör. `https://192.168.1.20`).
2. Sertifika uyarısı çıkarsa devam edin (sertifika yerel olarak üretilmiştir; iPhone/Android'de kamera ve ekran paylaşımı için **HTTPS şarttır**).
3. 6 haneli kodu girin → **Eşleştir ve Yayına Başla**.
4. Paylaşılacak ekranı/sekmeyi veya kamerayı seçin.

> Tarayıcıda ekran paylaşımı yalnızca bilgisayar tarayıcılarında desteklenir; telefonlarda web gönderici kamerayı, Android uygulaması ise ekranı yayınlar. Mobil Chrome arka plana alınınca kamerayı bıraktığı için uygulama geri dönüşte kamerayı otomatik yeniden açar.

### Ayna modunu açma
Receiver → **Ayarlar** → **“Yayını bağlı tüm ekranlara yansıt”**. Yayın sırasında diğer tüm monitörlerde siyah arka planlı tam ekran pencere açılır, yayın bitince kapanır.

---

## 🛠️ Geliştirici

```bash
npm install
npm start          # Electron receiver + dahili sunucu
npm run server     # yalnızca web ve sinyal sunucusu
npm test           # entegrasyon testleri
```

Derleme (`dist/` altına çıkar):

```bash
npm run build:installer   # NSIS kurulum sihirbazı
npm run build:portable    # taşınabilir tek EXE
npm run build             # hepsi
```

Android uygulaması için bkz. [`android/README.md`](android/README.md).

### Mimari

```
 Telefon / PC tarayıcısı ──┐
   (server/public)        │  WebSocket (Socket.IO) sinyal
 Android uygulaması ──────┼─────────────────────────────►  Signaling server (Node/Express)
                          │                                   ├─ dual-protocol HTTP+HTTPS (server/dual-protocol.js)
                          │  WebRTC video + ses               ├─ otomatik TLS (server/tls.js)
                          └──────────────────────────────►  Electron receiver (main.js, src/renderer)
                                                              └─ ayna pencereleri (mirror.html, yerel WebRTC)
```

- `main.js`, `preload.js`, `src/renderer/` — Electron alıcı
- `server/` — sinyal sunucusu, yapılandırma, TLS, web gönderici (`server/public/`)
- `build/installer.nsh` — kurulum sihirbazı sayfası ve güvenlik duvarı kuralları
- `android/` — Kotlin + WebRTC uygulaması
- `promo/` — tanıtım videosunun kaynağı (HTML sahneler + Electron ile kare üretimi)

---

## ⚙️ Ayarlar

Ayarlar `%APPDATA%\HomakCast\settings.json` içinde saklanır, kurulumda seçilen portlar `%ProgramData%\HomakCast\install.ini` dosyasına yazılır. Receiver'daki **Ayarlar** penceresinden:

- Portlar, alıcı cihaz adı, alan adı
- Kullanıcı onayı (açık/kapalı), Windows ile başlatma
- Varsayılan FPS (60 / 30), ses çıkışı, ayna modu
- STUN / TURN sunucuları

Seçilen port başka bir program tarafından kullanılıyorsa uygulama otomatik olarak **5240 (HTTP) ve 5241 (HTTPS)** portlarına geçer.

---

## ⚠️ Bilinen Sınırlar

- Sertifika kendinden imzalıdır; tarayıcı uyarısını gidermek için gerçek bir alan adı ve Let's Encrypt gerekir.
- Mobil tarayıcılar arka planda kamera yayınını sürdüremez; kesintisiz arka plan yayını için Android uygulaması kullanılmalıdır.
- Ayna modu ve Android uygulaması gerçek çoklu monitör / cihaz ortamında sınırlı test edilmiştir; hata bildirimleri memnuniyetle karşılanır.

---

## 🤖 Nasıl Yapıldı?

Proje baştan sona yapay zekâ destekli geliştirme (**vibe coding**) ile [Claude Code](https://claude.com/claude-code) kullanılarak tasarlandı, yazıldı, test edildi ve yayınlandı.

**Teknolojiler:** Electron · Node.js · Express · Socket.IO · WebRTC · Kotlin · NSIS · coturn
