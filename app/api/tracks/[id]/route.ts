import { NextRequest, NextResponse } from "next/server"
import db, { queries, type Track } from "@/lib/db"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"
import { getOwnedTrackFilePaths, safeUnlink } from "@/lib/file-safety"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const trackId = parseInt(id, 10)

  if (isNaN(trackId)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 })
  }

  try {
    const track = queries.getTrackById.get(trackId)

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    return NextResponse.json({ track })
  } catch (error) {
    console.error("Error fetching track:", error)
    return NextResponse.json(
      { error: "Failed to fetch track" },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const trackId = parseInt(id, 10)

  if (isNaN(trackId)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 })
  }

  try {
    await requireMutationAuth(request)
    const body = await request.json()
    const {
      title,
      artist,
      album,
      genre,
      year,
      favorite,
      contentType,
      podcastTitle,
      podcastAuthor,
      podcastEpisodeNumber,
      podcastSeasonNumber,
      podcastDescription,
      podcastPublishedAt,
    } = body

    if (favorite !== undefined) {
      queries.toggleFavorite.run(trackId)
    } else {
      const track = queries.getTrackById.get(trackId)
      if (!track) {
        return NextResponse.json({ error: "Track not found" }, { status: 404 })
      }

      queries.updateTrack.run(
        title ?? track.title,
        artist ?? track.artist,
        album ?? track.album,
        genre ?? track.genre,
        year ?? track.year,
        trackId
      )

      if (contentType !== undefined || podcastTitle !== undefined || podcastAuthor !== undefined) {
        db.prepare(`
          UPDATE tracks SET
            content_type = COALESCE(?, content_type),
            podcast_title = ?,
            podcast_author = ?,
            podcast_episode_number = ?,
            podcast_season_number = ?,
            podcast_description = ?,
            podcast_published_at = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          contentType === "podcast" || contentType === "music" ? contentType : track.content_type || "music",
          podcastTitle ?? track.podcast_title,
          podcastAuthor ?? track.podcast_author,
          podcastEpisodeNumber ?? track.podcast_episode_number,
          podcastSeasonNumber ?? track.podcast_season_number,
          podcastDescription ?? track.podcast_description,
          podcastPublishedAt ?? track.podcast_published_at,
          trackId
        )
      }
    }

    const updatedTrack = queries.getTrackById.get(trackId)
    return NextResponse.json({ track: updatedTrack })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("Error updating track:", error)
    return NextResponse.json(
      { error: "Failed to update track" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const trackId = parseInt(id, 10)

  if (isNaN(trackId)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 })
  }

  try {
    await requireMutationAuth(request)
    const track = queries.getTrackById.get(trackId) as Track | null

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    const youtubeVideoId = getYouTubeVideoId(track.file_path)
    if (youtubeVideoId) {
      const ytTrack = queries.getYTTrackByVideoId.get(youtubeVideoId) as any
      safeUnlink(ytTrack?.cached_file_path || null)
      db.prepare(`
        UPDATE yt_tracks SET is_cached = 0, cached_file_path = NULL, updated_at = datetime('now')
        WHERE video_id = ?
      `).run(youtubeVideoId)
    } else {
      for (const filePath of getOwnedTrackFilePaths(track)) {
        safeUnlink(filePath)
      }
    }

    // Delete from database
    queries.deleteTrack.run(trackId)

    return NextResponse.json({ message: "Track deleted" })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("Error deleting track:", error)
    return NextResponse.json(
      { error: "Failed to delete track" },
      { status: 500 }
    )
  }
}

function getYouTubeVideoId(filePath: string): string | null {
  const match = filePath.match(/^\/api\/youtube\/stream\/([^/?#]+)$/)
  return match?.[1] || null
}
