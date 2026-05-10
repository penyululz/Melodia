import { NextResponse } from "next/server"
import db from "@/lib/db"
import { isDemoSessionEnabled } from "@/lib/auth-policy"
import { getDemoStats } from "@/lib/demo-data"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const local = db.prepare(`
      SELECT
        COUNT(*) as total_tracks,
        COALESCE(SUM(duration), 0) as total_duration,
        COUNT(DISTINCT NULLIF(artist, '')) as total_artists,
        COUNT(DISTINCT NULLIF(album, '')) as total_albums,
        COALESCE(SUM(is_favorite), 0) as total_favorites,
        COALESCE(SUM(play_count), 0) as total_plays,
        SUM(CASE WHEN COALESCE(content_type, 'music') = 'podcast' THEN 1 ELSE 0 END) as podcast_tracks
      FROM tracks
    `).get() as any

    const youtube = db.prepare(`
      SELECT
        COUNT(*) as yt_tracks,
        COALESCE(SUM(duration), 0) as yt_duration,
        COUNT(DISTINCT NULLIF(artist, '')) as yt_artists,
        COUNT(DISTINCT NULLIF(album, '')) as yt_albums,
        COALESCE(SUM(is_favorite), 0) as yt_favorites,
        COALESCE(SUM(play_count), 0) as yt_plays,
        COALESCE(SUM(is_cached), 0) as cached_yt_tracks,
        SUM(CASE WHEN COALESCE(content_type, 'music') = 'podcast' THEN 1 ELSE 0 END) as yt_podcast_tracks
      FROM yt_tracks
    `).get() as any

    const localTracks = Number(local?.total_tracks || 0)
    const ytTracks = Number(youtube?.yt_tracks || 0)

    if (localTracks + ytTracks === 0) {
      return NextResponse.json({ stats: isDemoSessionEnabled() ? getDemoStats() : emptyStats() })
    }

    return NextResponse.json({
      stats: {
        total_tracks: localTracks + ytTracks,
        local_tracks: localTracks,
        yt_tracks: ytTracks,
        cached_yt_tracks: Number(youtube?.cached_yt_tracks || 0),
        total_duration: Number(local?.total_duration || 0) + Number(youtube?.yt_duration || 0),
        total_artists: Number(local?.total_artists || 0) + Number(youtube?.yt_artists || 0),
        total_albums: Number(local?.total_albums || 0) + Number(youtube?.yt_albums || 0),
        total_favorites: Number(local?.total_favorites || 0) + Number(youtube?.yt_favorites || 0),
        total_plays: Number(local?.total_plays || 0) + Number(youtube?.yt_plays || 0),
        podcast_tracks: Number(local?.podcast_tracks || 0) + Number(youtube?.yt_podcast_tracks || 0),
      },
    })
  } catch (error) {
    console.error("Error fetching stats:", error)
    if (isDemoSessionEnabled()) return NextResponse.json({ stats: getDemoStats() })
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}

function emptyStats() {
  return {
    total_tracks: 0,
    local_tracks: 0,
    yt_tracks: 0,
    cached_yt_tracks: 0,
    total_duration: 0,
    total_artists: 0,
    total_albums: 0,
    total_favorites: 0,
    total_plays: 0,
    podcast_tracks: 0,
  }
}
