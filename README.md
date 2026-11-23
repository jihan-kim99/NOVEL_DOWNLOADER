# Novel Downloader

A [Next.js](https://nextjs.org) app that downloads web novels as valid EPUB 3 files.

## Supported Websites

- **Kakuyomu** (`https://kakuyomu.jp/works/<id>`)
- **Shosetsuka ni Narou** (`https://ncode.syosetu.com/<ncode>/`)
- **Narou R18** — **Nocturne Novels**, **Moonlight Novels**, and **Midnight Novels** (`https://novel18.syosetu.com/<ncode>/`, plus URLs from `noc.syosetu.com`, `mnlt.syosetu.com`, `mid.syosetu.com`, `nl.syosetu.com/redirect/ageauth/...`, or bare ncodes like `n1234ab`)

## Bypassing Syosetu Cloud-IP Blocks & R18 Age Verification (Vercel)

Syosetu (`ncode.syosetu.com` and `novel18.syosetu.com`) blocks cloud/datacenter IP ranges (such as Vercel/AWS) with `403 Forbidden`, and public third-party CORS proxies both get blocked and strip the `over18=yes` cookie required for R18 novels.

Three built-in ways solve this completely:

1. **Helper Userscript (Recommended for Vercel)** — Install `/novel-downloader.user.js` in [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/). It bridges requests directly through your own browser IP with `Cookie: over18=yes` (bypassing both cloud IP blocks and R18 age checks) and also adds a floating **Download EPUB** button directly on Narou, `novel18`, and Kakuyomu pages.
2. **Zero-Extension Bookmarklet** — Drag the **Download Novel EPUB** bookmarklet from the app UI to your bookmarks bar, then click it while viewing any novel on `ncode.syosetu.com`, `novel18.syosetu.com`, or `kakuyomu.jp` (`/bookmarklet.js`). Runs same-origin in your browser with your own IP & cookies.
3. **Run Locally or Configure `SYOSETU_PROXY_URL`** — Running `yarn dev` locally uses your home IP directly. On Vercel, you can optionally set `SYOSETU_PROXY_URL` (e.g. `https://your-proxy.example.com/fetch?url={url}`) to route server-side Syosetu fetches through your own residential/custom proxy.

## Getting Started

```bash
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
