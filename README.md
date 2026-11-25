# FTube

Fast, private YouTube client running in your browser over FKN.

Live app: [youtube.fkn.app](https://youtube.fkn.app)

## Features

- Home, subscriptions, channels, playlists, hashtags, posts, shorts, and live streams
- SABR playback via Shaka Player with multi-audio tracks, stable volume, ambient mode, chapters, transcripts, downloadable subtitles, SponsorBlock segments, and Return YouTube Dislike counts
- Local Watch History, custom channel groups (with optional encrypted FKN account sync), offline VOD/audio MP4 downloads, and encrypted Watch Together rooms with FKN Social names and avatars
- Direct FKN relay / WebVPN / FKN extension egress with no analytics or tracking

## Development

Requires Node.js 24 and npm.

```sh
npm ci --legacy-peer-deps
npm run dev
```

Checks and builds:

```sh
npm run type-check
npm test
npm run lint
npm run build
npm run build:npm
```

`npm run build` outputs the Cloudflare Pages site into `build/`. `npm run build:npm` outputs the FKN sandbox package into `dist/`.

## Store artwork

```sh
npm run build && npm run store-art
```

Generates `public/icons/*`, `public/favicon.ico`, and the `store/*.webp` listing assets using headless Chromium and `ffmpeg`.

## Privacy

FTube runs entirely in your browser and stores settings, channel groups, history, and downloads locally (or encrypted in your FKN account when enabled). See the [privacy policy](https://youtube.fkn.app/privacy).
