import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import { getMediaMimeTypeFromPath } from "@/lib/format"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ segments: string[] }> }

const DEMO_MEDIA_DIRS = new Set(["audio", "video", "youtube"])

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { segments } = await params
  const filePath = getSafeDemoPath(segments)

  if (!filePath || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Demo media not found" }, { status: 404 })
  }

  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    return NextResponse.json({ error: "Demo media not found" }, { status: 404 })
  }

  return serveFile(filePath, request.headers.get("range"))
}

function getSafeDemoPath(segments: string[]): string | null {
  const [mediaDir, fileName] = segments

  if (
    segments.length !== 2 ||
    !mediaDir ||
    !fileName ||
    !DEMO_MEDIA_DIRS.has(mediaDir) ||
    fileName !== path.basename(fileName) ||
    fileName.includes("..")
  ) {
    return null
  }

  return path.join(process.cwd(), "data", "demo", mediaDir, fileName)
}

function serveFile(filePath: string, range: string | null): NextResponse {
  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const mimeType = getMediaMimeTypeFromPath(filePath)

  if (range) {
    const [startText, endText] = range.replace(/bytes=/, "").split("-")
    const start = Number.parseInt(startText, 10)
    const end = endText ? Number.parseInt(endText, 10) : fileSize - 1

    if (!Number.isFinite(start) || start < 0 || end < start || end >= fileSize) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileSize}`,
        },
      })
    }

    return new NextResponse(fs.createReadStream(filePath, { start, end }) as any, {
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

  return new NextResponse(fs.createReadStream(filePath) as any, {
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(fileSize),
      "Content-Type": mimeType,
    },
  })
}
