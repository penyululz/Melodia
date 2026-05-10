import { NextRequest, NextResponse } from "next/server"
import db, { type YTTrack } from "@/lib/db"
import { getCachedJson, makeCacheKey, setCachedJson } from "@/lib/api-cache"
import {
  getHQThumbnail,
  getThumbnailWithFallback,
  searchYTMusicVideos,
  searchYouTubeDataApi,
  type YTSearchResult,
} from "@/lib/youtube-music"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ResolvedVideo = {
  videoId: string
  title: string
  artist: string
  duration: number | null
  thumbnailUrl: string | null
  thumbnailUrlHQ: string | null
  source: "saved-youtube-cache" | "youtube-music-videos" | "youtube-data-api"
  score: number
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const title = searchParams.get("title")?.trim() || ""
  const artist = searchParams.get("artist")?.trim() || ""
  const album = searchParams.get("album")?.trim() || ""
  const duration = Number(searchParams.get("duration") || "")
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : null

  if (!title && !artist) {
    return NextResponse.json({ video: null, error: "title or artist is required" }, { status: 400 })
  }

  const cacheKey = makeCacheKey("ytmusic-resolve-video", [
    normalizeSearchText(title),
    normalizeSearchText(artist),
    normalizeSearchText(album),
    safeDuration ? Math.round(safeDuration / 5) * 5 : null,
  ])
  const cached = getCachedJson<ResolvedVideo | null>(cacheKey)
  if (cached !== null) return NextResponse.json({ video: cached, source: "cache" })

  try {
    const saved = findSavedVideoCandidates(title, artist).map((result) => ({
      ...result,
      source: "saved-youtube-cache" as const,
    }))
    const savedMatch = pickBestVideo(saved, title, artist, safeDuration)
    if (savedMatch && savedMatch.score >= getResolveThreshold(title, artist, true)) {
      setCachedJson(cacheKey, savedMatch, getResolveCacheTtlSeconds())
      return NextResponse.json({ video: savedMatch, source: savedMatch.source })
    }

    const queries = buildResolveQueries(title, artist, album)
    const liveVideos = await searchVideoVariants(queries, title, artist, safeDuration)
    const bestLive = pickBestVideo(liveVideos, title, artist, safeDuration)

    if (bestLive && bestLive.score >= getResolveThreshold(title, artist, false)) {
      setCachedJson(cacheKey, bestLive, getResolveCacheTtlSeconds())
      return NextResponse.json({ video: bestLive, source: bestLive.source })
    }

    setCachedJson(cacheKey, null, getMissCacheTtlSeconds())
    return NextResponse.json({ video: null, source: "empty" })
  } catch (error) {
    console.error("[youtube-resolve-video] failed:", error)
    return NextResponse.json({ video: null, source: "error" })
  }
}

function findSavedVideoCandidates(title: string, artist: string): YTSearchResult[] {
  const normalizedTitle = normalizeSearchText(title)
  const normalizedArtist = normalizeSearchText(artist)
  const titleNeedle = normalizedTitle || title.toLowerCase().trim()
  const artistNeedle = normalizedArtist || artist.toLowerCase().trim()
  const titleTerm = `%${titleNeedle}%`
  const artistTerm = `%${artistNeedle}%`

  const rows = db.prepare(`
    SELECT *
    FROM yt_tracks
    WHERE (? != '' AND LOWER(title) LIKE ?)
       OR (? != '' AND LOWER(artist) LIKE ?)
    ORDER BY is_cached DESC, is_favorite DESC, play_count DESC, updated_at DESC
    LIMIT 20
  `).all(titleNeedle, titleTerm, artistNeedle, artistTerm) as YTTrack[]

  return rows.map((track) => ({
    videoId: track.video_id,
    title: track.title,
    artist: track.artist || "Unknown Artist",
    album: track.album,
    duration: track.duration,
    thumbnailUrl: track.thumbnail_url || getThumbnailWithFallback(track.video_id),
    thumbnailUrlHQ: track.thumbnail_url || getHQThumbnail(track.video_id),
    type: "video" as const,
    content_type: track.content_type === "podcast" ? "podcast" : "music",
  }))
}

async function searchVideoVariants(
  queries: string[],
  title: string,
  artist: string,
  duration: number | null
): Promise<Array<YTSearchResult & { source: ResolvedVideo["source"] }>> {
  const seen = new Set<string>()
  const results: Array<YTSearchResult & { source: ResolvedVideo["source"] }> = []

  for (const query of queries.slice(0, 3)) {
    const batch = await searchYTMusicVideos(query, 8)
    addUniqueResults(results, seen, batch, "youtube-music-videos")
    const bestMatch = pickBestVideo(results, title, artist, duration)
    if (bestMatch && bestMatch.score >= getResolveThreshold(title, artist, false)) {
      break
    }
  }

  const canUseOfficialApi =
    process.env.YOUTUBE_DATA_ALLOW_VIDEO_RESOLVE === "1" &&
    Boolean(process.env.YOUTUBE_DATA_API_KEY || process.env.GOOGLE_API_KEY)

  if (canUseOfficialApi) {
    for (const query of queries.slice(0, 2)) {
      const batch = await searchYouTubeDataApi(query, 5)
      addUniqueResults(results, seen, batch, "youtube-data-api")
    }
  }

  return results
}

function addUniqueResults(
  results: Array<YTSearchResult & { source: ResolvedVideo["source"] }>,
  seen: Set<string>,
  batch: YTSearchResult[],
  source: ResolvedVideo["source"]
) {
  for (const result of batch) {
    if (!result.videoId || seen.has(result.videoId)) continue
    seen.add(result.videoId)
    results.push({ ...result, source })
  }
}

function buildResolveQueries(title: string, artist: string, album: string): string[] {
  const core = [artist, title].filter(Boolean).join(" ").trim() || title || artist
  const variants = [
    `${core} official music video`,
    core,
    album ? `${artist} ${title} ${album}` : "",
  ]

  return uniqueNormalized(variants).slice(0, 3)
}

function pickBestVideo(
  results: Array<YTSearchResult & { source: ResolvedVideo["source"] }>,
  title: string,
  artist: string,
  duration: number | null
): ResolvedVideo | null {
  let best: ResolvedVideo | null = null

  for (const result of results) {
    const score = scoreVideoCandidate(result, title, artist, duration)
    if (!best || score > best.score) {
      best = {
        videoId: result.videoId,
        title: result.title,
        artist: result.artist || "Unknown Artist",
        duration: result.duration,
        thumbnailUrl: result.thumbnailUrl,
        thumbnailUrlHQ: result.thumbnailUrlHQ,
        source: result.source,
        score,
      }
    }
  }

  return best
}

function scoreVideoCandidate(
  result: YTSearchResult,
  title: string,
  artist: string,
  duration: number | null
): number {
  const wantedTitle = normalizeSongTitle(title)
  const candidateTitle = normalizeSongTitle(result.title)
  const wantedArtist = normalizeSearchText(artist)
  const candidateArtist = normalizeSearchText(result.artist)
  const titleScore = fuzzyTextScore(wantedTitle, candidateTitle)
  const artistScore = wantedArtist ? fuzzyTextScore(wantedArtist, candidateArtist) : 0.55
  const durationScore = scoreDurationMatch(duration, result.duration)
  const candidateText = `${result.title} ${result.artist}`.toLowerCase()
  const officialBoost = /\bofficial\b|\bmusic video\b|\bmv\b/.test(candidateText) ? 0.2 : 0
  const weakPenalty = /\b(cover|karaoke|reaction|tutorial|instrumental)\b/.test(candidateText) ? 0.35 : 0
  const livePenalty = /\b(live|concert|performance)\b/.test(candidateText) && !/\blive\b/.test(title.toLowerCase()) ? 0.2 : 0

  return titleScore * 1.7 + artistScore * 0.8 + durationScore * 0.45 + officialBoost - weakPenalty - livePenalty
}

function scoreDurationMatch(expected: number | null, actual: number | null | undefined): number {
  if (!expected || !actual || !Number.isFinite(actual)) return 0.2
  const diff = Math.abs(expected - actual)
  if (diff <= 8) return 1
  if (diff <= 20) return 0.75
  if (diff <= 45) return 0.45
  return 0
}

function getResolveThreshold(title: string, artist: string, saved: boolean): number {
  const hasTitle = normalizeSearchText(title).length > 0
  const hasArtist = normalizeSearchText(artist).length > 0
  if (hasTitle && hasArtist) return saved ? 1.75 : 1.9
  return saved ? 1.25 : 1.45
}

function normalizeSongTitle(value: string): string {
  return normalizeSearchText(
    value
      .replace(/\([^)]*\)/g, " ")
      .replace(/\[[^\]]*]/g, " ")
      .replace(/\b(official|music video|video|audio|lyrics?|visualizer|hd|4k|mv)\b/gi, " ")
  )
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

function getResolveCacheTtlSeconds(): number {
  const hours = Number.parseInt(process.env.YOUTUBE_VIDEO_RESOLVE_CACHE_TTL_HOURS || "168", 10)
  return Math.max(1, Number.isFinite(hours) ? hours : 168) * 3600
}

function getMissCacheTtlSeconds(): number {
  const hours = Number.parseInt(process.env.YOUTUBE_VIDEO_RESOLVE_MISS_CACHE_TTL_HOURS || "12", 10)
  return Math.max(1, Number.isFinite(hours) ? hours : 12) * 3600
}
