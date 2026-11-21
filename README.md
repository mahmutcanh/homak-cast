# 📡 HOMAK CAST — Windows Kablosuz Ekran & Projeksiyon Alıcısı

**HOMAK CAST**, Windows 10 ve Windows 11 üzerinde çalışan, harici ekranlara ve HDMI projeksiyon cihazlarına kablosuz ekran ve ses aktarımı (Screen Mirroring / Casting) sağlayan yüksek performanslı bir masaüstü Receiver (Alıcı) ve Web Sender (Gönderici) çözümüdür.

---

## 🌟 Temel Özellikler

### 1. 6 Haneli Dinamik Eşleştirme Kodu & Hızlı QR Kod
- Alıcı ekranında rastgele üretilen büyük ve okunaklı 6 haneli kod (Örn: `482 190`).
- Gönderici cihazların (telefon, tablet veya başka bir PC) kamerasıyla okutarak saniyeler içinde bağlanabileceği dinamik QR kod.
- Eşleştirme sağlandıktan sonra kod anında geçersiz kılınarak yabancı cihazların yayına müdahale etmesi engellenir.

### 2. Yayın Kesintisinde Otomatik Yenileme
- Gönderici yayını durdurduğunda veya bağlantı koptuğunda Receiver otomatik olarak bekleme ekranına döner.
- Sistem anında **yeni bir 6 haneli eşleştirme kodu** ve yeni QR kod üretir.

### 3. Ultra Düşük Gecikme & 60 FPS Performans
- WebRTC tabanlı P2P ve Relay akış mimarisi.
- 60 FPS donanım hızlandırmalı video akışı ve adaptif bitrate kontrolü.
- Hızlı yanıt süresi ile video, sunum ve interaktif kullanım için optimize edilmiştir.

### 4. Projeksiyon & Çoklu Monitör Desteği
- Sistemdeki tüm monitörleri ve HDMI projeksiyon cihazlarını otomatik algılar.
- Üst menüden veya sistem tepsisinden yayının hangi ekranda açılacağı seçilebilir.
- F11 kısayolu veya arayüz butonu ile tek tıkla tam ekran (projeksiyon) moduna geçiş.

### 5. Özel Ses Çıkışı Yönlendirme (Audio Sink Selection)
- Bilgisayara bağlı ses çıkış aygıtlarını (HDMI Projeksiyon hoparlörü, harici USB ses kartı, kulaklık) otomatik listeler.
- Gelen yayın sesinin doğrudan seçilen projeksiyon veya harici hoparlörden oynatılmasını sağlar.

### 6. Gelişmiş Güvenlik & Rate Limiting
- **Kaba Kuvvet (Brute-Force) Koruması:** Eşleştirme kodunu arka arkaya 5 kez yanlış giren IP adresleri geçici olarak engellenir.
- **Anında Bağlantı (Varsayılan):** Doğru kodu giren cihaz onay beklemeden hemen bağlanır.
- **Kullanıcı Onayı (Opsiyonel / Varsayılan Kapalı):** Alıcı ayarlarından açılırsa, kod girilse dahi alıcı ekranında onay penceresi ("X cihazı ekranını yansıtmak istiyor: Kabul Et / Reddet") açılır. 30 saniye içinde yanıt verilmezse otomatik reddedilir. Onay tercihi alıcı başınadır.

### 7. Çapraz Ağ & VLAN / WAN Desteği
- Farklı Subnet, farklı VLAN veya internet üzerinden bağlantı için STUN ve TURN sunucu desteği.
- Google Public STUN sunucuları hazır konfigüre edilmiştir.

### 8. Windows Sistem Tepsisi (System Tray) Entegrasyonu
- Uygulama penceresi kapatıldığında arka planda sistem tepsisinde (System Tray) çalışmaya devam eder.
- Tepsi Sağ Tık Menüsü:
  - 📺 **Receiver'ı Aç**
  - 🖥️ **Ekran / Projeksiyon Seç** (Tüm bağlı monitörler)
  - ⚙️ **Sunucu ve Yayın Ayarları**
  - ⏹ **Yayını Durdur**
  - 🔄 **Yeni Kod Üret**
  - 🚀 **Windows ile Otomatik Başlat**
  - ❌ **Çıkış**

---

## 🚀 Kurulum ve Çalıştırma

### Hazır EXE Dosyaları (`dist/`)
Projede önceden derlenmiş 64-bit Windows yürütülebilir dosyaları mevcuttur:
- **Klasör Modu (Unpacked):** `dist\win-unpacked\Homak Cast Receiver.exe` dosyasını çift tıklatarak hemen çalıştırabilirsiniz.
- **Tek Dosya (Portable EXE):** `dist\Homak Cast Receiver 1.0.0.exe` kurulum gerektirmeyen taşınabilir sürümdür.

### Geliştirici Modunda Çalıştırma (Kaynak Koddan)
```bash
# Bağımlılıkları yükleyin
npm install

# Alıcı uygulamasını (Electron + Dahili Sunucu) başlatın
npm start
```

### Sadece Web & Sinyal Sunucusunu Başlatma
```bash
npm run server
```
Sunucu varsayılan olarak `5240` portundan başlar ve yerel ağ IP adreslerini konsola yazdırır.

### Testleri Çalıştırma
```bash
npm test
```
Tüm entegrasyon testlerini (Sinyal, PIN üretimi, Rate-limiting, WebRTC onay süreci, Kod geçersiz kılma ve Yayın kesilme döngüsü) doğrular.

### Yeniden EXE Derleme
```bash
# Klasör paketi oluştur
npm run build:dir

# Tek parça taşınabilir (Portable) EXE oluştur
npm run build:portable

# NSIS Windows Kurulum Dosyası oluştur
npm run build:installer
```

---

## 📱 Ekran Yansıtma (Sender) Nasıl Kullanılır?

1. Alıcı PC'de **Homak Cast Receiver** uygulamasını açın.
2. Ekranda görüntülenen **QR kodu** telefonunuzun kamerasıyla okutun **VEYA** aynı ağdaki herhangi bir cihazın tarayıcısından `http://<ALICI_IP>:5240` adresine gidin.
3. 6 haneli eşleştirme kodunu girin (QR ile bağlandıysanız kod otomatik girilir).
4. **"Eşleştir ve Yayına Başla"** butonuna basın.
5. Alıcı ekranında onay uyarısı çıkarsa **"Kabul Et"** butonuna tıklayın.
6. Tarayıcınızın ekran paylaşımı penceresinden paylaşmak istediğiniz ekranı, pencereyi veya sekmeyi seçin (ses aktarımı için "Sistem sesini paylaş" kutucuğunu işaretleyin).
7. Yayınınız anında 60 FPS hızında alıcı ekranda görüntülenecektir!

---

## ⚙️ Yapılandırma ve Ayarlar
Ayarlar `%APPDATA%\HomakCast\settings.json` dosyasında saklanır ve Receiver arayüzündeki **⚙️ Ayarlar** penceresinden anlık olarak değiştirilebilir:
- Port numarası
- Alıcı cihaz adı
- Kullanıcı onay zorunluluğu (Açık/Kapalı)
- Windows ile otomatik başlatma
- Varsayılan FPS (60 / 30)
- STUN / TURN sunucu adresleri
