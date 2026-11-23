# Novel Downloader

A [Next.js](https://nextjs.org) app that downloads web novels as valid EPUB 3 files.

## Supported Websites

- **Kakuyomu** (`https://kakuyomu.jp/works/<id>`)
- **Shosetsuka ni Narou** (`https://ncode.syosetu.com/<ncode>/`)
- **Narou R18** — **Nocturne Novels**, **Moonlight Novels**, and **Midnight Novels** (`https://novel18.syosetu.com/<ncode>/`, plus URLs from `noc.syosetu.com`, `mnlt.syosetu.com`, `mid.syosetu.com`, `nl.syosetu.com/redirect/ageauth/...`, or bare ncodes like `n1234ab`)

Supports both serialized novels and short stories (短編), preserves ruby annotations (furigana) and paragraph formatting, and produces XML-valid EPUB files.

## Getting Started

```bash
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## API Routes

- `POST /api/kakuyomu` — Kakuyomu info, episode, and fallback HTML parsing (`info`, `episode`, `parse-info`, `parse-episode`)
- `POST /api/narou` — Narou & Narou R18 (`ncode` / `novel18`) info, episode, and fallback HTML parsing (`info`, `episode`, `parse-info`, `parse-episode`, `fetch`)
- `POST /api/download` — Unified endpoint supporting both platforms
