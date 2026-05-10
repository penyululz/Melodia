import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import { getYouTubeSubtitleVtt, isValidYouTubeVideoId, YtDlpUnavailableError } from "@/lib/yt-dlp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ videoId: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { videoId } = await params

  if (!isValidYouTubeVideoId(videoId)) {
    return NextResponse.json({ error: "Invalid YouTube video ID" }, { status: 400 })
  }

  try {
    const subtitlePath = await getYouTubeSubtitleVtt(videoId)
    if (!subtitlePath || !fs.existsSync(subtitlePath)) {
      return NextResponse.json({ error: "Subtitles not found" }, { status: 404 })
    }

    return new NextResponse(fs.createReadStream(subtitlePath) as any, {
      headers: {
        "Cache-Control": "public, max-age=86400",
        "Content-Type": "text/vtt; charset=utf-8",
      },
    })
  } catch (error) {
    if (error instanceof YtDlpUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }

    console.error("[subtitles] YouTube subtitle fetch failed:", error)
    return NextResponse.json({ error: "Subtitles not found" }, { status: 404 })
  }
}
