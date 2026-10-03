# Seat Planner for Android

The Android app is the Seat Planner website, full screen. It loads every page
from the live site (`https://seat-planner-sable.vercel.app`), so **a web deploy
reaches every phone without an app update**. A new APK is only needed when this
folder changes.

What it adds to the website:

- the **back button** closes a dialog or the menu first, then goes back a page;
- **pull to refresh**, and a reload when the app comes back after 30+ minutes;
- the **camera** for the ticket checker's QR scanner;
- the **tickets PDF**, opened in the phone's PDF viewer;
- links to other sites open in the phone's browser;
- its own screen when the server can't be reached.

Package `com.seatplanner.app`, Android 8.0 (API 26) and newer.

## Testing against your computer

The app can show pages from a computer on the same network instead of the live
site — to try web changes on a phone before they ship.

1. Start the site with `npm run dev` in `frontend/` (and the API, as usual).
2. On the computer, open **Open on phone** from the account menu, or go to
   <http://localhost:3000/dev/phone>. It exists only under `next dev`.
3. Scan its first QR code with the phone's camera to **install the app** from
   the computer, if it isn't installed yet.
4. Scan the second to **switch the app to this computer**. The app asks first,
   then shows an amber **DEV** strip until you tap it to go back.

No QR code to hand? **Hold three fingers on the screen for three seconds** to
open the server screen, and type the address (`192.168.x.x:3000`).

The app only switches to `localhost` or a private address (`10.*`,
`172.16–31.*`, `192.168.*`) — a QR code from someone else cannot point it at
another website. While it's on a computer, desktop Chrome can inspect the page
at `chrome://inspect`.

**If the phone can't reach the computer:**

- both must be on the same Wi-Fi;
- Windows Firewall must allow Node.js on *private* networks, and the Wi-Fi must
  be set to Private;
- the ticket scanner's camera only works on https or `localhost`: plug the
  phone in, run `adb reverse tcp:3000 tcp:3000`, and choose "over USB" on the
  server screen.

### How a QR code reaches the app

The switch code is a link on the live site,
`https://seat-planner-sable.vercel.app/app/server?url=http://192.168.x.x:3000`.
Android opens it in the app rather than the browser because the site publishes
`frontend/public/.well-known/assetlinks.json`, naming this package and the
signing key's fingerprint. Android checks that file **when the app is
installed** — so deploy the site before installing, or re-check afterwards:

```sh
adb shell pm verify-app-links --re-verify com.seatplanner.app
adb shell pm get-app-links com.seatplanner.app   # "verified" when it worked
```

Until then the link opens `/app/server` in the browser, whose **Open in the
app** button reaches the app another way (`seatplanner://server?url=…`). A debug
build is signed with a different key, so on it the button is the only way.

## Building

Needs JDK 17 and the Android SDK (platform 35, build tools 35.0.0). Android
Studio brings both; without it:

```sh
# Windows, everything on one drive (example: D:\Android)
set JAVA_HOME=D:\Android\jdk17
set ANDROID_HOME=D:\Android\sdk
cd android
gradlew assembleRelease        # signed APK (needs the key — below)
gradlew assembleDebug          # debug APK, signed with the SDK's debug key
gradlew testDebugUnitTest lintDebug
```

The APK lands in `app/build/outputs/apk/release/app-release.apk` (or
`debug/app-debug.apk`), which is the file the **Open on phone** page serves.

## The signing key

Android only installs an update over the app a phone already has if both are
signed with **the same key**. Lose it and every phone has to uninstall the app
(signing them out) and install a new one.

- The key is a PKCS#12 file, `seat-planner-release.jks`, alias `seat-planner`,
  issued to "Seat Planner", valid until 2054.
- It is **never committed**. On a developer's machine `android/keystore.properties`
  (git-ignored) points at it:

  ```properties
  storeFile=D:/Android/keys/seat-planner-release.jks
  storePassword=…
  keyAlias=seat-planner
  keyPassword=…
  ```

- CI reads the same from repository secrets: `ANDROID_KEYSTORE_BASE64` (the
  file, base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`. GitHub cannot show a secret again, so they are not a
  backup — **keep the file and its password in a password manager or another
  safe place.**
- Its SHA-256 fingerprint is in `frontend/public/.well-known/assetlinks.json`.
  Should the key ever change, that file must list the new fingerprint.

## Releasing

1. Raise `versionCode` (by one) and `versionName` in `app/build.gradle.kts`.
2. Merge, then tag the commit: `git tag android-v1.0.1 && git push origin android-v1.0.1`.
3. The **Android** workflow builds the signed APK and publishes a GitHub
   Release with it. Phones install it over the old one; nobody is signed out.

The tag must match `versionName`, or the workflow stops.

Every push to `android/` also builds an APK, kept with the workflow run.

## Code

| File | What it does |
|---|---|
| `MainActivity.kt` | The WebView: loading, back, refresh, errors, camera, links, switch links |
| `ServerActivity.kt` | The hidden server screen |
| `Servers.kt` | Which addresses are allowed, and reading switch links (unit-tested) |
| `ServerStore.kt` | The chosen server and recent ones, kept on the phone |
| `ThreeFingerHold.kt` | The three-finger, three-second gesture |
| `PageScripts.kt` | The two small scripts run inside the site's pages |
| `TicketFiles.kt` | The tickets PDF handed over by the page |
| `Reachability.kt` | "Test connection" |

The website's side: `frontend/src/lib/androidApp.js` (talking to the app),
`openTicketPdf` in `frontend/src/lib/booking.js`, `frontend/src/app/dev/phone/`
(the Open on phone page and APK download) and `frontend/src/app/app/server/`
(where a switch link lands without the app).
