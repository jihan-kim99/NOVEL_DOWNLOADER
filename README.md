# Novel Downloader

A [Next.js](https://nextjs.org) app that downloads web novels as valid EPUB 3 files.

## Supported Websites

- **Kakuyomu** (`https://kakuyomu.jp/works/<id>`)
- **Shosetsuka ni Narou** (`https://ncode.syosetu.com/<ncode>/`)
- **Narou R18** — **Nocturne Novels**, **Moonlight Novels**, and **Midnight Novels** (`https://novel18.syosetu.com/<ncode>/`, plus URLs from `noc.syosetu.com`, `mnlt.syosetu.com`, `mid.syosetu.com`, `nl.syosetu.com/redirect/ageauth/...`, or bare ncodes like `n1234ab`)

## Bypassing Syosetu Cloud-IP Blocks & R18 Age Verification (Desktop & Mobile)

Syosetu (`ncode.syosetu.com` and `novel18.syosetu.com`) blocks cloud/datacenter IP ranges (such as Vercel/AWS) with `403 Forbidden`, and public third-party CORS proxies both get blocked and strip the `over18=yes` cookie required for R18 novels.

### Option 1: Helper Userscript (Desktop + Mobile Safari / Android Firefox)
Install `/novel-downloader.user.js`:
- **Desktop**: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
- **iOS Safari**: Free [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) Safari extension
- **Android**: Firefox for Android + Violentmonkey (or Edge Android)

This bridges requests directly through your own browser IP with `Cookie: over18=yes` and also adds a floating **Download EPUB** button directly on Narou, `novel18`, and Kakuyomu pages.

### Option 2: Zero-Extension Bookmarklet (Stock iOS Safari & Android Chrome)
No extensions required:
1. Open the app → **Setup** → tap **Copy Bookmarklet Code**.
2. Bookmark any page in Safari/Chrome → edit that bookmark's URL to paste the copied `javascript:...` code, and give it a short name like `dl`.
3. Open any novel on `ncode.syosetu.com`, `novel18.syosetu.com`, or `kakuyomu.jp`, type `dl` in the address bar, and tap the bookmark.
4. When finished, tap **Save EPUB** or **Share / Books** directly in the overlay.

### Option 3: Stock Mobile Browser Directly on Vercel (Self-Hosted Home Relay)
To let **any** mobile browser download straight from your Vercel URL with zero setup on the phone, run the included zero-dependency residential relay on a home PC / Mac / Raspberry Pi:

```bash
PROXY_TOKEN=your-secret-token node proxy/server.mjs
cloudflared tunnel --url http://localhost:8787
```

Then set these Environment Variables in your Vercel project and redeploy:
- `SYOSETU_PROXY_URL=https://<your-tunnel-hostname>/fetch?url={url}`
- `SYOSETU_PROXY_TOKEN=your-secret-token`

## Getting Started

```bash
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
