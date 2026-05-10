import { NextRequest, NextResponse } from "next/server"
import db, { queries, type Track, type YTTrack } from "@/lib/db"
import {
  detectLibraryContentType,
  deriveAudioDescriptors,
  extractMetadata,
  resolveCoverArt,
  type ExtractedMetadata,
} from "@/lib/metadata"
import { authErrorResponse, getSessionOrDemo, requireMutationAuth } from "@/lib/auth-policy"
import { ensureBrowserPlayableMedia } from "@/lib/media-conversion"
import {
  buildTasteProfile,
  rankLocalSearchResults,
  recordSearchSignal,
} from "@/lib/recommendation-engine"
import {
  parseMediaUpload,
  sanitizeFileName,
  UploadLimitError,
  type ParsedUploadFile,
} from "@/lib/multipart-upload"
import { formatBytes, getUploadLimits } from "@/lib/upload-limits"
import fs from "fs"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const artist = searchParams.get("artist")
  const album = searchParams.get("album")
  const genre = searchParams.get("genre")
  const favorites = searchParams.get("favorites")
  const recent = searchParams.get("recent")
  const mostPlayed = searchParams.get("mostPlayed")
  const search = searchParams.get("search")
  const contentType = searchParams.get("contentType")

  try {
    let tracks: Track[]

    if (search) {
      const term = `%${search}%`
      tracks = queries.searchTracks.all(term, term, term, term, term, term, term, term, term, term) as Track[]
      const user = await getSessionOrDemo(request)
      const ytTracks = db.prepare("SELECT * FROM yt_tracks ORDER BY created_at DESC").all() as YTTrack[]
      const profile = buildTasteProfile(user?.id ?? null, tracks, ytTracks, request)
      tracks = rankLocalSearchResults(tracks, search, profile)
      recordSearchSignal(user?.id ?? null, search, "local", tracks.length, request)
    } else if (artist) {
      tracks = queries.getTracksByArtist.all(artist) as Track[]
    } else if (album) {
      tracks = queries.getTracksByAlbum.all(album) as Track[]
    } else if (genre) {
      tracks = queries.getTracksByGenre.all(genre) as Track[]
    } else if (favorites === "true") {
      tracks = queries.getFavoriteTracks.all() as Track[]
    } else if (recent === "true") {
      tracks = queries.getRecentTracks.all() as Track[]
    } else if (mostPlayed === "true") {
      tracks = queries.getMostPlayedTracks.all() as Track[]
    } else {
      tracks = queries.getAllTracks.all() as Track[]
    }

    if (contentType === "music" || contentType === "podcast") {
      tracks = tracks.filter((track) => (track.content_type || "music") === contentType)
    }

    return NextResponse.json({ tracks: tracks.map(toClientTrack) })
  } catch (error) {
    console.error("Error fetching tracks:", error)
    return NextResponse.json(
      { error: "Failed to fetch tracks" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const results = {
    success: [] as Track[],
    sidecars: [] as { fileName: string; path: string }[],
    errors: [] as string[],
  }

  try {
    await requireMutationAuth(request)
    const upload = await parseMediaUpload(request)
    results.errors.push(...upload.errors)
    const files = upload.files

    if (files.length === 0) {
      return NextResponse.json(
        {
          message: results.errors.length > 0 ? "No valid files were uploaded" : "No files were uploaded",
          results,
        },
        { status: results.errors.length > 0 ? 400 : 400 }
      )
    }

    const uploadDir = path.join(process.cwd(), "public", "music", "uploads")
    fs.mkdirSync(uploadDir, { recursive: true })

    for (const file of files) {
      const fileName = getUniqueFileName(uploadDir, file.originalName)
      const absolutePath = path.join(uploadDir, fileName)
      const relativePath = `/music/uploads/${fileName}`

      try {
        moveUploadedFile(file, absolutePath)

        if (file.kind === "subtitle") {
          results.sidecars.push({ fileName, path: relativePath })
          continue
        }

        const metadata = await readMetadataOrFallback(absolutePath)
        const coverArtPath = await resolveCoverArt(metadata, {
          allowOnlineLookup: request.headers.get("x-melodia-online-artwork") === "true",
        })

        const stats = fs.statSync(absolutePath)
        const playbackMedia = await ensureBrowserPlayableMedia(absolutePath, fileName)
        const result = queries.insertTrack.run(
          metadata.title,
          metadata.artist,
          metadata.album,
          metadata.albumArtist,
          metadata.genre,
          metadata.year,
          metadata.trackNumber,
          metadata.discNumber,
          metadata.duration,
          relativePath,
          fileName,
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

        const track = queries.getTrackById.get((result as any).lastInsertRowid) as Track | undefined
        if (track) {
          persistEmbeddedLyrics(track.id, metadata)
          db.prepare(`
            UPDATE tracks SET
              storage_kind = 'upload',
              storage_path = ?,
              playback_path = ?,
              file_path = ?
            WHERE id = ?
          `).run(
            absolutePath,
            playbackMedia?.filePath || null,
            playbackMedia ? `/api/media/tracks/${track.id}` : relativePath,
            track.id
          )
          const updatedTrack = queries.getTrackById.get(track.id) as Track | undefined
          results.success.push(toClientTrack(updatedTrack || track))
        }
      } catch (error) {
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath)
        }

        console.error(`Error uploading ${file.originalName}:`, error)
        results.errors.push(`${file.originalName}: upload failed`)
      } finally {
        fs.rmSync(file.tempPath, { force: true })
      }
    }

    const status = results.success.length > 0 || results.sidecars.length > 0 ? 201 : 400
    return NextResponse.json(
      {
        message: `Upload complete: ${results.success.length} tracks added, ${results.sidecars.length} subtitle files added, ${results.errors.length} failed`,
        results,
      },
      { status }
    )
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    if (error instanceof UploadLimitError) {
      return NextResponse.json(
        { error: error.message, results },
        { status: error.status }
      )
    }
    console.error("Error handling upload:", error)
    return NextResponse.json(
      { error: "Failed to upload files", results },
      { status: 500 }
    )
  }
}

function toClientTrack(track: Track) {
  return {
    ...track,
    source: "local" as const,
  }
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

function getUniqueFileName(uploadDir: string, originalName: string): string {
  const parsed = path.parse(sanitizeFileName(originalName))
  let candidate = `${parsed.name}${parsed.ext}`
  let counter = 1

  while (fs.existsSync(path.join(uploadDir, candidate))) {
    candidate = `${parsed.name}-${counter}${parsed.ext}`
    counter++
  }

  return candidate
}

function moveUploadedFile(file: ParsedUploadFile, absolutePath: string) {
  const { maxFileBytes } = getUploadLimits()
  if (file.size > maxFileBytes) {
    throw new Error(`File is larger than ${formatBytes(maxFileBytes)}`)
  }

  try {
    fs.renameSync(file.tempPath, absolutePath)
  } catch (error: any) {
    if (error?.code !== "EXDEV") throw error
    fs.copyFileSync(file.tempPath, absolutePath)
    fs.rmSync(file.tempPath, { force: true })
  }
}
