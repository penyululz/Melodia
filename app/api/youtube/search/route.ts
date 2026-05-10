import { NextRequest, NextResponse } from "next/server"
import db, { type Track, type YTTrack } from "@/lib/db"
import { getSessionOrDemo, isDemoSessionEnabled } from "@/lib/auth-policy"
import { getDemoYouTubeSearchResults } from "@/lib/demo-data"
import {
  buildTasteProfile,
  rankYouTubeSearchResults,
  recordSearchSignal,
} from "@/lib/recommendation-engine"
import { searchYTMusic, searchYouTubeDataApi, type YTSearchResult } from "@/lib/youtube-music"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get("q")?.trim()
  const limit = Number.parseInt(searchParams.get("limit") || "20", 10)
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 20

  if (!query) {
    return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 })
  }

  try {
    const user = await getSessionOrDemo(request)
    const localTracks = db.prepare("SELECT * FROM tracks ORDER BY created_at DESC").all() as Track[]
    const ytTracks = db.prepare("SELECT * FROM yt_tracks ORDER BY created_at DESC").all() as YTTrack[]
    const profile = buildTasteProfile(user?.id ?? null, localTracks, ytTracks, request)
    const savedResults = searchSavedYouTubeTracks(query, safeLimit)
    const liveSearchQueries = buildLiveSearchQueries(query, localTracks, ytTracks)

    const preferOfficialApi =
      request.headers.get("x-melodia-use-official-youtube") === "true" ||
      process.env.YOUTUBE_API_PREFER_OFFICIAL === "1"

    if (preferOfficialApi) {
      const officialResults = await searchYouTubeDataApiVariants(liveSearchQueries.slice(0, 2), safeLimit)
      const mergedResults = mergeSavedAndLiveResults(savedResults, officialResults, safeLimit)
      if (mergedResults.length > 0) {
        const results = rankYouTubeSearchResults(mergedResults, query, profile)
        recordSearchSignal(user?.id ?? null, query, "youtube", results.length, request)
        return NextResponse.json({ results, source: "youtube-data-api" })
      }
    }

    const liveResults = await searchYTMusicVariants(liveSearchQueries, safeLimit)
    const mergedResults = mergeSavedAndLiveResults(savedResults, liveResults, safeLimit)
    if (mergedResults.length > 0) {
      const results = rankYouTubeSearchResults(mergedResults, query, profile)
      recordSearchSignal(user?.id ?? null, query, "youtube", results.length, request)
      return NextResponse.json({ results, source: liveResults.length > 0 ? "youtube-music" : "saved-youtube-cache" })
    }
  } catch (error) {
    console.error("[v0] YouTube Music live search failed:", error)
  }

  if (!isDemoSessionEnabled()) {
    return NextResponse.json({
      results: [],
      source: "empty",
      message: "No saved YouTube results and live search is unavailable.",
    })
  }

  const user = await getSessionOrDemo(request)
  const localTracks = db.prepare("SELECT * FROM tracks ORDER BY created_at DESC").all() as Track[]
  const ytTracks = db.prepare("SELECT * FROM yt_tracks ORDER BY created_at DESC").all() as YTTrack[]
  const profile = buildTasteProfile(user?.id ?? null, localTracks, ytTracks, request)
  const results = rankYouTubeSearchResults(getDemoYouTubeSearchResults(query, safeLimit), query, profile)
  recordSearchSignal(user?.id ?? null, query, "youtube", results.length, request)

  return NextResponse.json({
    results,
    source: "demo-fallback",
  })
}

async function searchYTMusicVariants(queries: string[], limit: number) {
  const results: YTSearchResult[] = []
  const seen = new Set<string>()
  const perQueryLimit = Math.min(20, Math.max(limit, 8))

  for (const query of queries.slice(0, 3)) {
    const batch = await searchYTMusic(query, perQueryLimit)
    for (const result of batch) {
      if (seen.has(result.videoId)) continue
      seen.add(result.videoId)
      results.push(result)
      if (results.length >= limit * 2) break
    }
    if (results.length >= limit * 2) break
  }

  return results
}

async function searchYouTubeDataApiVariants(queries: string[], limit: number) {
  const results: YTSearchResult[] = []
  const seen = new Set<string>()
  const perQueryLimit = Math.min(10, Math.max(limit, 5))

  for (const query of queries.slice(0, 2)) {
    const batch = await searchYouTubeDataApi(query, perQueryLimit)
    for (const result of batch) {
      if (seen.has(result.videoId)) continue
      seen.add(result.videoId)
      results.push(result)
      if (results.length >= limit * 2) break
    }
    if (results.length >= limit * 2) break
  }

  return results
}

function buildLiveSearchQueries(query: string, localTracks: Track[], ytTracks: YTTrack[]): string[] {
  const variants = [query.trim()]
  const artistMatch = findClosestKnownArtist(query, localTracks, ytTracks)

  if (artistMatch && normalizeSearchText(artistMatch) !== normalizeSearchText(query)) {
    variants.push(artistMatch)
    variants.push(`${artistMatch} songs`)
  } else if (query.trim().split(/\s+/).length <= 3) {
    variants.push(`${query.trim()} songs`)
    variants.push(`${query.trim()} music`)
  }

  return uniqueNormalized(variants).slice(0, 3)
}

function findClosestKnownArtist(query: string, localTracks: Track[], ytTracks: YTTrack[]): string | null {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery || normalizedQuery.length < 2) return null

  const artistCounts = new Map<string, number>()
  for (const artist of [
    ...localTracks.map((track) => track.artist),
    ...ytTracks.map((track) => track.artist),
  ]) {
    const cleanArtist = cleanArtistName(artist)
    if (!cleanArtist) continue
    artistCounts.set(cleanArtist, (artistCounts.get(cleanArtist) || 0) + 1)
  }

  let bestArtist: string | null = null
  let bestScore = 0

  for (const [artist, count] of artistCounts) {
    const normalizedArtist = normalizeSearchText(artist)
    const score = fuzzyTextScore(normalizedQuery, normalizedArtist) + Math.min(0.1, count * 0.01)
    if (score > bestScore) {
      bestArtist = artist
      bestScore = score
    }
  }

  return bestScore >= 0.72 ? bestArtist : null
}

function cleanArtistName(value: string | null | undefined): string | null {
  const artist = value?.trim()
  if (!artist || /^unknown artist$/i.test(artist)) return null
  return artist
}

function uniqueNormalized(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    const normalized = normalizeSearchText(trimmed)
    if (!trimmed || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(trimmed)
  }

  return unique
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function fuzzyTextScore(query: string, candidate: string): number {
  if (!query || !candidate) return 0
  if (query === candidate) return 1
  if (candidate.includes(query) || query.includes(candidate)) return 0.9

  const queryTokens = query.split(/\s+/).filter(Boolean)
  const candidateTokens = candidate.split(/\s+/).filter(Boolean)
  if (!queryTokens.length || !candidateTokens.length) return 0

  const scores = queryTokens.map((queryToken) => {
    return Math.max(...candidateTokens.map((candidateToken) => tokenSimilarity(queryToken, candidateToken)))
  })

  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  if (a.includes(b) || b.includes(a)) return 0.85

  const distance = levenshteinDistance(a, b)
  return 1 - distance / Math.max(a.length, b.length)
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  const current = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      )
    }
    previous.splice(0, previous.length, ...current)
  }

  return previous[b.length]
}

function searchSavedYouTubeTracks(query: string, limit: number) {
  const term = `%${query.toLowerCase()}%`
  const rows = db.prepare(`
    SELECT * FROM yt_tracks
    WHERE LOWER(title) LIKE ?
      OR LOWER(artist) LIKE ?
      OR LOWER(album) LIKE ?
      OR LOWER(podcast_title) LIKE ?
      OR LOWER(podcast_author) LIKE ?
      OR LOWER(podcast_description) LIKE ?
    ORDER BY is_cached DESC, is_favorite DESC, play_count DESC, updated_at DESC
    LIMIT ?
  `).all(term, term, term, term, term, term, limit) as YTTrack[]

  return rows.map((track) => ({
    videoId: track.video_id,
    title: track.title,
    artist: track.artist || "Unknown Artist",
    album: track.album,
    duration: track.duration,
    thumbnailUrl: track.thumbnail_url,
    thumbnailUrlHQ: track.thumbnail_url,
    type: "song" as const,
    content_type: (track.content_type === "podcast" ? "podcast" : "music") as "music" | "podcast",
    podcast_title: track.podcast_title,
    podcast_author: track.podcast_author,
  }))
}

function mergeSavedAndLiveResults<T extends { videoId: string }>(
  savedResults: T[],
  liveResults: T[],
  limit: number
): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  const savedLeadCount = liveResults.length > 0
    ? Math.min(savedResults.length, Math.max(1, Math.floor(limit / 3)))
    : savedResults.length

  const candidates = [
    ...savedResults.slice(0, savedLeadCount),
    ...liveResults,
    ...savedResults.slice(savedLeadCount),
  ]

  for (const result of candidates) {
    if (seen.has(result.videoId)) continue
    seen.add(result.videoId)
    merged.push(result)
    if (merged.length >= limit) break
  }

  return merged
}
