import "server-only"

import db, { type Track } from "@/lib/db"
import {
  canSpendRequestBudget,
  getCachedJson,
  makeCacheKey,
  setCachedJson,
  spendQuota,
} from "@/lib/api-cache"
import { normalizeSongTitle } from "@/lib/content-utils"

export type LyricsResponse = {
  plainLyrics: string | null
  syncedLyrics: string | null
  source: string | null
  cached?: boolean
}

type LyricsQuery = {
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | string | null
  trackId?: number | string | null
  videoId?: string | null
}

const LYRICS_CACHE_TTL_SECONDS = 180 * 86_400
const LYRICS_MISS_CACHE_TTL_SECONDS = 7 * 86_400
const LRCLIB_PROVIDER = "lrclib"

export async function getOrFetchLyrics(query: LyricsQuery): Promise<LyricsResponse> {
  const title = query.title || ""
  const artist = query.artist || ""
  const album = query.album || ""
  const duration = normalizeDuration(query.duration)
  const linkedTrack = findLinkedTrack({
    trackId: query.trackId ?? null,
    videoId: query.videoId ?? null,
    title,
    artist,
  })
  const storedLyrics = getStoredTrackLyrics(linkedTrack)
  if (storedLyrics) return { ...storedLyrics, cached: true }

  const cacheKey = makeCacheKey("lyrics", [
    normalizeSongTitle(title),
    normalizePerson(artist),
    normalizeSongTitle(album),
    duration,
  ])
  const cached = getCachedJson<LyricsResponse>(cacheKey)
  if (cached) {
    if (hasLyrics(cached) && linkedTrack) persistTrackLyrics(linkedTrack.id, cached, cached.source || "lyrics-cache")
    return { ...cached, cached: true }
  }

  const lyrics = await fetchLyrics({
    title,
    artist,
    album,
    duration: duration ? String(duration) : "",
  })
  setCachedJson(
    cacheKey,
    lyrics,
    hasLyrics(lyrics) ? LYRICS_CACHE_TTL_SECONDS : LYRICS_MISS_CACHE_TTL_SECONDS
  )
  if (hasLyrics(lyrics) && linkedTrack) {
    persistTrackLyrics(linkedTrack.id, lyrics, lyrics.source || "lrclib")
  }

  return lyrics
}

export async function cacheLyricsForTrack(input: LyricsQuery & { trackId: number }): Promise<boolean> {
  if (!input.title?.trim()) return false
  const lyrics = await getOrFetchLyrics(input)
  if (!hasLyrics(lyrics)) return false
  persistTrackLyrics(input.trackId, lyrics, lyrics.source || "lrclib")
  return true
}

async function fetchLyrics(query: {
  title: string
  artist: string
  album: string
  duration: string
}): Promise<LyricsResponse> {
  const { title, artist, album, duration } = query
  const lookupTitle = normalizeSongTitle(title) || title
  const lookupAlbum = normalizeSongTitle(album) || album

  const params = new URLSearchParams({ track_name: lookupTitle, artist_name: artist })
  if (lookupAlbum) params.set("album_name", lookupAlbum)
  if (duration) params.set("duration", duration)

  const res = await fetchLrcLib(`https://lrclib.net/api/get?${params.toString()}`)

  if (res.ok) {
    const data = await res.json()
    if (isLyricMatch(data, { title, artist, duration })) {
      return toLyricsResponse(data)
    }
  }

  const searchRes = await fetchLrcLib(
    `https://lrclib.net/api/search?track_name=${encodeURIComponent(lookupTitle)}&artist_name=${encodeURIComponent(artist)}`
  )

  if (searchRes.ok) {
    const results: any[] = await searchRes.json()
    const best = results
      .map((result) => ({ result, score: scoreLyricMatch(result, { title, artist, duration }) }))
      .filter((item) => item.score >= 4)
      .sort((a, b) => b.score - a.score)[0]?.result

    if (best) return toLyricsResponse(best)
  }

  return { plainLyrics: null, syncedLyrics: null, source: null }
}

async function fetchLrcLib(url: string): Promise<Response> {
  const dailyBudget = parsePositiveInt(process.env.LRCLIB_DAILY_REQUEST_BUDGET, 200)
  const perMinuteBudget = parsePositiveInt(process.env.LRCLIB_REQUESTS_PER_MINUTE, 10)

  if (!canSpendRequestBudget(LRCLIB_PROVIDER, 1, dailyBudget, perMinuteBudget)) {
    return new Response(null, { status: 429 })
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": process.env.LRCLIB_USER_AGENT || "Melodia/0.1 (self-hosted music player)",
      Accept: "application/json",
    },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(8000),
  })
  spendQuota(LRCLIB_PROVIDER, 1)
  return response
}

function toLyricsResponse(data: any): LyricsResponse {
  const hasData = Boolean(data?.syncedLyrics || data?.plainLyrics)

  return {
    plainLyrics: hasData ? data.plainLyrics ?? null : null,
    syncedLyrics: hasData ? data.syncedLyrics ?? null : null,
    source: hasData ? "lrclib" : null,
  }
}

function findLinkedTrack(input: {
  trackId: number | string | null
  videoId: string | null
  title: string
  artist: string
}): Track | null {
  const numericTrackId = Number(input.trackId)
  if (Number.isInteger(numericTrackId) && numericTrackId > 0) {
    const row = db.prepare("SELECT * FROM tracks WHERE id = ?").get(numericTrackId) as Track | null
    if (row) return row
  }

  if (input.videoId) {
    const row = db.prepare("SELECT * FROM tracks WHERE file_path = ?").get(`/api/youtube/stream/${input.videoId}`) as Track | null
    if (row) return row
  }

  const normalizedTitle = normalizeSongTitle(input.title)
  const normalizedArtist = normalizePerson(input.artist)
  if (!normalizedTitle) return null

  const rows = db.prepare(`
    SELECT * FROM tracks
    WHERE LOWER(title) = ?
    ORDER BY updated_at DESC
    LIMIT 20
  `).all(input.title.trim().toLowerCase()) as Track[]

  return rows.find((track) => {
    if (!normalizedArtist) return true
    return normalizePerson(track.artist || "") === normalizedArtist
  }) || null
}

function getStoredTrackLyrics(track: Track | null): LyricsResponse | null {
  if (!track?.lyrics_plain && !track?.lyrics_synced) return null

  return {
    plainLyrics: track.lyrics_plain || null,
    syncedLyrics: track.lyrics_synced || null,
    source: track.lyrics_source || "local",
  }
}

function persistTrackLyrics(trackId: number, lyrics: LyricsResponse, source: string) {
  if (!hasLyrics(lyrics)) return

  db.prepare(`
    UPDATE tracks SET
      lyrics_plain = COALESCE(?, lyrics_plain),
      lyrics_synced = COALESCE(?, lyrics_synced),
      lyrics_source = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(lyrics.plainLyrics, lyrics.syncedLyrics, source, trackId)
}

function hasLyrics(lyrics: LyricsResponse): boolean {
  return Boolean(lyrics.plainLyrics || lyrics.syncedLyrics)
}

function isLyricMatch(
  candidate: any,
  query: { title: string; artist: string; duration: string }
): boolean {
  return scoreLyricMatch(candidate, query) >= 4
}

function scoreLyricMatch(
  candidate: any,
  query: { title: string; artist: string; duration: string }
): number {
  const candidateTitle = normalizeSongTitle(candidate?.trackName || candidate?.name || "")
  const queryTitle = normalizeSongTitle(query.title)
  const candidateArtist = normalizePerson(candidate?.artistName || "")
  const queryArtist = normalizePerson(query.artist)
  const duration = Number(query.duration)
  const candidateDuration = Number(candidate?.duration)
  let score = 0

  if (candidateTitle && candidateTitle === queryTitle) score += 4
  else if (candidateTitle && queryTitle && (candidateTitle.includes(queryTitle) || queryTitle.includes(candidateTitle))) {
    score += 2
  }

  if (queryArtist && candidateArtist === queryArtist) score += 2
  else if (
    queryArtist &&
    candidateArtist &&
    (candidateArtist.includes(queryArtist) || queryArtist.includes(candidateArtist))
  ) {
    score += 1
  }

  if (
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(candidateDuration) &&
    Math.abs(candidateDuration - duration) <= 5
  ) {
    score += 1
  }

  if (candidate?.syncedLyrics) score += 1

  return score
}

function normalizePerson(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeDuration(value: number | string | null | undefined): number | null {
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
