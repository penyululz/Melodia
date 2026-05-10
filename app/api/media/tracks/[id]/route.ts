import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import db, { queries, type Track } from "@/lib/db"
import { getMediaMimeTypeFromPath } from "@/lib/format"
import { getPublicRoot, isAllowedServedMediaPath } from "@/lib/file-safety"
import { ensureBrowserPlayableMedia } from "@/lib/media-conversion"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const trackId = Number.parseInt(id, 10)

  if (!Number.isFinite(trackId)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 })
  }

  const track = queries.getTrackById.get(trackId) as Track | null
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 })
  }

  const filePath = await resolveTrackFilePath(track)
  if (
    !filePath ||
    !isAllowedServedMediaPath(filePath) ||
    !fs.existsSync(/* turbopackIgnore: true */ filePath)
  ) {
    return NextResponse.json({ error: "Media file not found" }, { status: 404 })
  }

  return serveLocalFile(filePath, request.headers.get("range"))
}

async function resolveTrackFilePath(track: Track): Promise<string | null> {
  if (track.playback_path) return path.resolve(/* turbopackIgnore: true */ track.playback_path)

  if (track.storage_path) {
    const sourcePath = path.resolve(/* turbopackIgnore: true */ track.storage_path)
    const playbackMedia = await ensureBrowserPlayableMedia(sourcePath, track.file_name).catch(() => null)

    if (playbackMedia) {
      db.prepare("UPDATE tracks SET playback_path = ?, file_path = ? WHERE id = ?").run(
        playbackMedia.filePath,
        `/api/media/tracks/${track.id}`,
        track.id
      )
      return path.resolve(/* turbopackIgnore: true */ playbackMedia.filePath)
    }

    return sourcePath
  }

  if (track.file_path.startsWith("/music/")) {
    return path.join(getPublicRoot(), /* turbopackIgnore: true */ track.file_path.slice(1))
  }
  return null
}

function serveLocalFile(filePath: string, range: string | null): NextResponse {
  const stat = fs.statSync(/* turbopackIgnore: true */ filePath)
  const fileSize = stat.size
  const mimeType = getMediaMimeTypeFromPath(filePath)

  if (range) {
    const [startText, endText] = range.replace(/bytes=/, "").split("-")
    const start = Number.parseInt(startText, 10)
    const end = endText ? Number.parseInt(endText, 10) : fileSize - 1

    if (!Number.isFinite(start) || start < 0 || end < start || end >= fileSize) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      })
    }

    return new NextResponse(fs.createReadStream(/* turbopackIgnore: true */ filePath, { start, end }) as any, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Type": mimeType,
      },
    })
  }

  return new NextResponse(fs.createReadStream(/* turbopackIgnore: true */ filePath) as any, {
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(fileSize),
      "Content-Type": mimeType,
    },
  })
}
