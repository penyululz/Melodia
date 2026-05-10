import { NextRequest, NextResponse } from "next/server"
import db from "@/lib/db"
import {
  detectLibraryContentType,
  deriveAudioDescriptors,
  extractMetadata,
  isAudioFile,
  resolveCoverArt,
  type ExtractedMetadata,
} from "@/lib/metadata"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"
import { resolveAllowedScanDirectory, toPublicPath } from "@/lib/file-safety"
import { ensureBrowserPlayableMedia } from "@/lib/media-conversion"
import path from "path"
import fs from "fs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Recursively find all audio files in a directory
function findAudioFiles(dir: string): string[] {
  const files: string[] = []

  if (!fs.existsSync(dir)) {
    return files
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(/* turbopackIgnore: true */ dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...findAudioFiles(fullPath))
    } else if (entry.isFile() && isAudioFile(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

export async function POST(request: NextRequest) {
  try {
    await requireMutationAuth(request)
    const body = await request.json()
    const { directory } = body

    const scanDir = resolveAllowedScanDirectory(directory)

    if (!fs.existsSync(scanDir)) {
      fs.mkdirSync(scanDir, { recursive: true })
      return NextResponse.json({
        message: "Music directory created but is empty",
        scanned: 0,
        added: 0,
        skipped: 0,
      })
    }

    const audioFiles = findAudioFiles(scanDir)
    const results = {
      scanned: audioFiles.length,
      added: 0,
      skipped: 0,
      errors: [] as string[],
    }

    for (const filePath of audioFiles) {
      try {
        const publicPath = toPublicPath(filePath)
        const initialFilePath = publicPath || `/api/media/tracks/pending-${hashPath(filePath)}`

        // Check if track already exists
        const exists = db.prepare(`
          SELECT id FROM tracks
          WHERE file_path = ? OR storage_path = ?
        `).get(initialFilePath, filePath)

        if (exists) {
          results.skipped++
          continue
        }

        // Extract metadata
        const metadata = await readMetadataOrFallback(filePath)

        const coverArtPath = await resolveCoverArt(metadata, {
          allowOnlineLookup: request.headers.get("x-melodia-online-artwork") === "true",
        })

        const stats = fs.statSync(filePath)
        const playbackMedia = await ensureBrowserPlayableMedia(filePath, path.basename(filePath))

        const insertResult = db.prepare(`
          INSERT INTO tracks (
            title, artist, album, album_artist, genre, year,
            track_number, disc_number, duration, file_path, file_name,
            storage_kind, storage_path, file_size, file_format, bit_rate,
            sample_rate, cover_art_path, mood, tempo, language, style, content_type,
            podcast_title, podcast_author, podcast_episode_number, podcast_season_number,
            podcast_description, podcast_published_at, loudness_adjust_db, replaygain_track_gain,
            replaygain_album_gain
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scan', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          metadata.title,
          metadata.artist,
          metadata.album,
          metadata.albumArtist,
          metadata.genre,
          metadata.year,
          metadata.trackNumber,
          metadata.discNumber,
          metadata.duration,
          initialFilePath,
          path.basename(filePath),
          filePath,
          stats.size,
          metadata.format,
          metadata.bitRate,
          metadata.sampleRate,
          coverArtPath,
          metadata.mood,
          metadata.tempo,
          metadata.language,
          metadata.style,
          metadata.contentType,
          metadata.podcastTitle,
          metadata.podcastAuthor,
          metadata.podcastEpisodeNumber,
          metadata.podcastSeasonNumber,
          metadata.podcastDescription,
          metadata.podcastPublishedAt,
          metadata.loudnessAdjustDb,
          metadata.replaygainTrackGain,
          metadata.replaygainAlbumGain
        )

        if (playbackMedia || !publicPath) {
          db.prepare("UPDATE tracks SET file_path = ? WHERE id = ?").run(
            `/api/media/tracks/${insertResult.lastInsertRowid}`,
            insertResult.lastInsertRowid
          )
        }
        if (playbackMedia) {
          db.prepare("UPDATE tracks SET playback_path = ? WHERE id = ?").run(
            playbackMedia.filePath,
            insertResult.lastInsertRowid
          )
        }
        persistEmbeddedLyrics(Number(insertResult.lastInsertRowid), metadata)

        results.added++
      } catch (error) {
        console.error(`Error processing ${filePath}:`, error)
        results.errors.push(path.basename(filePath))
      }
    }

    return NextResponse.json({
      message: `Scan complete: ${results.added} added, ${results.skipped} skipped`,
      ...results,
    })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("Error scanning directory:", error)
    const message = error instanceof Error ? error.message : "Failed to scan directory"
    const status = message.includes("outside allowed roots") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

function hashPath(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}

async function readMetadataOrFallback(filePath: string): Promise<ExtractedMetadata> {
  try {
    return await extractMetadata(filePath)
  } catch {
    const extension = path.extname(filePath)
    return {
      title: path.basename(filePath, extension),
      artist: "Unknown Artist",
      album: "Unknown Album",
      albumArtist: null,
      genre: null,
      year: null,
      trackNumber: null,
      discNumber: null,
      duration: null,
      bitRate: null,
      sampleRate: null,
      format: extension.slice(1).toUpperCase() || null,
      coverArt: null,
      coverArtMimeType: null,
      lyricsPlain: null,
      lyricsSynced: null,
      contentType: detectLibraryContentType({
        title: path.basename(filePath, extension),
        artist: "Unknown Artist",
        album: "Unknown Album",
        fileName: path.basename(filePath),
      }),
      podcastTitle: null,
      podcastAuthor: null,
      podcastEpisodeNumber: null,
      podcastSeasonNumber: null,
      podcastDescription: null,
      podcastPublishedAt: null,
      loudnessAdjustDb: 0,
      replaygainTrackGain: null,
      replaygainAlbumGain: null,
      ...deriveAudioDescriptors({
        title: path.basename(filePath, extension),
        artist: "Unknown Artist",
        album: "Unknown Album",
        genre: null,
        fileName: path.basename(filePath),
      }),
    }
  }
}

function persistEmbeddedLyrics(trackId: number, metadata: ExtractedMetadata) {
  if (!metadata.lyricsPlain && !metadata.lyricsSynced) return

  db.prepare(`
    UPDATE tracks SET
      lyrics_plain = ?,
      lyrics_synced = ?,
      lyrics_source = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(metadata.lyricsPlain, metadata.lyricsSynced, "embedded", trackId)
}
