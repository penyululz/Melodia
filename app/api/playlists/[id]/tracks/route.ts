import { NextRequest, NextResponse } from "next/server"
import db, { type YTTrack } from "@/lib/db"
import { getDemoPlaylistTracks } from "@/lib/demo-data"
import { authErrorResponse, isDemoSessionEnabled, requireMutationAuth } from "@/lib/auth-policy"
import { isValidYouTubeVideoId } from "@/lib/yt-dlp"
import { detectLibraryContentType } from "@/lib/metadata"

interface RouteParams {
  params: Promise<{ id: string }>
}

type AddTrackBody = {
  track_id?: unknown
  yt_video_id?: unknown
  videoId?: unknown
  source?: unknown
  title?: unknown
  artist?: unknown
  album?: unknown
  duration?: unknown
  thumbnailUrl?: unknown
  thumbnailUrlHQ?: unknown
  contentType?: unknown
  podcastTitle?: unknown
  podcastAuthor?: unknown
  podcastEpisodeNumber?: unknown
  podcastSeasonNumber?: unknown
  podcastDescription?: unknown
  podcastPublishedAt?: unknown
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const tracks = db.prepare(`
      SELECT *
      FROM (
        SELECT
          pt.position,
          pt.added_at,
          t.id,
          'local' as source,
          NULL as videoId,
          t.title,
          t.artist,
          t.album,
          t.genre,
          t.duration,
          t.cover_art_path,
          t.file_path,
          t.file_format,
          t.content_type,
          t.podcast_title,
          t.podcast_author,
          t.podcast_episode_number,
          t.podcast_season_number,
          t.podcast_description,
          t.podcast_published_at,
          t.loudness_adjust_db,
          t.replaygain_track_gain,
          t.replaygain_album_gain,
          t.play_count,
          t.is_favorite,
          0 as is_cached
        FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        WHERE pt.playlist_id = ?

        UNION ALL

        SELECT
          pt.position,
          pt.added_at,
          y.video_id as id,
          'youtube' as source,
          y.video_id as videoId,
          y.title,
          y.artist,
          y.album,
          NULL as genre,
          y.duration,
          y.thumbnail_url as cover_art_path,
          CASE WHEN y.is_cached = 1 THEN '/api/youtube/stream/' || y.video_id ELSE NULL END as file_path,
          CASE WHEN y.cached_media_type = 'video' THEN 'MP4' ELSE NULL END as file_format,
          y.content_type,
          y.podcast_title,
          y.podcast_author,
          y.podcast_episode_number,
          y.podcast_season_number,
          y.podcast_description,
          y.podcast_published_at,
          y.loudness_adjust_db,
          y.replaygain_track_gain,
          y.replaygain_album_gain,
          y.play_count,
          y.is_favorite,
          y.is_cached
        FROM playlist_youtube_tracks pt
        JOIN yt_tracks y ON y.id = pt.yt_track_id
        WHERE pt.playlist_id = ?
      )
      ORDER BY position ASC, added_at ASC
    `).all(id, id)

    return NextResponse.json(
      tracks.length > 0 ? tracks : isDemoSessionEnabled() ? getDemoPlaylistTracks(id) : []
    )
  } catch (error) {
    console.error("Error fetching playlist tracks:", error)
    return NextResponse.json({ error: "Failed to fetch playlist tracks" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    await requireMutationAuth(req)
    const { id } = await params
    const body = (await req.json()) as AddTrackBody
    const trackId = normalizeTrackId(body.track_id)
    const videoId = normalizeVideoId(body.yt_video_id ?? body.videoId)

    const playlist = db.prepare("SELECT id FROM playlists WHERE id = ?").get(id)
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 })
    }

    if (videoId) {
      return addYouTubeTrackToPlaylist(id, videoId, body)
    }

    if (!trackId) {
      return NextResponse.json({ error: "Valid track_id or yt_video_id is required" }, { status: 400 })
    }

    const track = db.prepare("SELECT id FROM tracks WHERE id = ?").get(trackId)
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    const existing = db.prepare(`
      SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?
    `).get(id, trackId)

    if (existing) {
      return NextResponse.json({ success: true, alreadyAdded: true, source: "local" })
    }

    const position = getNextPlaylistPosition(id)

    db.prepare(`
      INSERT INTO playlist_tracks (playlist_id, track_id, position)
      VALUES (?, ?, ?)
    `).run(id, trackId, position)

    touchPlaylist(id)

    return NextResponse.json({ success: true, position, source: "local" })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("Error adding track to playlist:", error)
    return NextResponse.json({ error: "Failed to add track" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    await requireMutationAuth(req)
    const { id } = await params
    const body = (await req.json()) as AddTrackBody
    const trackId = normalizeTrackId(body.track_id)
    const videoId = normalizeVideoId(body.yt_video_id ?? body.videoId)

    if (videoId) {
      db.prepare(`
        DELETE FROM playlist_youtube_tracks
        WHERE playlist_id = ?
          AND yt_track_id = (SELECT id FROM yt_tracks WHERE video_id = ?)
      `).run(id, videoId)
      touchPlaylist(id)
      return NextResponse.json({ success: true })
    }

    if (!trackId) {
      return NextResponse.json({ error: "Valid track_id or yt_video_id is required" }, { status: 400 })
    }

    db.prepare(`
      DELETE FROM playlist_tracks
      WHERE playlist_id = ? AND track_id = ?
    `).run(id, trackId)

    touchPlaylist(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("Error removing track from playlist:", error)
    return NextResponse.json({ error: "Failed to remove track" }, { status: 500 })
  }
}

function addYouTubeTrackToPlaylist(playlistId: string, videoId: string, body: AddTrackBody) {
  if (!isValidYouTubeVideoId(videoId)) {
    return NextResponse.json({ error: "Invalid YouTube video ID" }, { status: 400 })
  }

  const existingTrack = db.prepare("SELECT * FROM yt_tracks WHERE video_id = ?").get(videoId) as YTTrack | null
  if (!existingTrack && !getString(body.title)) {
    return NextResponse.json({ error: "YouTube track title is required" }, { status: 400 })
  }

  const title = getString(body.title) || existingTrack?.title || "Unknown Track"
  const artist = getString(body.artist) || existingTrack?.artist || "Unknown Artist"
  const album = getNullableString(body.album) ?? existingTrack?.album ?? null
  const thumbnailUrl = getNullableString(body.thumbnailUrlHQ) || getNullableString(body.thumbnailUrl)
  const duration = getNullableNumber(body.duration) ?? existingTrack?.duration ?? null
  const resolvedContentType = resolveContentType(body, title, artist, album, existingTrack)

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
      duration = COALESCE(excluded.duration, yt_tracks.duration),
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
    artist,
    album,
    duration,
    thumbnailUrl,
    resolvedContentType,
    getNullableString(body.podcastTitle) || existingTrack?.podcast_title || null,
    getNullableString(body.podcastAuthor) || existingTrack?.podcast_author || null,
    getNullableNumber(body.podcastEpisodeNumber) ?? existingTrack?.podcast_episode_number ?? null,
    getNullableNumber(body.podcastSeasonNumber) ?? existingTrack?.podcast_season_number ?? null,
    getNullableString(body.podcastDescription) || existingTrack?.podcast_description || null,
    getNullableString(body.podcastPublishedAt) || existingTrack?.podcast_published_at || null
  )

  const ytTrack = db.prepare("SELECT id FROM yt_tracks WHERE video_id = ?").get(videoId) as { id: number } | null
  if (!ytTrack) {
    return NextResponse.json({ error: "Failed to save YouTube track" }, { status: 500 })
  }

  const existing = db.prepare(`
    SELECT id FROM playlist_youtube_tracks WHERE playlist_id = ? AND yt_track_id = ?
  `).get(playlistId, ytTrack.id)

  if (existing) {
    return NextResponse.json({ success: true, alreadyAdded: true, source: "youtube" })
  }

  const position = getNextPlaylistPosition(playlistId)

  db.prepare(`
    INSERT INTO playlist_youtube_tracks (playlist_id, yt_track_id, position)
    VALUES (?, ?, ?)
  `).run(playlistId, ytTrack.id, position)

  touchPlaylist(playlistId)

  return NextResponse.json({ success: true, position, source: "youtube" })
}

function getNextPlaylistPosition(playlistId: string): number {
  const row = db.prepare(`
    SELECT MAX(position) as max_pos
    FROM (
      SELECT position FROM playlist_tracks WHERE playlist_id = ?
      UNION ALL
      SELECT position FROM playlist_youtube_tracks WHERE playlist_id = ?
    )
  `).get(playlistId, playlistId) as { max_pos: number | null } | null

  return Number(row?.max_pos || 0) + 1
}

function touchPlaylist(playlistId: string) {
  db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId)
}

function normalizeTrackId(trackId: unknown): number | null {
  const id = Number(trackId)
  return Number.isInteger(id) && id > 0 ? id : null
}

function normalizeVideoId(videoId: unknown): string | null {
  return typeof videoId === "string" && videoId.trim() ? videoId.trim() : null
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function getNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function getNullableNumber(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function resolveContentType(
  body: AddTrackBody,
  title: string,
  artist: string | null,
  album: string | null,
  existingTrack: YTTrack | null
) {
  const contentType = getString(body.contentType)
  if (contentType === "music" || contentType === "podcast") return contentType
  if (existingTrack?.content_type === "music" || existingTrack?.content_type === "podcast") {
    return existingTrack.content_type
  }

  return detectLibraryContentType({
    title,
    artist,
    album,
  })
}
