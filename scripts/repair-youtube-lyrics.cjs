#!/usr/bin/env node

const crypto = require("crypto")
const path = require("path")
const Database = require("better-sqlite3")

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

const rows = db.prepare(`
  SELECT id, title, artist, album, duration, file_path
  FROM tracks
  WHERE (file_path LIKE '/api/youtube/stream/%' OR storage_kind = 'youtube')
    AND COALESCE(content_type, 'music') != 'podcast'
    AND (? = 1 OR (lyrics_plain IS NULL AND lyrics_synced IS NULL))
  ORDER BY updated_at DESC, id DESC
  ${Number.isFinite(limit) && limit > 0 ? `LIMIT ${limit}` : ""}
`).all(force ? 1 : 0)

const updateLyrics = db.prepare(`
  UPDATE tracks SET
    lyrics_plain = COALESCE(?, lyrics_plain),
    lyrics_synced = COALESCE(?, lyrics_synced),
    lyrics_source = ?,
    updated_at = datetime('now')
  WHERE id = ?
`)

let updated = 0
let skipped = 0
let stoppedForBudget = false

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

async function main() {
  console.log(`${dryRun ? "[dry-run] " : ""}Repairing lyrics for ${rows.length} YouTube library rows in ${dbPath}`)

  for (const track of rows) {
    const lyrics = await getOrFetchLyrics(track)
    if (stoppedForBudget) break

    if (!hasLyrics(lyrics)) {
      skipped += 1
      if (delayMs > 0) await sleep(delayMs)
      continue
    }

    console.log(`${dryRun ? "[dry-run] " : ""}${track.id}: cached lyrics for ${track.artist || "Unknown Artist"} - ${track.title}`)
    if (!dryRun) {
      updateLyrics.run(lyrics.plainLyrics, lyrics.syncedLyrics, lyrics.source || "lrclib", track.id)
    }
    updated += 1
    if (delayMs > 0) await sleep(delayMs)
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}${stoppedForBudget ? ", stopped for request budget" : ""}.`)
}

async function getOrFetchLyrics(track) {
  const cacheKey = makeCacheKey("lyrics", [
    normalizeSongTitle(track.title),
    normalizePerson(track.artist || ""),
    normalizeSongTitle(track.album || ""),
    normalizeDuration(track.duration),
  ])
  const cached = getCachedJson(cacheKey)
  if (cached) return cached

  const lyrics = await fetchLyrics({
    title: track.title,
    artist: track.artist || "",
    album: track.album || "",
    duration: normalizeDuration(track.duration) ? String(normalizeDuration(track.duration)) : "",
  }).catch((error) => {
    console.warn(`Could not fetch lyrics for ${track.artist || "Unknown Artist"} - ${track.title}: ${error.message}`)
    return { plainLyrics: null, syncedLyrics: null, source: null }
  })
  setCachedJson(cacheKey, lyrics, hasLyrics(lyrics) ? 180 * 86_400 : 7 * 86_400)
  return lyrics
}

async function fetchLyrics(query) {
  const lookupTitle = normalizeSongTitle(query.title) || query.title
  const lookupAlbum = normalizeSongTitle(query.album) || query.album

  const params = new URLSearchParams({ track_name: lookupTitle, artist_name: query.artist })
  if (lookupAlbum) params.set("album_name", lookupAlbum)
  if (query.duration) params.set("duration", query.duration)

  const exact = await fetchLrcLib(`https://lrclib.net/api/get?${params.toString()}`)
  if (exact.ok) {
    const data = await exact.json()
    if (scoreLyricMatch(data, query) >= 4) return toLyricsResponse(data)
  }

  const search = await fetchLrcLib(
    `https://lrclib.net/api/search?track_name=${encodeURIComponent(lookupTitle)}&artist_name=${encodeURIComponent(query.artist)}`
  )
  if (search.ok) {
    const results = await search.json()
    const best = (Array.isArray(results) ? results : [])
      .map((result) => ({ result, score: scoreLyricMatch(result, query) }))
      .filter((item) => item.score >= 4)
      .sort((a, b) => b.score - a.score)[0]?.result
    if (best) return toLyricsResponse(best)
  }

  return { plainLyrics: null, syncedLyrics: null, source: null }
}

async function fetchLrcLib(url) {
  const provider = "lrclib"
  const dailyBudget = parseEnvInt(process.env.LRCLIB_DAILY_REQUEST_BUDGET, 200)
  const perMinuteBudget = parseEnvInt(process.env.LRCLIB_REQUESTS_PER_MINUTE, 10)
  if (!canSpendRequestBudget(provider, 1, dailyBudget, perMinuteBudget)) {
    stoppedForBudget = true
    return new Response(null, { status: 429 })
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": process.env.LRCLIB_USER_AGENT || "Melodia/0.1 (self-hosted music player)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8000),
  })
  spendQuota(provider, 1)
  return response
}

function toLyricsResponse(data) {
  const hasData = Boolean(data?.syncedLyrics || data?.plainLyrics)
  return {
    plainLyrics: hasData ? data.plainLyrics ?? null : null,
    syncedLyrics: hasData ? data.syncedLyrics ?? null : null,
    source: hasData ? "lrclib" : null,
  }
}

function hasLyrics(lyrics) {
  return Boolean(lyrics?.plainLyrics || lyrics?.syncedLyrics)
}

function scoreLyricMatch(candidate, query) {
  const candidateTitle = normalizeSongTitle(candidate?.trackName || candidate?.name || "")
  const queryTitle = normalizeSongTitle(query.title)
  const candidateArtist = normalizePerson(candidate?.artistName || "")
  const queryArtist = normalizePerson(query.artist)
  const duration = Number(query.duration)
  const candidateDuration = Number(candidate?.duration)
  let score = 0

  if (candidateTitle && candidateTitle === queryTitle) score += 4
  else if (candidateTitle && queryTitle && (candidateTitle.includes(queryTitle) || queryTitle.includes(candidateTitle))) score += 2

  if (queryArtist && candidateArtist === queryArtist) score += 2
  else if (queryArtist && candidateArtist && (candidateArtist.includes(queryArtist) || queryArtist.includes(candidateArtist))) score += 1

  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(candidateDuration) && Math.abs(candidateDuration - duration) <= 5) score += 1
  if (candidate?.syncedLyrics) score += 1
  return score
}

function normalizeSongTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\(official.*?\)/gi, "")
    .replace(/\(music video\)/gi, "")
    .replace(/\(audio\)/gi, "")
    .replace(/\(lyrics?\)/gi, "")
    .replace(/\(visualizer\)/gi, "")
    .replace(/\(hd\)/gi, "")
    .replace(/\(hq\)/gi, "")
    .replace(/\(4k\)/gi, "")
    .replace(/\[.*?\]/g, "")
    .replace(/ft\.?|feat\.?/gi, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizePerson(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeDuration(value) {
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null
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
