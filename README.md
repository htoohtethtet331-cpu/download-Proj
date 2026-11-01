# SnapFetch — Social Media Video Downloader (TikTok, YouTube, Telegram)

React + Vite + Tailwind CSS front-end application ready for instant deployment on **Netlify**.

## Features
- **Platform Auto-Detection**: Automatically detects TikTok, YouTube (Videos & Shorts), and Telegram public channel links.
- **Live TikTok No-Watermark Support**: Uses the public TikWM API out-of-the-box to fetch HD MP4 (No Watermark) and original MP3 audio tracks.
- **YouTube & Telegram Resolution**: Live YouTube oEmbed metadata extraction + configurable Custom API / Cobalt API / Netlify Serverless Function proxy (`netlify/functions/resolve-video.js`).
- **Bilingual UI (မြန်မာ / English)**: Switch seamlessly between Burmese and English.
- **Netlify Ready**: Includes `netlify.toml`, `public/_redirects`, and pre-built `dist/` folder for instant Netlify Drop or Git deployment.

## Local Development

```bash
npm install
npm run dev
```

## Build for Netlify

```bash
npm run build
```
