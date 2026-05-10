import { NextRequest, NextResponse } from "next/server"
import db, { type Track, type YTTrack } from "@/lib/db"
import { getSessionOrDemo, isDemoSessionEnabled } from "@/lib/auth-policy"
import { getDemoYouTubeSearchResults } from "@/lib/demo-data"
import {
  buildTasteProfile,
  rankYouTubeSearchResults,
  recordSearchSignal,
} from "@/lib/recommendation-engine"
import { searchYTMusic, searchYouTubeDataApi } from "@/lib/youtube-music"

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
    if (savedResults.length >= safeLimit) {
      const results = rankYouTubeSearchResults(savedResults, query, profile)
      recordSearchSignal(user?.id ?? null, query, "youtube", results.length, request)
      return NextResponse.json({ results, source: "saved-youtube-cache" })
    }

    const preferOfficialApi =
      request.headers.get("x-melodia-use-official-youtube") === "true" ||
      process.env.YOUTUBE_API_PREFER_OFFICIAL === "1"

    if (preferOfficialApi) {
      const officialResults = await searchYouTubeDataApi(query, safeLimit)
      const mergedResults = mergeSavedAndLiveResults(savedResults, officialResults, safeLimit)
      if (mergedResults.length > 0) {
        const results = rankYouTubeSearchResults(mergedResults, query, profile)
        recordSearchSignal(user?.id ?? null, query, "youtube", results.length, request)
        return NextResponse.json({ results, source: "youtube-data-api" })
      }
    }

    const liveResults = await searchYTMusic(query, safeLimit)
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

  for (const result of [...savedResults, ...liveResults]) {
    if (seen.has(result.videoId)) continue
    seen.add(result.videoId)
    merged.push(result)
    if (merged.length >= limit) break
  }

  return merged
}
