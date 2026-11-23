# Novel Downloader

A [Next.js](https://nextjs.org) web app and **native Android app (Capacitor)** that downloads web novels concurrently as valid EPUB 3 files.

## Download Latest Android APK

- **Direct APK Download (1-tap on Android):** [NovelDownloader.apk (Latest Release)](https://github.com/jihan-kim99/NOVEL_DOWNLOADER/releases/download/latest/NovelDownloader.apk)
- **Latest Release Page:** [github.com/jihan-kim99/NOVEL_DOWNLOADER/releases/tag/latest](https://github.com/jihan-kim99/NOVEL_DOWNLOADER/releases/tag/latest)
- **GitHub Actions Build Artifacts:** [Build Android APK Workflow Runs](https://github.com/jihan-kim99/NOVEL_DOWNLOADER/actions/workflows/android-apk.yml)

> Every push to `main` (or manual run in GitHub Actions) automatically builds a fresh `NovelDownloader.apk`, uploads it as an Actions artifact, and updates the permanent `latest` direct download link above.

## Supported Websites

- **Kakuyomu** (`https://kakuyomu.jp/works/<id>`)
- **Shosetsuka ni Narou** (`https://ncode.syosetu.com/<ncode>/`)
- **Narou R18** — **Nocturne Novels**, **Moonlight Novels**, and **Midnight Novels** (`https://novel18.syosetu.com/<ncode>/`, plus URLs from `noc.syosetu.com`, `mnlt.syosetu.com`, `mid.syosetu.com`, `nl.syosetu.com/redirect/ageauth/...`, or bare ncodes like `n1234ab`)

## Features

- **Built-in Catalog & Search Explorer (Web & Android):** Browse daily/weekly/monthly/all-time rankings, recently updated works, and keyword search across all 5 supported sites (Shosetsuka ni Narou, Kakuyomu, Nocturne, Moonlight, and Midnight R18) with 1-tap EPUB download or queueing.
- **Native Android In-App WebView Browser:** Browse the real novel websites directly inside the Android app with quick-switch site tabs, address bar, pre-seeded `over18=yes` R18 cookies, and an automatic bottom **Download EPUB / + Queue** bar whenever you visit any novel or episode page.
- **Download Queue & Concurrent Episode Downloading:** Queue multiple novels from the Catalog or In-App Browser and batch-download them, extracting complete episode lists upfront and downloading in parallel (`1x` / `3x` / `5x` / `8x` concurrency selector, default `5x`) while preserving exact chapter order.
- **Native Android App:** Runs 100% on-device via Capacitor (`CapacitorHttp` + `CapacitorCookies` + `Filesystem` + `Share` + custom `InternalBrowser` plugin) — no server, no CORS, no cloud IP blocks, Android Share Sheet support (**Share → Novel Downloader** from Chrome), and saves EPUBs to `Documents/NovelDownloader/`.
- **Valid EPUB 3 Output:** Preserves `<ruby>` furigana and formatting, handles short stories (短編), and escapes all XML entities cleanly.

## Build Android APK Locally (Optional, requires Android SDK & JDK 21)

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
