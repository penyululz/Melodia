# Melodia Deployment Guide

Target setup:

- Domain: `music.webforge.my`
- VPS: Hostinger VPS running Ubuntu 24.04 LTS with CyberPanel/OpenLiteSpeed
- App runtime: Next.js production server behind OpenLiteSpeed reverse proxy
- Persistent data: SQLite DB, YouTube downloads, uploaded files, and scanned music stay outside release folders
- Automation: GitHub Actions deploys new releases without deleting old user data

## 1. How The Production Layout Works

Use this layout on the VPS:

```text
/var/www/melodia/
  current -> /var/www/melodia/releases/<git-sha>
  releases/
    <git-sha>/
      app code for one deployment
  shared/
    .env.local
    data/
      music.db
      downloads/
      artwork/
      demo/
    covers/
    uploads/
    music/
```

Why this matters:

- Deployments replace only `/var/www/melodia/current`.
- Real user data lives in `/var/www/melodia/shared`.
- `data/` is symlinked into each release, so SQLite and downloads survive updates.
- `public/covers` is symlinked to `/var/www/melodia/shared/covers`, so generated WebP artwork survives updates.
- `public/music/uploads` is symlinked to `/var/www/melodia/shared/uploads`.
- Scanned external music can live in `/var/www/melodia/shared/music` or any root listed in `MUSIC_SCAN_ROOTS`.

## 2. Point The Hostinger Domain

In Hostinger hPanel:

1. Go to `Domains` -> `Domain portfolio`.
2. Select `webforge.my`.
3. Open `DNS / Nameservers` -> `DNS records`.
4. Add an A record:

```text
Type: A
Name: music
Points to: <your VPS IPv4 address>
TTL: default
```

Do not edit the root `@` record for `webforge.my` unless you want to affect the main site.

Check propagation:

```bash
dig +short music.webforge.my
nslookup music.webforge.my
```

DNS can take minutes, and sometimes up to 24 hours, to propagate.

## 3. Prepare Ubuntu 24.04

SSH into the VPS as root or a sudo user:

```bash
ssh root@<your-vps-ip>
```

Update packages and install build tools:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl git build-essential python3 python3-pip pipx ffmpeg sqlite3 unzip tar
```

Install Node.js 22 and enable Corepack:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
node --version
corepack pnpm --version
```

Create a dedicated app user and directories:

```bash
sudo useradd --system --create-home --shell /bin/bash melodia || true
sudo mkdir -p /var/www/melodia/releases
sudo mkdir -p /var/www/melodia/shared/data
sudo mkdir -p /var/www/melodia/shared/covers
sudo mkdir -p /var/www/melodia/shared/uploads
sudo mkdir -p /var/www/melodia/shared/music
sudo chown -R melodia:melodia /var/www/melodia
```

## 4. Install Native yt-dlp

Downloads are handled by native `yt-dlp` on the server. Install it for the `melodia` user:

```bash
sudo -u melodia pipx ensurepath
sudo -u melodia pipx install yt-dlp
sudo -u melodia /home/melodia/.local/bin/yt-dlp --version
ffmpeg -version
```

Set these paths in the app environment later:

```text
YT_DLP_PATH=/home/melodia/.local/bin/yt-dlp
FFMPEG_PATH=/usr/bin/ffmpeg
```

## 5. Create Production Environment

Create the shared env file:

```bash
sudo -u melodia nano /var/www/melodia/shared/.env.local
```

Use this template:

```bash
NODE_ENV=production
PORT=3000
HOSTNAME=127.0.0.1

JWT_SECRET=replace-with-output-from-openssl-rand-base64-48
MELODIA_DEMO_MODE=0

MUSIC_LIBRARY_PATH=/var/www/melodia/shared/music
MUSIC_SCAN_ROOTS=/var/www/melodia/shared/music

MAX_UPLOAD_FILE_MB=500
MAX_UPLOAD_REQUEST_MB=2048

YT_DLP_PATH=/home/melodia/.local/bin/yt-dlp
FFMPEG_PATH=/usr/bin/ffmpeg

GOOGLE_API_KEY=
YOUTUBE_DATA_API_KEY=
YOUTUBE_DATA_DAILY_SEARCH_BUDGET=1000
YOUTUBE_DATA_REQUESTS_PER_MINUTE=5
YOUTUBE_SEARCH_CACHE_TTL_HOURS=24
YOUTUBE_API_PREFER_OFFICIAL=0
YTMUSIC_WEB_DAILY_REQUEST_BUDGET=500
YTMUSIC_WEB_REQUESTS_PER_MINUTE=20
FRESH_YOUTUBE_MIX_QUERY=top music

GOOGLE_CUSTOM_SEARCH_API_KEY=
GOOGLE_CUSTOM_SEARCH_CX=
GOOGLE_CSE_DAILY_IMAGE_BUDGET=25
GOOGLE_CSE_REQUESTS_PER_MINUTE=5
ARTWORK_CACHE_TTL_DAYS=30
ONLINE_ARTWORK_LOOKUP=0

LRCLIB_DAILY_REQUEST_BUDGET=200
LRCLIB_REQUESTS_PER_MINUTE=10
LRCLIB_USER_AGENT=Melodia/0.1 (self-hosted music player)

THEAUDIODB_ENABLED=1
THEAUDIODB_API_KEY=123
THEAUDIODB_DAILY_REQUEST_BUDGET=200
THEAUDIODB_REQUESTS_PER_MINUTE=20
THEAUDIODB_USER_AGENT=Melodia/0.1 (self-hosted music player)
```

Generate the secret:

```bash
openssl rand -base64 48
```

Paste that value into `JWT_SECRET`.

Important:

- Keep `MELODIA_DEMO_MODE=0` in production.
- Only enable `ONLINE_ARTWORK_LOOKUP=1` or official YouTube API use if you want the server to spend API quota.
- Production does not fall back to demo/mock data. Demo data is for local playground testing only.
- Fresh accounts can still see YouTube Music-style online starter mixes through cached, rate-limited YouTube Music search.
- The app caches local metadata, artwork, lyrics, subtitles, saved tracks, and downloaded media so API calls are only needed for new discovery/search work.

## 6. Create The Systemd Service

Create the service:

```bash
sudo nano /etc/systemd/system/melodia.service
```

Paste:

```ini
[Unit]
Description=Melodia Music PWA
After=network.target

[Service]
Type=simple
User=melodia
Group=melodia
WorkingDirectory=/var/www/melodia/current
EnvironmentFile=/var/www/melodia/shared/.env.local
Environment=PATH=/home/melodia/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/bin/bash -lc 'corepack pnpm start'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable it, but do not worry if it cannot start until the first release exists:

```bash
sudo systemctl daemon-reload
sudo systemctl enable melodia
```

Allow the deploy user to restart only this service:

```bash
sudo visudo -f /etc/sudoers.d/melodia-deploy
```

Add:

```text
melodia ALL=(root) NOPASSWD: /usr/bin/systemctl restart melodia
```

## 7. Set Up GitHub Actions Deployment

This repo includes `.github/workflows/deploy-vps.yml`.

In GitHub:

1. Open the repository.
2. Go to `Settings` -> `Secrets and variables` -> `Actions`.
3. Add these repository secrets:

```text
VPS_HOST=<your VPS IPv4 or hostname>
VPS_USER=melodia
VPS_PORT=22
APP_ROOT=/var/www/melodia
VPS_SSH_KEY=<private key used only for deployment>
```

Create a deploy SSH key on your local machine:

```bash
ssh-keygen -t ed25519 -C "melodia-github-actions" -f melodia_github_actions
```

Copy the public key to the VPS:

```bash
ssh-copy-id -i melodia_github_actions.pub melodia@<your-vps-ip>
```

If `ssh-copy-id` is not available, add the public key manually:

```bash
sudo -u melodia mkdir -p /home/melodia/.ssh
sudo -u melodia chmod 700 /home/melodia/.ssh
cat melodia_github_actions.pub | sudo tee -a /home/melodia/.ssh/authorized_keys
sudo chown -R melodia:melodia /home/melodia/.ssh
sudo chmod 600 /home/melodia/.ssh/authorized_keys
```

Put the private key content into the `VPS_SSH_KEY` secret:

```bash
cat melodia_github_actions
```

First deploy:

1. Push to `main`, or run the workflow manually from GitHub Actions.
2. The workflow uploads a release archive.
3. The VPS extracts it to `/var/www/melodia/releases/<sha>`.
4. It links shared data/uploads.
5. It runs `pnpm install` and `pnpm build`.
6. It points `/var/www/melodia/current` at the new release.
7. It restarts `melodia`.

Old user data is not inside the archive and is not deleted.

## 8. Create The CyberPanel Website

In CyberPanel:

1. Go to `Websites` -> `Create Website`.
2. Domain: `music.webforge.my`.
3. Email: your admin email.
4. PHP: any version is fine because the app is Node, not PHP.
5. SSL: enable it if the option is available.
6. Create the website.

Then issue SSL:

1. Go to `SSL` -> `Manage SSL`.
2. Select `music.webforge.my`.
3. Click `Issue SSL`.

HTTPS is required for production PWA install/offline behavior on iOS, Android, desktop Chrome, Edge, and Safari.

## 9. Reverse Proxy OpenLiteSpeed To Next.js

The app listens privately on `127.0.0.1:3000`. OpenLiteSpeed should serve public HTTPS and proxy to that port.

Preferred setup through OpenLiteSpeed WebAdmin:

1. Open WebAdmin, usually `https://<server-ip>:7080`.
2. Go to `Virtual Hosts`.
3. Select the vhost for `music.webforge.my`.
4. Open `External App`.
5. Add a new external app:

```text
Type: Web Server
Name: melodia
Address: 127.0.0.1:3000
Max Connections: 200
Initial Request Timeout: 60
Retry Timeout: 0
Response Buffering: No
```

6. Open `Context`.
7. Add a proxy context:

```text
Type: Proxy
URI: /
Web Server: melodia
```

8. Gracefully restart OpenLiteSpeed.

If your CyberPanel build has a simpler reverse proxy UI, use it with:

```text
Public domain: https://music.webforge.my
Backend: http://127.0.0.1:3000
```

Uploads can be large, so also raise the OpenLiteSpeed request body limit to at least `2048M` if your server rejects uploads before the app sees them.

## 10. First Production Check

After the GitHub Action completes:

```bash
sudo systemctl status melodia --no-pager
sudo journalctl -u melodia -n 100 --no-pager
curl -I http://127.0.0.1:3000
curl -I https://music.webforge.my
curl -I https://music.webforge.my/manifest.json
curl -I https://music.webforge.my/sw.js
```

Open:

```text
https://music.webforge.my
```

Then:

1. Register/login with a real account.
2. Upload a small audio file.
3. Favorite a YouTube result and confirm it downloads locally through `yt-dlp`.
4. Play an MP4 in audio mode and video mode.
5. Install the PWA on mobile/tablet/desktop.
6. Save a track offline, disconnect network, and confirm the offline copy plays.

## 11. PWA And Offline Behavior

Melodia is built as an installable PWA for:

- Android Chrome
- iPhone/iPad Safari via Add to Home Screen
- macOS Safari/Chrome/Edge
- Windows Chrome/Edge
- Linux Chrome/Edge/Firefox where supported

Production requirements:

- Serve over HTTPS.
- Keep `/manifest.json` reachable.
- Keep `/sw.js` reachable.
- Do not block `IndexedDB`.
- Do not put broad media caching in the service worker.

Offline storage is account-scoped on the device. This prevents one logged-in account from caching another user's library and saves disk space.

The player behavior is:

- Prefer downloaded/offline media when it exists.
- Stream only when no local/offline copy exists.
- If a stream takes too long to load/play, retry the account's offline copy.
- Media Session support keeps lock-screen/background controls working where the OS/browser allows it.

Browser limits still apply. iOS may pause some web playback in situations the app cannot override, but the app uses standard PWA, Media Session, and inline video behavior.

## 12. yt-dlp And Downloads

`yt-dlp` is the native server download path:

- `POST /api/youtube/download/[videoId]?quality=high&media=audio`
- `POST /api/youtube/download/[videoId]?quality=high&media=video`

Saved/favorited YouTube tracks follow the user's download setting:

- Audio download: stores one audio-capable file.
- MP4/video download: stores one video file, and audio mode can play that same MP4 directly.
- Existing downloaded media is reused before streaming.
- Changing quality/media type replaces the previous cached download instead of piling up duplicates.
- The promoted library row uses the online title when available.

Check on the VPS:

```bash
sudo -u melodia /home/melodia/.local/bin/yt-dlp --version
sudo -u melodia ffmpeg -version
ls -lah /var/www/melodia/shared/data/downloads
```

## 13. Free APIs, Caching, And Quota Protection

Melodia can use these free providers:

- LRCLIB: lyrics and synced lyrics, no key required.
- TheAudioDB: album/track artwork and metadata, free test key `123` or your own key.
- YouTube Music web search: starter mixes and search without spending Google Cloud quota.
- YouTube Data API: optional Google Cloud Console key if you choose to enable official search.
- Google Programmable Search: optional fallback for missing cover art.

The request order is cache-first:

1. Embedded file metadata, artwork, lyrics, subtitles.
2. Server SQLite/API cache.
3. Downloaded/saved YouTube metadata and thumbnails.
4. LRCLIB or TheAudioDB when needed and under quota.
5. Optional Google APIs only when enabled and under quota.

Default free-tier guards:

```text
LRCLIB_DAILY_REQUEST_BUDGET=200
LRCLIB_REQUESTS_PER_MINUTE=10
THEAUDIODB_DAILY_REQUEST_BUDGET=200
THEAUDIODB_REQUESTS_PER_MINUTE=20
YTMUSIC_WEB_DAILY_REQUEST_BUDGET=500
YTMUSIC_WEB_REQUESTS_PER_MINUTE=20
YOUTUBE_DATA_DAILY_SEARCH_BUDGET=1000
YOUTUBE_DATA_REQUESTS_PER_MINUTE=5
GOOGLE_CSE_DAILY_IMAGE_BUDGET=25
GOOGLE_CSE_REQUESTS_PER_MINUTE=5
```

Set a budget to a lower number if you want to be extra strict. If a provider hits the daily or per-minute budget, Melodia returns cached/local data or simply skips that provider. It should not keep retrying and burning quota.

For a no-cost deployment:

```text
YOUTUBE_API_PREFER_OFFICIAL=0
ONLINE_ARTWORK_LOOKUP=0
THEAUDIODB_ENABLED=1
```

That keeps Google paid/quota-sensitive APIs off by default while still allowing local metadata, LRCLIB lyrics, and TheAudioDB artwork when you explicitly enable online artwork lookup.

## 14. Backups Before Updates

Create a backup directory:

```bash
sudo mkdir -p /var/backups/melodia
sudo chown melodia:melodia /var/backups/melodia
```

Backup SQLite safely:

```bash
sudo -u melodia sqlite3 /var/www/melodia/shared/data/music.db ".backup '/var/backups/melodia/music-$(date +%Y%m%d-%H%M%S).db'"
```

Backup media/config:

```bash
sudo -u melodia tar -czf /var/backups/melodia/melodia-files-$(date +%Y%m%d-%H%M%S).tgz \
  -C /var/www/melodia/shared \
  .env.local data covers uploads music
```

The GitHub Action keeps the last five release folders. Roll back code without touching data:

```bash
ls -1 /var/www/melodia/releases
sudo -u melodia ln -sfn /var/www/melodia/releases/<old-sha> /var/www/melodia/current
sudo systemctl restart melodia
```

## 15. Manual Deploy Fallback

If GitHub Actions is unavailable:

```bash
sudo -u melodia mkdir -p /var/www/melodia/releases/manual
cd /var/www/melodia/releases/manual
git clone <your-repo-url> .
ln -sfn /var/www/melodia/shared/data data
mkdir -p public/music
ln -sfn /var/www/melodia/shared/uploads public/music/uploads
rm -rf public/covers
ln -sfn /var/www/melodia/shared/covers public/covers
ln -sfn /var/www/melodia/shared/.env.local .env.local
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm build
ln -sfn /var/www/melodia/releases/manual /var/www/melodia/current
sudo systemctl restart melodia
```

## 16. Verification Commands

Run these locally before pushing:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm demo:reset
corepack pnpm demo:seed
corepack pnpm demo:verify
```

Run these on the VPS after deployment:

```bash
cd /var/www/melodia/current
corepack pnpm smoke:api
curl -I https://music.webforge.my
curl -I https://music.webforge.my/manifest.json
curl -I https://music.webforge.my/sw.js
```

Do not run `demo:seed` on production unless you deliberately want playground data on the production server.

## 17. Dev Tools And Production Safety

You cannot truly disable a user's browser developer tools from a website. Browsers intentionally keep DevTools under user control.

What this project does for production:

- Uses production builds instead of `next dev`.
- Disables production browser source maps in `next.config.mjs`.
- Does not configure Next.js dev indicators for deployment.
- Removes app-side PWA debug logs in production.
- Keeps secrets on the server in `.env.local`.
- Protects mutating APIs with auth.
- Keeps demo fallback disabled with `MELODIA_DEMO_MODE=0`.

Security should come from auth, server-side secrets, safe file handling, and HTTPS, not from trying to hide browser tools.

## 18. Common Problems

If the domain does not load:

```bash
dig +short music.webforge.my
sudo systemctl status lscpd --no-pager
sudo systemctl status lsws --no-pager
sudo systemctl status melodia --no-pager
```

If the app works on `127.0.0.1:3000` but not the domain, fix OpenLiteSpeed reverse proxy or SSL.

If uploads fail:

- Confirm `MAX_UPLOAD_FILE_MB` and `MAX_UPLOAD_REQUEST_MB`.
- Raise OpenLiteSpeed request body limit.
- Check free disk space:

```bash
df -h
```

If YouTube downloads fail:

```bash
sudo -u melodia /home/melodia/.local/bin/yt-dlp --version
sudo -u melodia /home/melodia/.local/bin/yt-dlp -F "https://www.youtube.com/watch?v=<videoId>"
sudo journalctl -u melodia -n 100 --no-pager
```

If SQLite is locked:

- Check if multiple app processes are running.
- Keep only one `melodia` service instance.
- Avoid manually opening the DB in write mode during scans/downloads.

## 19. Reference Links

- Hostinger DNS records: https://www.hostinger.com/support/1583249-how-to-manage-dns-records-at-hostinger/
- Hostinger A records: https://support.hostinger.com/en/articles/4468886-how-to-add-and-remove-a-records-in-hpanel/
- Next.js self-hosting: https://nextjs.org/docs/app/guides/self-hosting
- OpenLiteSpeed reverse proxy: https://docs.openlitespeed.org/config/reverseproxy/
- CyberPanel SSL: https://cyberpanel.net/ssl-manager
- LRCLIB API docs: https://lrclib.net/docs
- TheAudioDB free music API: https://www.theaudiodb.com/free_music_api
