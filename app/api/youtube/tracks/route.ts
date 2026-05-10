import { NextRequest, NextResponse } from "next/server"
import db, { queries, YTTrack } from "@/lib/db"
import { isValidYouTubeVideoId } from "@/lib/yt-dlp"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"
import { detectLibraryContentType } from "@/lib/metadata"
import { saveBestYouTubeThumbnailAsWebp } from "@/lib/youtube-artwork"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET - List all YouTube tracks, optionally filtered by cache or favorite state.
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const filter = searchParams.get("filter")
    const contentType = searchParams.get("contentType")

    let tracks: YTTrack[]
    switch (filter) {
      case "cached":
        tracks = queries.getCachedYTTracks.all() as YTTrack[]
        break
      case "favorites":
        tracks = queries.getFavoriteYTTracks.all() as YTTrack[]
        break
      default:
        tracks = queries.getAllYTTracks.all() as YTTrack[]
        break
    }

    if (contentType === "music" || contentType === "podcast") {
      tracks = tracks.filter((track) => (track.content_type || "music") === contentType)
    }

    return NextResponse.json({ tracks })
  } catch (error) {
    console.error("[v0] Get YT tracks error:", error)
    return NextResponse.json({ error: "Failed to get tracks" }, { status: 500 })
  }
}

// POST - Save or refresh a YouTube track in the local library.
export async function POST(request: NextRequest) {
  try {
    await requireMutationAuth(request)
    const body = await request.json()
    const {
      videoId,
      title,
      artist,
      album,
      duration,
      thumbnailUrl,
      thumbnailUrlHQ,
      contentType,
      podcastTitle,
      podcastAuthor,
      podcastEpisodeNumber,
      podcastSeasonNumber,
      podcastDescription,
      podcastPublishedAt,
    } = body

    if (!videoId || !title) {
      return NextResponse.json({ error: "videoId and title are required" }, { status: 400 })
    }

    if (!isValidYouTubeVideoId(videoId)) {
      return NextResponse.json({ error: "Invalid YouTube video ID" }, { status: 400 })
    }

    const thumbnail = await saveBestYouTubeThumbnailAsWebp(videoId, [
      thumbnailUrl,
      thumbnailUrlHQ,
    ])
    const resolvedContentType =
      contentType === "podcast" || contentType === "music"
        ? contentType
        : detectLibraryContentType({
            title,
            artist,
            album,
          })

    db.prepare(`
      INSERT INTO yt_tracks (
        video_id, title, artist, album, duration, thumbnail_url, content_type,
        podcast_title, podcast_author, podcast_episode_number, podcast_season_number,
        podcast_description, podcast_published_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        duration = excluded.duration,
        thumbnail_url = COALESCE(excluded.thumbnail_url, yt_tracks.thumbnail_url),
        content_type = excluded.content_type,
        podcast_title = excluded.podcast_title,
        podcast_author = excluded.podcast_author,
        podcast_episode_number = excluded.podcast_episode_number,
        podcast_season_number = excluded.podcast_season_number,
        podcast_description = excluded.podcast_description,
        podcast_published_at = excluded.podcast_published_at,
        updated_at = datetime('now')
    `).run(
      videoId,
      title,
      artist || "Unknown Artist",
      album || null,
      Number.isFinite(duration) ? duration : null,
      thumbnail,
      resolvedContentType,
      podcastTitle || (resolvedContentType === "podcast" ? album || title : null),
      podcastAuthor || (resolvedContentType === "podcast" ? artist || "Unknown Author" : null),
      Number.isInteger(Number(podcastEpisodeNumber)) ? Number(podcastEpisodeNumber) : null,
      Number.isInteger(Number(podcastSeasonNumber)) ? Number(podcastSeasonNumber) : null,
      podcastDescription || null,
      podcastPublishedAt || null
    )

    const track = queries.getYTTrackByVideoId.get(videoId) as YTTrack | null
    return NextResponse.json({ track }, { status: 201 })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] Save YT track error:", error)
    return NextResponse.json({ error: "Failed to save track" }, { status: 500 })
  }
}
