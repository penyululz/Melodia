import { NextRequest, NextResponse } from "next/server"
import db, { queries, YTTrack } from "@/lib/db"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"
import { removePromotedYouTubeTrack } from "@/lib/local-library"
import { isAllowedServedMediaPath, safeUnlink } from "@/lib/file-safety"

type RouteParams = { params: Promise<{ videoId: string }> }

// GET - Get a specific YouTube track
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { videoId } = await params
    
    const track = queries.getYTTrackByVideoId.get(videoId) as YTTrack | null
    
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    return NextResponse.json({ track })
  } catch (error) {
    console.error("[v0] Get YT track error:", error)
    return NextResponse.json({ error: "Failed to get track" }, { status: 500 })
  }
}

// PATCH - Update track (toggle favorite, increment play count)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await requireMutationAuth(request)
    const { videoId } = await params
    const body = await request.json()
    const { action } = body

    const track = queries.getYTTrackByVideoId.get(videoId) as YTTrack | null
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    switch (action) {
      case "toggleFavorite":
        queries.toggleYTFavorite.run(videoId)
        break
      case "incrementPlayCount":
        queries.incrementYTPlayCount.run(videoId)
        break
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    const updatedTrack = queries.getYTTrackByVideoId.get(videoId) as YTTrack
    if (action === "toggleFavorite") {
      db.prepare(`
        UPDATE tracks
        SET is_favorite = ?, updated_at = datetime('now')
        WHERE file_path = ?
      `).run(updatedTrack.is_favorite ? 1 : 0, `/api/youtube/stream/${videoId}`)
    }

    return NextResponse.json({ track: updatedTrack })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] Update YT track error:", error)
    return NextResponse.json({ error: "Failed to update track" }, { status: 500 })
  }
}

// DELETE - Remove a saved YouTube track from the native library.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await requireMutationAuth(request)
    const { videoId } = await params

    const track = queries.getYTTrackByVideoId.get(videoId) as YTTrack | null
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    if (track.cached_file_path && isAllowedServedMediaPath(track.cached_file_path)) {
      safeUnlink(track.cached_file_path)
    }

    removePromotedYouTubeTrack(videoId)
    db.prepare("DELETE FROM listen_history WHERE yt_video_id = ?").run(videoId)
    db.prepare("DELETE FROM track_feedback WHERE yt_video_id = ?").run(videoId)
    db.prepare("DELETE FROM playlist_youtube_tracks WHERE yt_track_id = ?").run(track.id)
    db.prepare("DELETE FROM yt_playlist_tracks WHERE yt_track_id = ?").run(track.id)
    db.prepare("DELETE FROM yt_tracks WHERE video_id = ?").run(videoId)

    return NextResponse.json({ success: true })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] Delete YT track error:", error)
    return NextResponse.json({ error: "Failed to remove track" }, { status: 500 })
  }
}
