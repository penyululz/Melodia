import { NextRequest, NextResponse } from "next/server"
import db, { queries, YTPlaylist } from "@/lib/db"
import { getYTPlaylist, extractPlaylistId, type YTSearchResult } from "@/lib/youtube-music"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"
import { saveRemoteImageAsWebp } from "@/lib/metadata"

// GET - List all imported YouTube playlists
export async function GET() {
  try {
    const playlists = queries.getAllYTPlaylists.all() as YTPlaylist[]
    return NextResponse.json({ playlists })
  } catch (error) {
    console.error("[v0] Get YT playlists error:", error)
    return NextResponse.json({ error: "Failed to get playlists" }, { status: 500 })
  }
}

// POST - Import a new YouTube playlist
export async function POST(request: NextRequest) {
  try {
    await requireMutationAuth(request)
    const body = await request.json()
    const { url } = body

    if (!url) {
      return NextResponse.json({ error: "Playlist URL is required" }, { status: 400 })
    }

    const playlistId = extractPlaylistId(url)
    if (!playlistId) {
      return NextResponse.json({ error: "Invalid playlist URL" }, { status: 400 })
    }

    // Fetch playlist from YouTube Music
    const playlistInfo = await getYTPlaylist(playlistId)
    if (!playlistInfo) {
      return NextResponse.json({ error: "Could not fetch playlist" }, { status: 404 })
    }

    const playlistThumbnail =
      (await saveRemoteImageAsWebp(playlistInfo.thumbnailUrl, `youtube-playlist-${playlistInfo.playlistId}`).catch(() => null)) ||
      playlistInfo.thumbnailUrl

    upsertImportedYouTubePlaylist(
      playlistInfo.playlistId,
      playlistInfo.name,
      playlistInfo.description,
      playlistThumbnail,
      playlistInfo.trackCount
    )

    const importedPlaylist = queries.getYTPlaylistByPlaylistId.get(playlistInfo.playlistId) as YTPlaylist | null
    if (!importedPlaylist) {
      return NextResponse.json({ error: "Failed to create imported playlist" }, { status: 500 })
    }

    const nativePlaylist = upsertNativePlaylistForYouTubeImport(
      playlistInfo.playlistId,
      playlistInfo.name,
      playlistInfo.description,
      playlistThumbnail
    )

    db.prepare("DELETE FROM yt_playlist_tracks WHERE yt_playlist_id = ?").run(importedPlaylist.id)
    db.prepare("DELETE FROM playlist_youtube_tracks WHERE playlist_id = ?").run(nativePlaylist.id)

    // Insert tracks and link to playlist
    for (let i = 0; i < playlistInfo.tracks.length; i++) {
      const track = playlistInfo.tracks[i]
      const thumbnail =
        (await saveRemoteImageAsWebp(track.thumbnailUrlHQ || track.thumbnailUrl, `youtube-${track.videoId}`).catch(() => null)) ||
        track.thumbnailUrlHQ ||
        track.thumbnailUrl

      upsertYouTubeTrack(track, thumbnail)

      // Get track ID
      const ytTrack = queries.getYTTrackByVideoId.get(track.videoId)
      if (ytTrack) {
        queries.addToYTPlaylist.run(importedPlaylist.id, ytTrack.id, i + 1)
        db.prepare(`
          INSERT OR IGNORE INTO playlist_youtube_tracks (playlist_id, yt_track_id, position)
          VALUES (?, ?, ?)
        `).run(nativePlaylist.id, ytTrack.id, i + 1)
      }
    }

    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(nativePlaylist.id)

    return NextResponse.json({ 
      message: "Playlist imported successfully",
      playlist: {
        id: importedPlaylist.id,
        ...playlistInfo
      },
      nativePlaylist: {
        ...nativePlaylist,
        track_count: playlistInfo.tracks.length,
      },
    })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] Import YT playlist error:", error)
    return NextResponse.json({ error: "Failed to import playlist" }, { status: 500 })
  }
}

function upsertImportedYouTubePlaylist(
  playlistId: string,
  name: string,
  description: string | null,
  thumbnailUrl: string | null,
  trackCount: number
) {
  db.prepare(`
    INSERT INTO yt_playlists (playlist_id, name, description, thumbnail_url, track_count, last_synced_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(playlist_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      thumbnail_url = COALESCE(excluded.thumbnail_url, yt_playlists.thumbnail_url),
      track_count = excluded.track_count,
      last_synced_at = datetime('now')
  `).run(playlistId, name, description, thumbnailUrl, trackCount)
}

function upsertNativePlaylistForYouTubeImport(
  youtubePlaylistId: string,
  name: string,
  description: string | null,
  thumbnailUrl: string | null
): { id: number; name: string; description: string | null } {
  const marker = getNativePlaylistMarker(youtubePlaylistId)
  const existing = db.prepare(`
    SELECT id, name, description
    FROM playlists
    WHERE smart_rules = ?
  `).get(marker) as { id: number; name: string; description: string | null } | null

  if (existing) {
    db.prepare(`
      UPDATE playlists SET
        name = ?,
        description = ?,
        cover_image_path = COALESCE(?, cover_image_path),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(name, description, thumbnailUrl, existing.id)
    return { ...existing, name, description }
  }

  const result = db.prepare(`
    INSERT INTO playlists (name, description, cover_image_path, is_smart, smart_rules, is_demo)
    VALUES (?, ?, ?, 0, ?, 0)
  `).run(name, description, thumbnailUrl, marker)

  return {
    id: Number(result.lastInsertRowid),
    name,
    description,
  }
}

function upsertYouTubeTrack(track: YTSearchResult, thumbnailUrl: string | null) {
  db.prepare(`
    INSERT INTO yt_tracks (
      video_id, title, artist, album, duration, thumbnail_url, content_type,
      podcast_title, podcast_author
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      duration = COALESCE(excluded.duration, yt_tracks.duration),
      thumbnail_url = COALESCE(excluded.thumbnail_url, yt_tracks.thumbnail_url),
      content_type = excluded.content_type,
      podcast_title = excluded.podcast_title,
      podcast_author = excluded.podcast_author,
      updated_at = datetime('now')
  `).run(
    track.videoId,
    track.title,
    track.artist || "Unknown Artist",
    track.album || null,
    Number.isFinite(track.duration) ? track.duration : null,
    thumbnailUrl,
    track.content_type || "music",
    track.podcast_title || (track.content_type === "podcast" ? track.album || track.title : null),
    track.podcast_author || (track.content_type === "podcast" ? track.artist : null)
  )
}

function getNativePlaylistMarker(playlistId: string): string {
  return JSON.stringify({ source: "youtube-playlist", playlistId })
}
