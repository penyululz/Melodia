# Melodia

Melodia is a self-hosted music PWA that blends a local music library with YouTube Music discovery, downloads, playlists, offline playback, lyrics, subtitles, and a native mobile/tablet player experience.

## Features

- Local library for uploaded, scanned, demo, and promoted YouTube media.
- Native YouTube Music search, save, favorite, playlist, and yt-dlp download flows.
- Import YouTube or YouTube Music playlists by link into normal Melodia playlists.
- Audio and video playback modes with local-first playback when media is downloaded.
- Offline-capable PWA for desktop, mobile, tablet, iPhone, iPad, Android, macOS, Windows, and Linux.
- SQLite-backed library, playlists, history, feedback, cached API metadata, artwork, lyrics, and subtitles.
- Generated demo library for local testing without internet, yt-dlp, or ffmpeg.
- Production auth policy for mutating actions, with demo admin fallback in dev/demo mode.

## Tech Stack

- Next.js App Router
- React
- SQLite via `better-sqlite3`
- yt-dlp for YouTube audio/video downloads and stream resolution
- ytmusic-api for YouTube Music search and playlist metadata
- Howler plus native media elements for playback
- Tailwind CSS and Radix UI primitives

## Quick Start

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo Playground

```bash
corepack pnpm demo:reset
corepack pnpm demo:seed
corepack pnpm demo:verify
```

Demo rows and files are tagged as demo data, so reset only removes demo-owned records and demo media.

## Useful Scripts

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm check
corepack pnpm smoke:api
corepack pnpm artwork:repair --dry-run
```

## Environment

Create `.env.local` from `.env.example`, then set production values on the server.

Important variables:

- `JWT_SECRET`: required for production sessions.
- `MELODIA_DEMO_MODE=1`: enables demo fallback behavior outside development.
- `MUSIC_LIBRARY_PATH` and `MUSIC_SCAN_ROOTS`: allowed scan roots.
- `YT_DLP_PATH`: path to yt-dlp, for example `/usr/local/bin/yt-dlp`.
- `YT_DLP_COOKIES_PATH`: optional Netscape cookies file for YouTube bot checks.
- `YT_DLP_JS_RUNTIME`: optional JavaScript runtime for yt-dlp, for example `node:/usr/bin/node`.
- `YTMUSIC_WEB_DAILY_REQUEST_BUDGET` and `YTMUSIC_WEB_REQUESTS_PER_MINUTE`: protective YouTube Music request limits.
- `YOUTUBE_DATA_API_KEY` or `GOOGLE_API_KEY`: optional official YouTube Data API key.
- `YOUTUBE_DATA_DAILY_SEARCH_BUDGET` and `YOUTUBE_DATA_REQUESTS_PER_MINUTE`: official API quota guardrails.
- `THEAUDIODB_API_KEY`: optional, defaults to the public free key.
- `THEAUDIODB_DAILY_REQUEST_BUDGET` and `THEAUDIODB_REQUESTS_PER_MINUTE`: artwork metadata request limits.
- `GOOGLE_CUSTOM_SEARCH_API_KEY` and `GOOGLE_CUSTOM_SEARCH_CX`: optional online artwork fallback.

## YouTube And Downloads

Melodia uses YouTube Music search for discovery and yt-dlp for actual audio/video downloads. Saved or downloaded YouTube media is promoted into the normal library so albums, artists, genres, playlists, favorites, offline mode, and playback controls behave like local uploads.

For production VPS use, install yt-dlp and configure cookies if YouTube challenges the server IP.

```bash
sudo python3 -m pip install -U yt-dlp
yt-dlp --version
```

If imported YouTube playlist artwork is missing after a deploy or older imports saved broken `maxresdefault` URLs, repair it on the VPS:

```bash
cd /var/www/melodia/current
corepack pnpm artwork:repair --dry-run
corepack pnpm artwork:repair
sudo systemctl restart melodia
```

If older imported playlist songs are grouped under `YouTube Imports`, repair their title/artist/album metadata from YouTube Music:

```bash
cd /var/www/melodia/current
corepack pnpm youtube:repair-metadata --dry-run
corepack pnpm youtube:repair-metadata
sudo systemctl restart melodia
```

## Playlist Import

Open Playlists, choose **Import YouTube**, and paste a YouTube or YouTube Music playlist URL. Melodia will:

- fetch playlist metadata,
- cache artwork locally when possible,
- save each YouTube track to the app database,
- create or refresh a normal Melodia playlist,
- keep the playlist playable through the same queue/player flow.

## Deployment

The detailed Ubuntu 24.04, CyberPanel, Hostinger VPS, GitHub Actions, and `music.webforge.my` guide is in [DEPLOYMENT.md](./DEPLOYMENT.md).

The deployment workflow preserves shared data under `/var/www/melodia/shared`, including SQLite data, uploads, downloads, and covers, so release updates do not wipe user libraries.

## Verification

Before pushing production changes:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

For a fuller local smoke pass:

```bash
corepack pnpm demo:reset
corepack pnpm demo:seed
corepack pnpm check
```
