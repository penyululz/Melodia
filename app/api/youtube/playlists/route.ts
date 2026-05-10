import { NextRequest, NextResponse } from "next/server"
import db, { queries, YTPlaylist } from "@/lib/db"
import { getYTPlaylist, getYTSongDetails, extractPlaylistId, type YTSearchResult } from "@/lib/youtube-music"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"
import { deriveAudioDescriptors, detectLibraryContentType, saveRemoteImageAsWebp } from "@/lib/metadata"
import { saveBestYouTubeThumbnailAsWebp } from "@/lib/youtube-artwork"
import { cacheLyricsForTrack } from "@/lib/lyrics-service"

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

    if (playlistInfo.tracks.length === 0) {
      return NextResponse.json(
        { error: "No importable tracks were found in this playlist" },
        { status: 422 }
      )
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
    db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(nativePlaylist.id)

    // Insert tracks and link to playlist
    let importedTrackCount = 0
    let importedLyricsCount = 0
    for (let i = 0; i < playlistInfo.tracks.length; i++) {
      const track = await resolveImportTrackDetails(playlistInfo.tracks[i])
      if (!track.videoId) continue

      const thumbnail = await saveBestYouTubeThumbnailAsWebp(track.videoId, [
        track.thumbnailUrl,
        track.thumbnailUrlHQ,
      ])

      upsertYouTubeTrack(track, thumbnail)
      const localTrack = upsertYouTubeTrackAsLibraryItem(track, thumbnail)

      // Get track ID
      const ytTrack = queries.getYTTrackByVideoId.get(track.videoId)
      if (ytTrack) {
        queries.addToYTPlaylist.run(importedPlaylist.id, ytTrack.id, i + 1)
      }

      if (localTrack) {
        db.prepare(`
          INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
          VALUES (?, ?, ?)
        `).run(nativePlaylist.id, localTrack.id, i + 1)
        const lyricsCached = await cacheLyricsForImportedTrack(localTrack.id, track)
        if (lyricsCached) importedLyricsCount += 1
        importedTrackCount += 1
      }
    }

    db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(nativePlaylist.id)

    if (importedTrackCount === 0) {
      return NextResponse.json(
        { error: "No importable tracks were saved from this playlist" },
        { status: 422 }
      )
    }

    return NextResponse.json({ 
      message: "Playlist imported successfully",
      playlist: {
        id: importedPlaylist.id,
        ...playlistInfo
      },
      nativePlaylist: {
        ...nativePlaylist,
        track_count: importedTrackCount,
      },
      importedTracks: importedTrackCount,
      importedLyrics: importedLyricsCount,
    })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] Import YT playlist error:", error)
    return NextResponse.json({ error: "Failed to import playlist" }, { status: 500 })
  }
}

async function cacheLyricsForImportedTrack(trackId: number, track: YTSearchResult): Promise<boolean> {
  if (track.content_type === "podcast") return false

  return cacheLyricsForTrack({
    trackId,
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  }).catch((error) => {
    console.warn(`[lyrics] Could not cache lyrics for ${track.videoId}:`, error)
    return false
  })
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

function upsertYouTubeTrackAsLibraryItem(track: YTSearchResult, thumbnailUrl: string | null): { id: number } | null {
  const title = cleanText(track.title) || "Unknown Track"
  const artist = cleanText(track.artist) || "Unknown Artist"
  const album = resolveLibraryAlbumName(track, title)
  const filePath = `/api/youtube/stream/${track.videoId}`
  const fileName = `${track.videoId}.youtube`
  const contentType =
    track.content_type === "podcast" || track.content_type === "music"
      ? track.content_type
      : detectLibraryContentType({ title, artist, album, fileName })
  const descriptors = deriveAudioDescriptors({
    title,
    artist,
    album,
    genre: "YouTube",
    fileName,
  })

  db.prepare(`
    INSERT INTO tracks (
      title, artist, album, album_artist, genre, duration,
      file_path, file_name, storage_kind, storage_path, playback_path,
      file_size, file_format, cover_art_path, mood, tempo, language, style,
      content_type, podcast_title, podcast_author, loudness_adjust_db,
      replaygain_track_gain, replaygain_album_gain, is_favorite
    )
    VALUES (?, ?, ?, ?, 'YouTube', ?, ?, ?, 'youtube', NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0)
    ON CONFLICT(file_path) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      album_artist = excluded.album_artist,
      genre = COALESCE(tracks.genre, excluded.genre),
      duration = COALESCE(excluded.duration, tracks.duration),
      file_name = excluded.file_name,
      storage_kind = 'youtube',
      playback_path = excluded.playback_path,
      file_format = COALESCE(tracks.file_format, excluded.file_format),
      cover_art_path = COALESCE(excluded.cover_art_path, tracks.cover_art_path),
      mood = COALESCE(tracks.mood, excluded.mood),
      tempo = COALESCE(tracks.tempo, excluded.tempo),
      language = COALESCE(tracks.language, excluded.language),
      style = COALESCE(tracks.style, excluded.style),
      content_type = excluded.content_type,
      podcast_title = excluded.podcast_title,
      podcast_author = excluded.podcast_author,
      updated_at = datetime('now')
  `).run(
    title,
    artist,
    album,
    artist,
    Number.isFinite(track.duration) ? track.duration : null,
    filePath,
    fileName,
    filePath,
    track.type === "video" ? "YOUTUBE_VIDEO" : "YOUTUBE_AUDIO",
    thumbnailUrl,
    descriptors.mood,
    descriptors.tempo,
    descriptors.language,
    descriptors.style,
    contentType,
    track.podcast_title || (contentType === "podcast" ? album : null),
    track.podcast_author || (contentType === "podcast" ? artist : null)
  )

  return db.prepare("SELECT id FROM tracks WHERE file_path = ?").get(filePath) as { id: number } | null
}

async function resolveImportTrackDetails(track: YTSearchResult): Promise<YTSearchResult> {
  if (!track.videoId) return track

  if (!needsSongDetails(track)) {
    return {
      ...track,
      album: cleanText(track.album) || cleanText(track.title) || null,
    }
  }

  const details = await getYTSongDetails(track.videoId).catch(() => null)
  if (!details) {
    return {
      ...track,
      album: cleanText(track.album) || cleanText(track.title) || null,
    }
  }

  return {
    ...track,
    title: cleanText(details.title) || track.title,
    artist: cleanText(details.artist) || track.artist,
    album: cleanText(details.album) || cleanText(track.album) || cleanText(details.title) || cleanText(track.title) || null,
    duration: Number.isFinite(details.duration) ? details.duration : track.duration,
    thumbnailUrl: details.thumbnailUrl || track.thumbnailUrl,
    thumbnailUrlHQ: details.thumbnailUrlHQ || track.thumbnailUrlHQ,
    content_type: details.content_type || track.content_type,
    podcast_title: details.podcast_title || track.podcast_title,
    podcast_author: details.podcast_author || track.podcast_author,
  }
}

function needsSongDetails(track: YTSearchResult): boolean {
  const album = cleanText(track.album)
  return !album || isGenericYouTubeAlbum(album) || !cleanText(track.artist) || /^unknown artist$/i.test(track.artist || "")
}

function resolveLibraryAlbumName(track: YTSearchResult, title: string): string {
  const album = cleanText(track.album)
  if (album && !isGenericYouTubeAlbum(album)) return album
  return title
}

function isGenericYouTubeAlbum(value: string | null | undefined): boolean {
  return /^(youtube imports?|youtube downloads?|unknown album)$/i.test(value?.trim() || "")
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function getNativePlaylistMarker(playlistId: string): string {
  return JSON.stringify({ source: "youtube-playlist", playlistId })
}
