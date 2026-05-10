#!/usr/bin/env node

const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const Database = require("better-sqlite3")
const sharp = require("sharp")

const ROOT_DIR = process.cwd()
const DB_PATH = process.env.MELODIA_DB_PATH || path.join(ROOT_DIR, "data", "music.db")
const COVERS_DIR = process.env.MELODIA_COVERS_DIR || path.join(ROOT_DIR, "public", "covers")
const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has("--dry-run")
const FORCE = args.has("--force")
const LIMIT = getArgNumber("--limit")

if (!fs.existsSync(DB_PATH)) {
  console.error(`Database not found: ${DB_PATH}`)
  process.exit(1)
}

fs.mkdirSync(COVERS_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma("busy_timeout = 5000")

main()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2))
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => db.close())

async function main() {
  const rows = getYouTubeLibraryRows()
  const targetMap = new Map()

  for (const row of rows) {
    const videoId = row.video_id || extractVideoId(row.file_path) || extractVideoId(row.playback_path)
    if (!videoId || !YOUTUBE_VIDEO_ID_RE.test(videoId)) continue

    const existingCover = row.cover_art_path || row.thumbnail_url || null
    const target = targetMap.get(videoId) || {
      trackIds: new Set(),
      ytTrackIds: new Set(),
      videoId,
      candidates: [],
      needsRepair: false,
    }

    if (row.track_id) target.trackIds.add(row.track_id)
    if (row.yt_track_id) target.ytTrackIds.add(row.yt_track_id)
    target.candidates.push(row.cover_art_path, row.thumbnail_url)
    if (FORCE || !coverLooksUsable(existingCover)) target.needsRepair = true

    targetMap.set(videoId, target)
  }

  const targets = Array.from(targetMap.values())
    .filter((target) => target.needsRepair)
    .map((target) => ({
      trackIds: Array.from(target.trackIds),
      ytTrackIds: Array.from(target.ytTrackIds),
      videoId: target.videoId,
      candidates: getThumbnailCandidates(target.videoId, target.candidates),
    }))
  const limitedTargets = Number.isInteger(LIMIT) && LIMIT > 0 ? targets.slice(0, LIMIT) : targets
  const summary = {
    dbPath: DB_PATH,
    coversDir: COVERS_DIR,
    dryRun: DRY_RUN,
    force: FORCE,
    scanned: rows.length,
    needsRepair: targets.length,
    attempted: limitedTargets.length,
    repaired: 0,
    failed: 0,
    skipped: rows.length - targets.length,
  }

  if (DRY_RUN) return summary

  const updateTrack = db.prepare("UPDATE tracks SET cover_art_path = ?, updated_at = datetime('now') WHERE id = ?")
  const updateYTTrack = db.prepare("UPDATE yt_tracks SET thumbnail_url = ?, updated_at = datetime('now') WHERE id = ?")

  for (const target of limitedTargets) {
    const publicPath = await downloadFirstUsableThumbnail(target.videoId, target.candidates)
    if (!publicPath) {
      summary.failed += 1
      continue
    }

    for (const trackId of target.trackIds) updateTrack.run(publicPath, trackId)
    for (const ytTrackId of target.ytTrackIds) updateYTTrack.run(publicPath, ytTrackId)
    summary.repaired += 1
  }

  return summary
}

function getYouTubeLibraryRows() {
  return db.prepare(`
    SELECT
      t.id as track_id,
      t.file_path,
      t.playback_path,
      t.cover_art_path,
      y.id as yt_track_id,
      y.video_id,
      y.thumbnail_url
    FROM tracks t
    LEFT JOIN yt_tracks y
      ON t.file_path = '/api/youtube/stream/' || y.video_id
      OR t.playback_path = '/api/youtube/stream/' || y.video_id
    WHERE t.storage_kind = 'youtube'
      OR t.file_path LIKE '/api/youtube/stream/%'
      OR t.playback_path LIKE '/api/youtube/stream/%'

    UNION

    SELECT
      NULL as track_id,
      NULL as file_path,
      NULL as playback_path,
      NULL as cover_art_path,
      y.id as yt_track_id,
      y.video_id,
      y.thumbnail_url
    FROM yt_tracks y
  `).all()
}

function coverLooksUsable(publicPath) {
  if (!publicPath) return false

  if (publicPath.includes("maxresdefault.jpg")) return false
  if (publicPath.startsWith("/placeholder")) return false

  if (publicPath.startsWith("/covers/")) {
    const filePath = path.join(COVERS_DIR, publicPath.replace(/^\/covers\//, ""))
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0
  }

  return false
}

async function downloadFirstUsableThumbnail(videoId, candidates) {
  for (const candidate of candidates) {
    const publicPath = await downloadThumbnail(candidate, `youtube-${videoId}`).catch(() => null)
    if (publicPath) return publicPath
  }

  return null
}

async function downloadThumbnail(url, key) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Melodia/0.1 artwork repair",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    })
    if (!response.ok) return null

    const contentType = response.headers.get("content-type") || ""
    if (contentType && !contentType.startsWith("image/")) return null

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0) return null

    const hash = crypto
      .createHash("md5")
      .update(key)
      .update(bytes.subarray(0, 4096))
      .digest("hex")
      .slice(0, 12)
    const filePath = path.join(COVERS_DIR, `${hash}.webp`)
    if (!fs.existsSync(filePath)) {
      const webp = await sharp(bytes)
        .rotate()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 86 })
        .toBuffer()
      fs.writeFileSync(filePath, webp)
    }

    return `/covers/${hash}.webp`
  } finally {
    clearTimeout(timer)
  }
}

function getThumbnailCandidates(videoId, urls) {
  const seen = new Set()
  const candidates = []

  const add = (url) => {
    const trimmed = typeof url === "string" ? url.trim() : ""
    if (!trimmed || !/^https?:\/\//i.test(trimmed) || seen.has(trimmed)) return
    seen.add(trimmed)
    candidates.push(trimmed)
  }

  for (const url of urls) {
    if (typeof url === "string" && !url.startsWith("/covers/") && !url.includes("maxresdefault.jpg")) add(url)
  }

  add(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)
  add(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`)
  add(`https://i.ytimg.com/vi/${videoId}/default.jpg`)

  for (const url of urls) add(url)
  add(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`)

  return candidates
}

function extractVideoId(value) {
  if (typeof value !== "string") return null
  const match = value.match(/\/api\/youtube\/stream\/([a-zA-Z0-9_-]{11})/)
  return match?.[1] || null
}

function getArgNumber(name) {
  const prefix = `${name}=`
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  if (!match) return null
  const value = Number(match.slice(prefix.length))
  return Number.isInteger(value) && value > 0 ? value : null
}
