# Homak Cast — Android sender

Native Android app that mirrors the phone screen to a Homak Cast receiver (Windows EXE) over WebRTC.
It speaks the same Socket.IO signaling protocol as the web sender (`server/public/sender.js`).

## How it works

1. The user enters the 6-digit PIN or scans the receiver QR code.
2. `SignalingClient` pairs with the signaling server (`request-pairing`), receives ICE servers.
3. `CastService` (foreground service, type `mediaProjection`) owns a `CastSession`:
   MediaProjection capture -> libwebrtc video track -> offer/answer/candidates over signaling.
4. Video only (no system audio yet). Resolution is capped at 1920 on the long side; 30 or 60 FPS; max bitrate from the server (default 8 Mbps).

Server addresses: the cloud server is HTTPS. For a LAN receiver the QR contains the HTTPS address for browsers plus
`hp=<http port>`; the app uses the plain HTTP port, so no certificate trust is needed (cleartext is enabled for that reason).

## Build

Requires JDK 17, Android SDK platform 35 + build-tools 35.0.0, Gradle wrapper (included).

```
cd android
echo sdk.dir=<path to Android SDK> > local.properties
./gradlew :app:testDebugUnitTest          # unit tests + real-server protocol test (needs node on PATH)
./gradlew :app:assembleDebug              # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease            # signed with keystore.properties, else with the debug key
```

### Release signing

`keystore.properties` (gitignored) points to a keystore kept outside the repo:

```
storeFile=C:/path/to/homak-cast.jks
storePassword=...
keyAlias=homakcast
keyPassword=...
```

Keep the keystore backed up: Android only installs updates signed with the same key.

## Distribution

The release APK is not committed. `upload_exes.py` copies it to `/opt/cast/server/public/downloads/Homak-Cast.apk`,
served at `https://cast.homaklab.com/download/android`. Users must allow "install unknown apps" for their browser.

## Known limits

- No system audio capture (AudioPlaybackCapture not implemented).
- Not covered by automated device tests: MediaProjection capture and the WebRTC session need a real device.
