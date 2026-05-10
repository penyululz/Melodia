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

    const mapped = results.slice(0, limit).map((song) => {
      const thumbnail = getBestThumbnail((song as any).thumbnails) || getThumbnailWithFallback(song.videoId)
      return withContentType({
        videoId: song.videoId,
        title: song.name,
        artist: song.artist?.name || "Unknown Artist",
        album: song.album?.name || null,
        duration: song.duration || null,
        thumbnailUrl: thumbnail,
        thumbnailUrlHQ: thumbnail,
        type: "song" as const,
      })
    })
    setCachedJson(cacheKey, mapped, getSearchCacheTtlSeconds())
    return mapped
  } catch (error) {
    console.error("[v0] YouTube Music search error:", error)
    return []
  }
}

export async function searchYTMusicVideos(query: string, limit = 10): Promise<YTSearchResult[]> {
  try {
    const safeLimit = Math.min(Math.max(limit, 1), 20)
    const cacheKey = makeCacheKey("ytmusic-video-search", [query.trim().toLowerCase(), safeLimit])
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
    const results = await yt.searchVideos(query)
    spendQuota(provider, 1)

    const mapped = results.slice(0, safeLimit).map((video) => {
      const thumbnail = video.thumbnails?.[video.thumbnails.length - 1]?.url || getThumbnailWithFallback(video.videoId)
      return withContentType({
        videoId: video.videoId,
        title: video.name,
        artist: video.artist?.name || "Unknown Artist",
        album: null,
        duration: video.duration || null,
        thumbnailUrl: thumbnail,
        thumbnailUrlHQ: thumbnail,
        type: "video" as const,
      })
    })
    setCachedJson(cacheKey, mapped, getSearchCacheTtlSeconds())
    return mapped
  } catch (error) {
    console.error("[v0] YouTube Music video search error:", error)
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
        const thumbnail =
          snippet.thumbnails?.high?.url ||
          snippet.thumbnails?.medium?.url ||
          snippet.thumbnails?.default?.url ||
          getThumbnailWithFallback(videoId)
        return withContentType({
          videoId,
          title: decodeHtml(snippet.title),
          artist: decodeHtml(snippet.channelTitle || "Unknown Artist"),
          album: null,
          duration: null,
          thumbnailUrl: thumbnail,
          thumbnailUrlHQ: thumbnail,
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
    const cacheKey = makeCacheKey("ytmusic-playlist-v2", [playlistId])
    const cached = getCachedJson<YTPlaylistInfo>(cacheKey)
    if (cached) return cached

    const yt = await getYTMusic()
    const [playlist, playlistVideos] = await Promise.all([
      yt.getPlaylist(playlistId),
      yt.getPlaylistVideos(playlistId).catch((error) => {
        console.warn("[v0] YouTube Music playlist videos fetch error:", error)
        return []
      }),
    ])

    if (!playlist) return null

    const playlistAny = playlist as any
    const rawTracks: any[] =
      Array.isArray(playlistAny.tracks) && playlistAny.tracks.length > 0
        ? playlistAny.tracks
        : Array.isArray(playlistVideos)
          ? playlistVideos
          : []
    const tracks = rawTracks
      .map(toYTPlaylistTrack)
      .filter((track): track is YTSearchResult => Boolean(track))

    const result = {
      playlistId,
      name: playlist.name,
      description: playlistAny.description || null,
      thumbnailUrl: getBestThumbnail(playlist.thumbnails),
      trackCount: tracks.length || playlistAny.videoCount || 0,
      tracks,
    }
    setCachedJson(cacheKey, result, getPlaylistCacheTtlSeconds())
    return result
  } catch (error) {
    console.error("[v0] YouTube Music playlist fetch error:", error)
    return null
  }
}

function toYTPlaylistTrack(track: any): YTSearchResult | null {
  const videoId = cleanString(track.videoId || track.id || track.video_id)
  if (!videoId) return null

  const title = cleanString(track.name || track.title)
  if (!title) return null

  const artist = getArtistName(track.artist || track.artists || track.author || track.uploader)
  const album = cleanString(track.album?.name || track.album || track.playlistTitle)
  const thumbnail = getBestThumbnail(track.thumbnails || track.thumbnail)

  return withContentType({
    videoId,
    title,
    artist: artist || "Unknown Artist",
    album,
    duration: getDurationSeconds(track.duration || track.durationSeconds || track.lengthSeconds),
    thumbnailUrl: thumbnail || getThumbnailWithFallback(videoId),
    thumbnailUrlHQ: thumbnail || getThumbnailWithFallback(videoId),
    type: track.type === "VIDEO" || track.type === "video" ? "video" : "song",
  })
}

function getArtistName(value: any): string | null {
  if (typeof value === "string") return cleanString(value)
  if (Array.isArray(value)) {
    return cleanString(value.map((item) => item?.name || item).filter(Boolean).join(", "))
  }
  return cleanString(value?.name || value?.title)
}

function getBestThumbnail(value: any): string | null {
  if (typeof value === "string") return cleanString(value)
  if (!Array.isArray(value) || value.length === 0) return null

  const sorted = [...value].sort((left, right) => Number(right?.width || 0) - Number(left?.width || 0))
  return cleanString(sorted[0]?.url)
}

function getDurationSeconds(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
  if (typeof value !== "string") return null

  const parts = value.split(":").map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => !Number.isFinite(part))) return null

  return parts.reduce((total, part) => total * 60 + part, 0)
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function getSearchCacheTtlSeconds(): number {
  const hours = Number.parseInt(process.env.YOUTUBE_SEARCH_CACHE_TTL_HOURS || "24", 10)
  return Math.max(1, Number.isFinite(hours) ? hours : 24) * 3600
}

function getPlaylistCacheTtlSeconds(): number {
  const hours = Number.parseInt(process.env.YOUTUBE_PLAYLIST_CACHE_TTL_HOURS || "12", 10)
  return Math.max(1, Number.isFinite(hours) ? hours : 12) * 3600
}

function getSongDetailsCacheTtlSeconds(): number {
  const days = Number.parseInt(process.env.YOUTUBE_SONG_DETAILS_CACHE_TTL_DAYS || "30", 10)
  return Math.max(1, Number.isFinite(days) ? days : 30) * 86_400
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

    return (suggestions || []).slice(0, 10).map((song: any) => {
      const thumbnail = getBestThumbnail(song.thumbnails) || getThumbnailWithFallback(song.videoId)
      return withContentType({
        videoId: song.videoId,
        title: song.name,
        artist: song.artist?.name || "Unknown Artist",
        album: song.album?.name || null,
        duration: song.duration || null,
        thumbnailUrl: thumbnail,
        thumbnailUrlHQ: thumbnail,
        type: "song" as const,
      })
    })
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
    const cacheKey = makeCacheKey("ytmusic-song-details", [videoId])
    const cached = getCachedJson<YTSearchResult | null>(cacheKey)
    if (cached !== null) return cached

    const provider = "ytmusic-web-song-details"
    const dailyBudget = Number.parseInt(process.env.YTMUSIC_WEB_DAILY_REQUEST_BUDGET || "500", 10)
    const perMinuteBudget = Number.parseInt(process.env.YTMUSIC_WEB_REQUESTS_PER_MINUTE || "20", 10)
    if (!canSpendRequestBudget(
      provider,
      1,
      Number.isFinite(dailyBudget) ? dailyBudget : 500,
      Number.isFinite(perMinuteBudget) ? perMinuteBudget : 20
    )) return null

    const yt = await getYTMusic()
    const song = await yt.getSong(videoId)
    spendQuota(provider, 1)

    if (!song) return null

    const thumbnail = getBestThumbnail((song as any).thumbnails) || getThumbnailWithFallback(song.videoId)

    const result = withContentType({
      videoId: song.videoId,
      title: song.name,
      artist: song.artist?.name || "Unknown Artist",
      album: (song as any).album?.name || null,
      duration: song.duration || null,
      thumbnailUrl: thumbnail,
      thumbnailUrlHQ: thumbnail,
      type: "song" as const,
    })
    setCachedJson(cacheKey, result, getSongDetailsCacheTtlSeconds())
    return result
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
