import "server-only"

import { NextRequest, NextResponse } from "next/server"
import db, { queries, YTTrack } from "@/lib/db"
import {
  downloadYouTubeMedia,
  getMediaMimeType,
  isValidYouTubeVideoId,
  YtDlpUnavailableError,
  type YtDownloadMediaType,
  type YtDownloadQuality,
} from "@/lib/yt-dlp"
import {
  promoteYouTubeDownloadToLocalTrack,
  removePromotedYouTubeTrack,
} from "@/lib/local-library"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"
import { isAllowedServedMediaPath, safeUnlink } from "@/lib/file-safety"
import fs from "fs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ videoId: string }> }

const DOWNLOAD_QUALITIES = new Set(["low", "normal", "high"])
const DOWNLOAD_MEDIA_TYPES = new Set(["audio", "video"])

// GET - Read-only download status. Use POST to download/cache with yt-dlp.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { videoId } = await params

  if (!isValidYouTubeVideoId(videoId)) {
    return NextResponse.json({ error: "Invalid YouTube video ID" }, { status: 400 })
  }

  const track = queries.getYTTrackByVideoId.get(videoId) as YTTrack | null
  if (!track) {
    return NextResponse.json({ error: "Track not found in library" }, { status: 404 })
  }

  const hasCachedFile = !!track.cached_file_path && fs.existsSync(track.cached_file_path)
  return NextResponse.json({
    videoId,
    isCached: track.is_cached === 1 && hasCachedFile,
    cachedFilePath: hasCachedFile ? track.cached_file_path : null,
    cachedQuality: hasCachedFile ? track.cached_quality : null,
    cachedMediaType: hasCachedFile ? track.cached_media_type : null,
    mimeType: hasCachedFile ? getMediaMimeType(track.cached_file_path!) : null,
    method: "POST /api/youtube/download/[videoId]?quality=high&media=audio",
  })
}

// POST - Download and cache a YouTube track with yt-dlp.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await requireMutationAuth(request)
    const { videoId } = await params
    const { searchParams } = new URL(request.url)
    const quality = normalizeQuality(searchParams.get("quality"))
    const mediaType = normalizeMediaType(searchParams.get("media"))

    if (!isValidYouTubeVideoId(videoId)) {
      return NextResponse.json({ error: "Invalid YouTube video ID" }, { status: 400 })
    }

    const track = queries.getYTTrackByVideoId.get(videoId) as YTTrack | null
    if (!track) {
      return NextResponse.json({ error: "Track not found in library" }, { status: 404 })
    }

    if (
      track.is_cached &&
      track.cached_file_path &&
      fs.existsSync(track.cached_file_path) &&
      cachedFileMatchesMediaType(track.cached_file_path, mediaType) &&
      track.cached_quality === quality &&
      track.cached_media_type === mediaType
    ) {
      const stat = fs.statSync(track.cached_file_path)
      const localTrack = await promoteYouTubeDownloadToLocalTrack(track, track.cached_file_path)

      return NextResponse.json({
        success: true,
        cached: true,
        path: track.cached_file_path,
        size: stat.size,
        mimeType: getMediaMimeType(track.cached_file_path),
        quality,
        mediaType,
        localTrack,
      })
    }

    const previousCachedPath = track.cached_file_path
    if (
      previousCachedPath &&
      isAllowedServedMediaPath(previousCachedPath) &&
      fs.existsSync(previousCachedPath)
    ) {
      fs.unlinkSync(previousCachedPath)
    }

    const download = await downloadYouTubeMedia(videoId, quality, mediaType, { force: true })
    if (
      previousCachedPath &&
      previousCachedPath !== download.filePath &&
      isAllowedServedMediaPath(previousCachedPath) &&
      fs.existsSync(previousCachedPath)
    ) {
      fs.unlinkSync(previousCachedPath)
    }

    queries.updateYTTrackCached.run(download.filePath, quality, mediaType, videoId)
    const updatedTrack = queries.getYTTrackByVideoId.get(videoId) as YTTrack
    const localTrack = await promoteYouTubeDownloadToLocalTrack(updatedTrack, download.filePath)

    return NextResponse.json({
      success: true,
      cached: false,
      path: download.filePath,
      fileName: download.fileName,
      size: download.size,
      mimeType: download.mimeType,
      quality: download.quality,
      mediaType,
      localTrack,
    })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] yt-dlp download error:", error)

    if (error instanceof YtDlpUnavailableError) {
      return NextResponse.json(
        {
          error: error.message,
          setup:
            "Install from https://github.com/yt-dlp/yt-dlp/releases or run python -m pip install -U yt-dlp, then restart the dev server.",
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Download failed" },
      { status: 500 }
    )
  }
}

// DELETE - Remove cached track.
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await requireMutationAuth(request)
    const { videoId } = await params

    if (!isValidYouTubeVideoId(videoId)) {
      return NextResponse.json({ error: "Invalid YouTube video ID" }, { status: 400 })
    }

    const track = queries.getYTTrackByVideoId.get(videoId) as YTTrack | null
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 })
    }

    if (track.cached_file_path && isAllowedServedMediaPath(track.cached_file_path)) {
      safeUnlink(track.cached_file_path)
    }

    removePromotedYouTubeTrack(videoId)

    db.prepare(`
      UPDATE yt_tracks SET
        is_cached = 0,
        cached_file_path = NULL,
        cached_quality = NULL,
        cached_media_type = NULL,
        updated_at = datetime('now')
      WHERE video_id = ?
    `).run(videoId)

    return NextResponse.json({ success: true })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] Delete cache error:", error)
    return NextResponse.json({ error: "Failed to delete cache" }, { status: 500 })
  }
}

function normalizeQuality(value: string | null): YtDownloadQuality {
  return DOWNLOAD_QUALITIES.has(value || "") ? (value as YtDownloadQuality) : "high"
}

function normalizeMediaType(value: string | null): YtDownloadMediaType {
  return DOWNLOAD_MEDIA_TYPES.has(value || "") ? (value as YtDownloadMediaType) : "audio"
}

function cachedFileMatchesMediaType(filePath: string, mediaType: YtDownloadMediaType): boolean {
  const mimeType = getMediaMimeType(filePath)

  if (mediaType === "video") {
    return mimeType.startsWith("video/")
  }

  return mimeType.startsWith("audio/") || mimeType.startsWith("video/")
}
