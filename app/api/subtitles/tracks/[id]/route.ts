import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import { queries, type Track } from "@/lib/db"
import { getPublicRoot, isAllowedServedMediaPath } from "@/lib/file-safety"
import { findSidecarSubtitle, readSubtitleAsWebVtt } from "@/lib/subtitles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const trackId = Number.parseInt(id, 10)

  if (!Number.isFinite(trackId)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 })
  }

  const track = queries.getTrackById.get(trackId) as Track | null
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 })
  }

  const mediaPath = resolveTrackFilePath(track)
  if (
    !mediaPath ||
    !isAllowedServedMediaPath(mediaPath) ||
    !fs.existsSync(/* turbopackIgnore: true */ mediaPath)
  ) {
    return NextResponse.json({ error: "Media file not found" }, { status: 404 })
  }

  const subtitlePath = findSidecarSubtitle(mediaPath)
  if (!subtitlePath || !fs.existsSync(/* turbopackIgnore: true */ subtitlePath)) {
    return NextResponse.json({ error: "Subtitles not found" }, { status: 404 })
  }

  const vtt = readSubtitleAsWebVtt(subtitlePath)
  if (!vtt) {
    return NextResponse.json({ error: "Subtitle format is not readable" }, { status: 415 })
  }

  return new NextResponse(vtt, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/vtt; charset=utf-8",
    },
  })
}

function resolveTrackFilePath(track: Track): string | null {
  if (track.storage_path) return path.resolve(/* turbopackIgnore: true */ track.storage_path)
  if (track.file_path.startsWith("/music/")) {
    return path.join(getPublicRoot(), /* turbopackIgnore: true */ track.file_path.slice(1))
  }
  return null
}
