# HOMAK CAST — Sistem Özellikleri ve Mimari Dökümanı

**HOMAK CAST**, Windows 10 ve Windows 11 üzerinde çalışan, harici ekran ve HDMI projeksiyon destekli kablosuz ekran alıcısı (Receiver) ve WebRTC tabanlı gönderici (Sender) yazılımıdır.

---

## 1. Mimari Genel Bakış
- **Receiver (Masaüstü Uygulaması):** Electron + Node.js tabanlı, donanım hızlandırmalı video işleme ve Windows sistem tepsisi (System Tray) entegrasyonu.
- **Dahili Sinyal & Web Sunucusu:** Express + Socket.IO tabanlı yerleşik sinyal sunucusu (varsayılan port: 5240).
- **Sender (Gönderici Web Arayüzü):** Tarayıcı üzerinden çalışan (Chrome, Edge, Safari, Firefox), 60 FPS ekran + sistem sesi aktarımı sunan WebRTC istemcisi.
- **Bağlantı Katmanı:** WebRTC (P2P + STUN/TURN) ile farklı subnet, VLAN ve harici ağlar üzerinden güvenli aktarım.

---

## 2. Karşılanan Temel Gereksinimler

1. **6 Haneli Dinamik Kod & QR Kod Desteği:**
   - Receiver her açılışta ve her yayın bitişinde rastgele yeni bir 6 haneli kod üretir.
   - Kod ile birlikte cihazın IP adresini içeren hızlı bağlantı QR kodu oluşturulur.
   - Başarılı bağlantı kurulduğunda kod geçersiz kılınarak diğer cihazların bağlanması engellenir.

2. **Gelişmiş Güvenlik & Rate Limiting:**
   - 6 haneli kod denemelerinde kaba kuvvet (brute-force) koruması: 5 hatalı denemede ilgili IP adresi 60 saniye boyunca kilitlenir.
   - **Kullanıcı Onayı (Prompt):** İsteğe bağlı olarak gönderici bağlandığında Receiver üzerinde onay penceresi ("X cihazı ekranını yansıtmak istiyor: Kabul Et / Reddet") açılır. 30 saniye süre sayacı mevcuttur.

3. **Çoklu Ekran ve Projeksiyon Entegrasyonu:**
   - Windows'a bağlı tüm monitör ve HDMI projeksiyon cihazları dinamik olarak algılanır.
   - Arayüzden veya System Tray menüsünden yayının hangi ekranda açılacağı seçilebilir.
   - F11 kısayolu ve tam ekran butonu ile doğrudan projeksiyon moduna geçiş.

4. **Özel Ses Çıkışı Yönlendirme (Audio Sink Selection):**
   - Sisteme bağlı ses çıkış donanımları (HDMI Projeksiyon hoparlörü, harici ses kartı vb.) taranır.
   - Kullanıcı gelen ekran sesinin hangi hoparlör veya projeksiyondan çalacağını seçebilir.

5. **Yayın Kesintisi ve Yeniden Eşleştirme:**
   - Gönderici yayını sonlandırdığında veya bağlantı koptuğunda Receiver otomatik olarak kod bekleme ekranına döner.
   - Kod sıfırlanır ve anında yeni bir 6 haneli eşleştirme kodu ve yeni QR kod üretilir.

6. **Windows Sistem Tepsisi (Tray) & Otomatik Başlatma:**
   - Pencere kapatıldığında arka planda çalışmaya devam eder.
   - Tray menüsünden ekran seçimi, sunucu ayarları, yayını durdurma ve Windows oturumu ile başlatma yönetilebilir.

---

## 3. Derlenmiş Çalıştırılabilir Dosyalar
- **Taşınabilir EXE (Portable):** `dist/Homak Cast Receiver 1.0.0.exe`
- **Klasör Modu (Unpacked):** `dist/win-unpacked/Homak Cast Receiver.exe`

## 4. Testler
Proje testleri `npm test` komutu ile çalıştırılabilir:
- Sinyal sunucusu başlatma ve durum sorguları
- Receiver kayıt ve 6 haneli kod üretimi
- QR kod üretimi
- Brute-force rate limiting kontrolü
- Kullanıcı onay döngüsü
- Kod geçersiz kılma mekanizması
- Yayın kesilme ve yeni kod oluşturma döngüsü
