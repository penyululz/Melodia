import "server-only"
import YTMusic from "ytmusic-api"
import {
  canSpendRequestBudget,
  getCachedJson,
  makeCacheKey,
  setCachedJson,
  spendQuota,
} from "@/lib/api-cache"
import { detectLibraryContentType } from "@/lib/metadata"

// Initialize YouTube Music API
let ytmusic: YTMusic | null = null

async function getYTMusic(): Promise<YTMusic> {
  if (!ytmusic) {
    ytmusic = new YTMusic()
    await ytmusic.initialize()
  }
  return ytmusic
}

export interface YTSearchResult {
  videoId: string
  title: string
  artist: string
  album: string | null
  duration: number | null
  thumbnailUrl: string | null
  thumbnailUrlHQ: string | null
  type: "song" | "video"
  content_type?: "music" | "podcast"
  podcast_title?: string | null
  podcast_author?: string | null
}

/**
 * Get the highest quality thumbnail URL for a video
 */
export function getHQThumbnail(videoId: string): string {
  // YouTube thumbnail URLs in order of quality
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
}

export function getThumbnailWithFallback(videoId: string): string {
  // hqdefault is always available, maxresdefault might not be
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

export interface YTPlaylistInfo {
  playlistId: string
  name: string
  description: string | null
  thumbnailUrl: string | null
  trackCount: number
  tracks: YTSearchResult[]
}

/**
 * Search YouTube Music for tracks
 */
export async function searchYTMusic(query: string, limit = 20): Promise<YTSearchResult[]> {
  try {
    const cacheKey = makeCacheKey("ytmusic-search", [query.trim().toLowerCase(), limit])
    const cached = getCachedJson<YTSearchResult[]>(cacheKey)
    if (cached) return cached

    const provider = "ytmusic-web"
    const dailyBudget = Number.parseInt(process.env.YTMUSIC_WEB_DAILY_REQUEST_BUDGET || "500", 10)
    const perMinuteBudget = Number.parseInt(process.env.YTMUSIC_WEB_REQUESTS_PER_MINUTE || "20", 10)
    if (!canSpendRequestBudget(
      provider,
      1,
      Number.isFinite(dailyBudget) ? dailyBudget : 500,
      Number.isFinite(perMinuteBudget) ? perMinuteBudget : 20
    )) return []

    const yt = await getYTMusic()
    const results = await yt.searchSongs(query)
    spendQuota(provider, 1)

    const mapped = results.slice(0, limit).map((song) =>
      withContentType({
        videoId: song.videoId,
        title: song.name,
        artist: song.artist?.name || "Unknown Artist",
        album: song.album?.name || null,
        duration: song.duration || null,
        thumbnailUrl: getThumbnailWithFallback(song.videoId),
        thumbnailUrlHQ: getHQThumbnail(song.videoId),
        type: "song" as const,
      })
    )
    setCachedJson(cacheKey, mapped, getSearchCacheTtlSeconds())
    return mapped
  } catch (error) {
    console.error("[v0] YouTube Music search error:", error)
    return []
  }
}

export async function searchYouTubeDataApi(query: string, limit = 20): Promise<YTSearchResult[]> {
  const apiKey = process.env.YOUTUBE_DATA_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) return []

  const safeLimit = Math.min(Math.max(limit, 1), 10)
  const cacheKey = makeCacheKey("youtube-data-search", [query.trim().toLowerCase(), safeLimit])
  const cached = getCachedJson<YTSearchResult[]>(cacheKey)
  if (cached) return cached

  const provider = "youtube-data-api"
  const dailyBudget = Number.parseInt(process.env.YOUTUBE_DATA_DAILY_SEARCH_BUDGET || "1000", 10)
  const perMinuteBudget = Number.parseInt(process.env.YOUTUBE_DATA_REQUESTS_PER_MINUTE || "5", 10)
  const searchCost = 100
  if (!canSpendRequestBudget(
    provider,
    searchCost,
    Number.isFinite(dailyBudget) ? dailyBudget : 1000,
    Number.isFinite(perMinuteBudget) ? perMinuteBudget : 5
  )) {
    return []
  }

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search")
    url.searchParams.set("key", apiKey)
    url.searchParams.set("part", "snippet")
    url.searchParams.set("type", "video")
    url.searchParams.set("videoCategoryId", "10")
    url.searchParams.set("maxResults", String(safeLimit))
    url.searchParams.set("q", query)

    const response = await fetch(url, { signal: AbortSignal.timeout(4500) })
    spendQuota(provider, searchCost)
    if (!response.ok) return []

    const data = await response.json()
    const mapped = ((data.items || []) as any[])
      .map((item) => {
        const videoId = item?.id?.videoId
        const snippet = item?.snippet
        if (!videoId || !snippet?.title) return null
        return withContentType({
          videoId,
          title: decodeHtml(snippet.title),
          artist: decodeHtml(snippet.channelTitle || "Unknown Artist"),
          album: null,
          duration: null,
          thumbnailUrl: snippet.thumbnails?.high?.url || getThumbnailWithFallback(videoId),
          thumbnailUrlHQ: snippet.thumbnails?.maxres?.url || getHQThumbnail(videoId),
          type: "video" as const,
        })
      })
      .filter(Boolean) as YTSearchResult[]

    setCachedJson(cacheKey, mapped, getSearchCacheTtlSeconds())
    return mapped
  } catch (error) {
    console.error("[youtube-data-api] search error:", error)
    return []
  }
}

/**
 * Get playlist details and tracks
 */
export async function getYTPlaylist(playlistId: string): Promise<YTPlaylistInfo | null> {
  try {
    const cacheKey = makeCacheKey("ytmusic-playlist", [playlistId])
    const cached = getCachedJson<YTPlaylistInfo>(cacheKey)
    if (cached) return cached

    const yt = await getYTMusic()
    const playlist = await yt.getPlaylist(playlistId)

    if (!playlist) return null

    const tracks: YTSearchResult[] = ((playlist as any).tracks || []).map((track: any) =>
      withContentType({
        videoId: track.videoId,
        title: track.name,
        artist: track.artist?.name || "Unknown Artist",
        album: track.album?.name || null,
        duration: track.duration || null,
        thumbnailUrl: getThumbnailWithFallback(track.videoId),
        thumbnailUrlHQ: getHQThumbnail(track.videoId),
        type: "song" as const,
      })
    )

    const result = {
      playlistId,
      name: playlist.name,
      description: (playlist as any).description || null,
      thumbnailUrl: playlist.thumbnails?.[0]?.url || null,
      trackCount: tracks.length,
      tracks,
    }
    setCachedJson(cacheKey, result, getPlaylistCacheTtlSeconds())
    return result
  } catch (error) {
    console.error("[v0] YouTube Music playlist fetch error:", error)
    return null
  }
}

function getSearchCacheTtlSeconds(): number {
  const hours = Number.parseInt(process.env.YOUTUBE_SEARCH_CACHE_TTL_HOURS || "24", 10)
  return Math.max(1, Number.isFinite(hours) ? hours : 24) * 3600
}

function getPlaylistCacheTtlSeconds(): number {
  const hours = Number.parseInt(process.env.YOUTUBE_PLAYLIST_CACHE_TTL_HOURS || "12", 10)
  return Math.max(1, Number.isFinite(hours) ? hours : 12) * 3600
}

function withContentType<T extends YTSearchResult>(result: T): T {
  const contentType = detectLibraryContentType({
    title: result.title,
    artist: result.artist,
    album: result.album,
  })

  return {
    ...result,
    content_type: contentType,
    podcast_title: contentType === "podcast" ? result.album || result.title : null,
    podcast_author: contentType === "podcast" ? result.artist : null,
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

/**
 * Get suggestions/recommendations based on a video
 */
export async function getYTSuggestions(videoId: string): Promise<YTSearchResult[]> {
  try {
    const yt = await getYTMusic()
    const suggestions = await (yt as any).getSuggestions(videoId)

    return (suggestions || []).slice(0, 10).map((song: any) =>
      withContentType({
        videoId: song.videoId,
        title: song.name,
        artist: song.artist?.name || "Unknown Artist",
        album: song.album?.name || null,
        duration: song.duration || null,
        thumbnailUrl: getThumbnailWithFallback(song.videoId),
        thumbnailUrlHQ: getHQThumbnail(song.videoId),
        type: "song" as const,
      })
    )
  } catch (error) {
    console.error("[v0] YouTube Music suggestions error:", error)
    return []
  }
}

/**
 * Get song details by video ID
 */
export async function getYTSongDetails(videoId: string): Promise<YTSearchResult | null> {
  try {
    const yt = await getYTMusic()
    const song = await yt.getSong(videoId)

    if (!song) return null

    return withContentType({
      videoId: song.videoId,
      title: song.name,
      artist: song.artist?.name || "Unknown Artist",
      album: (song as any).album?.name || null,
      duration: song.duration || null,
      thumbnailUrl: getThumbnailWithFallback(song.videoId),
      thumbnailUrlHQ: getHQThumbnail(song.videoId),
      type: "song" as const,
    })
  } catch (error) {
    console.error("[v0] YouTube Music song details error:", error)
    return null
  }
}

/**
 * Get streaming URL for a video
 * Note: This returns a proxy URL that streams from YouTube
 */
export function getStreamUrl(videoId: string): string {
  return `/api/youtube/stream/${videoId}`
}

/**
 * Extract playlist ID from various YouTube Music URL formats
 */
export function extractPlaylistId(url: string): string | null {
  const patterns = [
    /[?&]list=([a-zA-Z0-9_-]+)/,
    /playlist\/([a-zA-Z0-9_-]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  // If it's already just an ID
  if (/^[a-zA-Z0-9_-]+$/.test(url)) {
    return url
  }

  return null
}
