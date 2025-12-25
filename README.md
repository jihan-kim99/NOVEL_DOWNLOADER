# Novel Downloader

This is a [Next.js](https://nextjs.org) project designed to download novels from Kakuyomu.

## Features

- **Next.js Backend**: Uses API routes to handle download logic.
- **Vercel Ready**: Optimized for deployment on Vercel.
- **Simple UI**: Easy to use interface for inputting novel URLs.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## API Routes

The project includes an API route at `/api/download` which accepts POST requests with a JSON body containing the `url` of the novel.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
