#!/usr/bin/env node

const crypto = require("crypto")
const path = require("path")
const Database = require("better-sqlite3")
const YTMusic = require("ytmusic-api")

const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run")
const force = args.has("--force")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const delayArg = process.argv.find((arg) => arg.startsWith("--delay-ms="))
const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : 0
const delayMs = delayArg ? Number.parseInt(delayArg.split("=")[1], 10) : 350

const dbPath = process.env.MELODIA_DB_PATH || path.join(process.cwd(), "data", "music.db")
const db = new Database(dbPath)
db.pragma("busy_timeout = 5000")
ensureApiCacheSchema()

const ytTracks = db.prepare("SELECT * FROM yt_tracks").all()
const ytByVideoId = new Map(ytTracks.map((track) => [track.video_id, track]))
const localRows = db.prepare(`
  SELECT id, title, artist, album, duration, file_path
  FROM tracks
  WHERE file_path LIKE '/api/youtube/stream/%'
     OR storage_kind = 'youtube'
`).all()

const candidates = new Map()
for (const track of localRows) {
  const videoId = getVideoIdFromPath(track.file_path)
  if (!videoId) continue
  const ytTrack = ytByVideoId.get(videoId)
  if (force || isGenericAlbum(track.album) || isGenericAlbum(ytTrack?.album)) {
    candidates.set(videoId, { videoId, track, ytTrack })
  }
}

for (const ytTrack of ytTracks) {
  if (force || isGenericAlbum(ytTrack.album)) {
    const existing = candidates.get(ytTrack.video_id)
    candidates.set(ytTrack.video_id, {
      videoId: ytTrack.video_id,
      track: existing?.track || null,
      ytTrack,
    })
  }
}

const work = [...candidates.values()].slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined)
const updateTrack = db.prepare(`
  UPDATE tracks SET
    title = ?,
    artist = ?,
    album = ?,
    album_artist = ?,
    duration = COALESCE(?, duration),
    updated_at = datetime('now')
  WHERE id = ?
`)
const updateYTTrack = db.prepare(`
  UPDATE yt_tracks SET
    title = ?,
    artist = ?,
    album = ?,
    duration = COALESCE(?, duration),
    updated_at = datetime('now')
  WHERE video_id = ?
`)

let ytmusic = null
let updated = 0
let skipped = 0
let stoppedForBudget = false

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

async function main() {
  console.log(`${dryRun ? "[dry-run] " : ""}Repairing ${work.length} YouTube metadata rows in ${dbPath}`)

  for (const item of work) {
    const details = await getSongDetails(item.videoId)
    if (stoppedForBudget) break
    if (!details) {
      skipped += 1
      continue
    }

    const title = cleanText(details.title) || cleanText(item.track?.title) || cleanText(item.ytTrack?.title) || "Unknown Track"
    const artist = cleanText(details.artist) || cleanText(item.track?.artist) || cleanText(item.ytTrack?.artist) || "Unknown Artist"
    const album =
      cleanText(details.album) ||
      nonGenericText(item.ytTrack?.album) ||
      nonGenericText(item.track?.album) ||
      title
    const duration = Number.isFinite(details.duration) ? details.duration : null

    console.log(`${dryRun ? "[dry-run] " : ""}${item.videoId}: ${artist} - ${title} -> album "${album}"`)

    if (!dryRun) {
      const tx = db.transaction(() => {
        if (item.track?.id) updateTrack.run(title, artist, album, artist, duration, item.track.id)
        updateYTTrack.run(title, artist, album, duration, item.videoId)
      })
      tx()
    }

    updated += 1
    if (delayMs > 0) await sleep(delayMs)
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}.`)
}

async function getSongDetails(videoId) {
  const cacheKey = makeCacheKey("ytmusic-song-details", [videoId])
  const cached = getCachedJson(cacheKey)
  if (cached) return cached

  const provider = "ytmusic-web-song-details"
  const dailyBudget = parseEnvInt(process.env.YTMUSIC_WEB_DAILY_REQUEST_BUDGET, 500)
  const perMinuteBudget = parseEnvInt(process.env.YTMUSIC_WEB_REQUESTS_PER_MINUTE, 20)
  if (!canSpendRequestBudget(provider, 1, dailyBudget, perMinuteBudget)) {
    console.warn(`Budget exhausted for ${provider}; stop before ${videoId}`)
    stoppedForBudget = true
    return null
  }

  if (!ytmusic) {
    ytmusic = new YTMusic()
    await ytmusic.initialize()
  }

  try {
    const song = await ytmusic.getSong(videoId)
    spendQuota(provider, 1)
    if (!song) return null

    const result = {
      videoId: song.videoId || videoId,
      title: song.name || null,
      artist: song.artist?.name || null,
      album: song.album?.name || null,
      duration: Number.isFinite(song.duration) ? song.duration : null,
    }
    setCachedJson(cacheKey, result, 30 * 86_400)
    return result
  } catch (error) {
    console.warn(`Could not fetch details for ${videoId}: ${error.message}`)
    return null
  }
}

function getVideoIdFromPath(filePath) {
  const match = String(filePath || "").match(/^\/api\/youtube\/stream\/([^/?#]+)/)
  return match?.[1] || null
}

function cleanText(value) {
  const text = typeof value === "string" ? value.trim() : ""
  return text || null
}

function nonGenericText(value) {
  const text = cleanText(value)
  return text && !isGenericAlbum(text) ? text : null
}

function isGenericAlbum(value) {
  const text = cleanText(value)
  return !text || /^(youtube imports?|youtube downloads?|unknown album)$/i.test(text)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeCacheKey(prefix, parts) {
  const hash = crypto
    .createHash("sha1")
    .update(parts.map((part) => String(part ?? "")).join("\u0000"))
    .digest("hex")
  return `${prefix}:${hash}`
}

function getCachedJson(key) {
  try {
    const row = db.prepare(`
      SELECT value
      FROM api_cache
      WHERE cache_key = ? AND expires_at > datetime('now')
    `).get(key)
    return row ? JSON.parse(row.value) : null
  } catch {
    return null
  }
}

function setCachedJson(key, value, ttlSeconds) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  db.prepare(`
    INSERT INTO api_cache (cache_key, value, expires_at, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(cache_key) DO UPDATE SET
      value = excluded.value,
      expires_at = excluded.expires_at,
      updated_at = datetime('now')
  `).run(key, JSON.stringify(value), expiresAt)
}

function canSpendRequestBudget(provider, cost, dailyBudget, perMinuteBudget) {
  return getQuotaUsage(provider) + cost <= dailyBudget && getWindowQuotaUsage(provider, 60) + cost <= perMinuteBudget
}

function spendQuota(provider, cost) {
  db.prepare(`
    INSERT INTO api_quota_usage (provider, quota_date, units, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(provider, quota_date) DO UPDATE SET
      units = units + excluded.units,
      updated_at = datetime('now')
  `).run(provider, getQuotaDate(), cost)
  db.prepare(`
    INSERT INTO api_quota_events (provider, units, created_at)
    VALUES (?, ?, datetime('now'))
  `).run(provider, cost)
}

function getQuotaUsage(provider) {
  const row = db.prepare(`
    SELECT units
    FROM api_quota_usage
    WHERE provider = ? AND quota_date = ?
  `).get(provider, getQuotaDate())
  return Number(row?.units || 0)
}

function getWindowQuotaUsage(provider, windowSeconds) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(units), 0) as units
    FROM api_quota_events
    WHERE provider = ? AND created_at >= datetime('now', ?)
  `).get(provider, `-${Math.max(1, windowSeconds)} seconds`)
  return Number(row?.units || 0)
}

function ensureApiCacheSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_quota_usage (
      provider TEXT NOT NULL,
      quota_date TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (provider, quota_date)
    );

    CREATE TABLE IF NOT EXISTS api_quota_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_api_quota_events_provider_created ON api_quota_events(provider, created_at);
  `)
}

function getQuotaDate() {
  return new Date().toISOString().slice(0, 10)
}

function parseEnvInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
