import "server-only"

import db, { Track, YTTrack } from "@/lib/db"
import { detectLibraryContentType, deriveAudioDescriptors, extractMetadata, saveRemoteImageAsWebp } from "@/lib/metadata"
import fs from "fs"
import path from "path"

const DEFAULT_YOUTUBE_ALBUM = "YouTube Downloads"
const DEFAULT_YOUTUBE_GENRE = "YouTube"

export function getPromotedYouTubeFilePath(videoId: string): string {
  return `/api/youtube/stream/${videoId}`
}

export async function promoteYouTubeDownloadToLocalTrack(
  ytTrack: YTTrack,
  audioFilePath: string
): Promise<Track> {
  if (!fs.existsSync(audioFilePath)) {
    throw new Error("Downloaded audio file does not exist")
  }

  const stats = fs.statSync(audioFilePath)
  const filePath = getPromotedYouTubeFilePath(ytTrack.video_id)
  const fileName = path.basename(audioFilePath)
  const metadata = await extractMetadata(audioFilePath).catch(() => null)
  const descriptors = metadata ?? {
    ...deriveAudioDescriptors({
      title: cleanText(ytTrack.title) || path.basename(fileName, path.extname(fileName)),
      artist: cleanText(ytTrack.artist),
      album: cleanText(ytTrack.album) || DEFAULT_YOUTUBE_ALBUM,
      genre: DEFAULT_YOUTUBE_GENRE,
      fileName,
    }),
  }
  const onlineTitle = cleanText(ytTrack.title)
  const title = onlineTitle || metadata?.title || path.basename(fileName, path.extname(fileName))
  const artist = cleanText(ytTrack.artist) || metadata?.artist || "Unknown Artist"
  const album = cleanText(ytTrack.album) || metadata?.album || DEFAULT_YOUTUBE_ALBUM
  const contentType =
    metadata?.contentType ||
    ((ytTrack.content_type === "podcast" || ytTrack.content_type === "music") ? ytTrack.content_type : null) ||
    detectLibraryContentType({ title, artist, album, fileName })
  const podcastTitle = metadata?.podcastTitle || ytTrack.podcast_title || (contentType === "podcast" ? album : null)
  const podcastAuthor = metadata?.podcastAuthor || ytTrack.podcast_author || (contentType === "podcast" ? artist : null)
  const duration = ytTrack.duration ?? metadata?.duration ?? null
  const fileFormat = metadata?.format || path.extname(audioFilePath).slice(1).toUpperCase() || null
  const localThumbnail =
    (await saveRemoteImageAsWebp(ytTrack.thumbnail_url, `youtube-${ytTrack.video_id}`).catch(() => null)) ||
    ytTrack.thumbnail_url ||
    null

  const existingTrack = getTrackByFilePath(filePath)

  if (existingTrack) {
    db.prepare(`
      UPDATE tracks SET
        title = ?,
        artist = ?,
        album = ?,
        album_artist = ?,
        genre = COALESCE(genre, ?),
        duration = ?,
        file_name = ?,
        file_size = ?,
        file_format = ?,
        bit_rate = ?,
        sample_rate = ?,
        cover_art_path = ?,
        mood = ?,
        tempo = ?,
        language = ?,
        style = ?,
        content_type = ?,
        podcast_title = ?,
        podcast_author = ?,
        podcast_episode_number = ?,
        podcast_season_number = ?,
        podcast_description = ?,
        podcast_published_at = ?,
        loudness_adjust_db = ?,
        replaygain_track_gain = ?,
        replaygain_album_gain = ?,
        is_favorite = ?,
        storage_kind = 'youtube',
        storage_path = ?,
        updated_at = datetime('now')
      WHERE file_path = ?
    `).run(
      title,
      artist,
      album,
      metadata?.albumArtist || artist,
      metadata?.genre || DEFAULT_YOUTUBE_GENRE,
      duration,
      fileName,
      stats.size,
      fileFormat,
      metadata?.bitRate ?? null,
      metadata?.sampleRate ?? null,
      localThumbnail || existingTrack.cover_art_path,
      descriptors.mood,
      descriptors.tempo,
      descriptors.language,
      descriptors.style,
      contentType,
      podcastTitle,
      podcastAuthor,
      metadata?.podcastEpisodeNumber ?? ytTrack.podcast_episode_number ?? null,
      metadata?.podcastSeasonNumber ?? ytTrack.podcast_season_number ?? null,
      metadata?.podcastDescription ?? ytTrack.podcast_description ?? null,
      metadata?.podcastPublishedAt ?? ytTrack.podcast_published_at ?? null,
      metadata?.loudnessAdjustDb ?? ytTrack.loudness_adjust_db ?? 0,
      metadata?.replaygainTrackGain ?? ytTrack.replaygain_track_gain ?? null,
      metadata?.replaygainAlbumGain ?? ytTrack.replaygain_album_gain ?? null,
      ytTrack.is_favorite ? 1 : existingTrack.is_favorite,
      audioFilePath,
      filePath
    )
  } else {
    db.prepare(`
      INSERT INTO tracks (
        title, artist, album, album_artist, genre, year,
        track_number, disc_number, duration, file_path, file_name,
        storage_kind, storage_path, file_size, file_format, bit_rate, sample_rate, cover_art_path,
        mood, tempo, language, style, content_type, podcast_title, podcast_author,
        podcast_episode_number, podcast_season_number, podcast_description, podcast_published_at,
        loudness_adjust_db, replaygain_track_gain, replaygain_album_gain, is_favorite
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'youtube', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      artist,
      album,
      metadata?.albumArtist || artist,
      metadata?.genre || DEFAULT_YOUTUBE_GENRE,
      metadata?.year ?? null,
      metadata?.trackNumber ?? null,
      metadata?.discNumber ?? null,
      duration,
      filePath,
      fileName,
      audioFilePath,
      stats.size,
      fileFormat,
      metadata?.bitRate ?? null,
      metadata?.sampleRate ?? null,
      localThumbnail,
      descriptors.mood,
      descriptors.tempo,
      descriptors.language,
      descriptors.style,
      contentType,
      podcastTitle,
      podcastAuthor,
      metadata?.podcastEpisodeNumber ?? ytTrack.podcast_episode_number ?? null,
      metadata?.podcastSeasonNumber ?? ytTrack.podcast_season_number ?? null,
      metadata?.podcastDescription ?? ytTrack.podcast_description ?? null,
      metadata?.podcastPublishedAt ?? ytTrack.podcast_published_at ?? null,
      metadata?.loudnessAdjustDb ?? ytTrack.loudness_adjust_db ?? 0,
      metadata?.replaygainTrackGain ?? ytTrack.replaygain_track_gain ?? null,
      metadata?.replaygainAlbumGain ?? ytTrack.replaygain_album_gain ?? null,
      ytTrack.is_favorite ? 1 : 0
    )
  }

  return getTrackByFilePath(filePath)!
}

export function removePromotedYouTubeTrack(videoId: string): void {
  db.prepare("DELETE FROM tracks WHERE file_path = ?").run(getPromotedYouTubeFilePath(videoId))
}

function getTrackByFilePath(filePath: string): Track | null {
  return db.prepare("SELECT * FROM tracks WHERE file_path = ?").get(filePath) as Track | null
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
