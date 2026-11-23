# Novel Downloader

A [Next.js](https://nextjs.org) web app and **native Android app (Capacitor)** that downloads web novels as valid EPUB 3 files.

## Supported Websites

- **Kakuyomu** (`https://kakuyomu.jp/works/<id>`)
- **Shosetsuka ni Narou** (`https://ncode.syosetu.com/<ncode>/`)
- **Narou R18** — **Nocturne Novels**, **Moonlight Novels**, and **Midnight Novels** (`https://novel18.syosetu.com/<ncode>/`, plus URLs from `noc.syosetu.com`, `mnlt.syosetu.com`, `mid.syosetu.com`, `nl.syosetu.com/redirect/ageauth/...`, or bare ncodes like `n1234ab`)

## Android App (Recommended for Mobile)

The Android app runs 100% on-device via Capacitor (`CapacitorHttp` + `CapacitorCookies` + `Filesystem` + `Share`) — no server, no CORS, no cloud IP blocks, and automatic `over18=yes` R18 age verification. It also registers in the **Android Share Sheet**, so you can tap **Share → Novel Downloader** directly from Chrome on any novel page, and saves EPUBs straight to `Documents/NovelDownloader/`.

### Download the APK (No Android Studio Needed)
1. Push to `main` (or trigger **Build Android APK** manually in the **Actions** tab on GitHub).
2. Open the completed workflow run → download the **`NovelDownloader-Android-APK`** artifact (`NovelDownloader.apk`).
3. Transfer/open `NovelDownloader.apk` on your Android phone and install.

### Build Locally (with Android SDK / JDK 21)
```bash
yarn install
yarn build:android
cd android && ./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

## Desktop / iOS Web Usage (Bypassing Syosetu Cloud-IP Blocks on Vercel)

Syosetu (`ncode.syosetu.com` and `novel18.syosetu.com`) blocks cloud/datacenter IP ranges (such as Vercel/AWS) with `403 Forbidden`:

1. **Helper Userscript** — Install `/novel-downloader.user.js` in [Tampermonkey](https://www.tampermonkey.net/), [Violentmonkey](https://violentmonkey.github.io/), or the free iOS Safari [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) extension.
2. **Zero-Extension Bookmarklet** — Copy the bookmarklet from **Setup** in the web UI and run it on any Narou / `novel18` / Kakuyomu page (`/bookmarklet.js`).
3. **Self-Hosted Home Relay** — Run `PROXY_TOKEN=secret node proxy/server.mjs` behind `cloudflared tunnel --url http://localhost:8787` and set `SYOSETU_PROXY_URL` & `SYOSETU_PROXY_TOKEN` in Vercel Environment Variables.

## Development

```bash
yarn install
yarn dev
```
