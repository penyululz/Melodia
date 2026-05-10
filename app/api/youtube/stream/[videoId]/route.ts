import { NextRequest, NextResponse } from "next/server"
import { queries, YTTrack } from "@/lib/db"
import {
  downloadYouTubeMedia,
  getMediaMimeType,
  getYouTubeDirectStream,
  YtDlpUnavailableError,
  type YtDownloadMediaType,
  type YtDownloadQuality,
} from "@/lib/yt-dlp"
import { isAllowedServedMediaPath } from "@/lib/file-safety"
import fs from "fs"

type RouteParams = { params: Promise<{ videoId: string }> }

// Invidious instances - prioritized by reliability and speed
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.private.coffee",
  "https://invidious.protokolla.fi",
  "https://iv.datura.network",
  "https://invidious.fdn.fr",
  "https://yewtu.be",
]

// Piped instances as fallback
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
]

// Quality bitrate mapping
const QUALITY_BITRATES: Record<string, number> = {
  low: 48,
  normal: 128,
  high: 256,
}

const STREAM_QUALITIES = new Set(["low", "normal", "high"])
const STREAM_MODES = new Set(["audio", "video"])

interface StreamFormat {
  url: string
  bitrate: number
  mimeType: string
  quality: string
  contentLength?: string
  isVideo?: boolean
}

// GET - Stream audio/video for a YouTube video
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { videoId } = await params
    const range = request.headers.get("Range")
    const { searchParams } = new URL(request.url)
    const quality = normalizeQuality(searchParams.get("quality"))
    const mode = normalizeMode(searchParams.get("mode"))
    const targetBitrate = QUALITY_BITRATES[quality] || 256

    const ytTrack = queries.getYTTrackByVideoId?.get(videoId) as YTTrack | null
    if (ytTrack?.is_cached && ytTrack.cached_file_path) {
      const filePath = ytTrack.cached_file_path
      if (isAllowedServedMediaPath(filePath) && fs.existsSync(filePath)) {
        const cachedMimeType = getMediaMimeType(filePath)
        if (mode === "audio" || cachedMimeType.startsWith("video/")) {
          return serveLocalFile(filePath, range)
        }
      }
    }

    // Prefer native yt-dlp when cookies are configured. Public proxy instances are useful
    // for demos, but production VPS IPs are often challenged by YouTube and slow to fail.
    const preferYtDlp = shouldPreferYtDlpStream()
    let stream = preferYtDlp
      ? await getYtDlpStream(videoId, quality, mode).catch((error) => {
          console.warn("[v0] yt-dlp direct stream failed, trying public stream providers:", error)
          return null
        })
      : null

    if (!stream) {
      stream = mode === "video"
        ? await getBestVideoStream(videoId, targetBitrate)
        : await getBestAudioStream(videoId, targetBitrate)
    }

    if (!stream && !preferYtDlp) {
      stream = await getYtDlpStream(videoId, quality, mode).catch((error) => {
          console.warn("[v0] yt-dlp direct stream fallback failed, trying local download:", error)
          return null
        })
    }
    
    if (!stream) {
      return await serveDownloadedFallback(videoId, quality, mode, range, ytTrack)
    }

    // Proxy the stream with low latency headers
    const proxyHeaders: HeadersInit = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Encoding": "identity",
      "Connection": "keep-alive",
    }

    if (range) {
      proxyHeaders["Range"] = range
    }

    const response = await fetch(stream.url, {
      headers: proxyHeaders,
      // @ts-ignore - signal timeout for faster fallback
      signal: AbortSignal.timeout(15000),
    }).catch((error) => {
      console.warn("[v0] YouTube stream proxy fetch failed, trying local download:", error)
      return null
    })

    if (!response || (!response.ok && !response.status.toString().startsWith("2"))) {
      console.warn("[v0] YouTube stream proxy returned an unusable response, trying local download:", response?.status)
      return await serveDownloadedFallback(videoId, quality, mode, range, ytTrack)
    }

    // Build response headers
    const responseHeaders = new Headers({
      "Content-Type": stream.mimeType || (mode === "video" ? "video/mp4" : "audio/webm"),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "X-Stream-Quality": `${stream.bitrate}kbps`,
    })

    const contentLength = response.headers.get("Content-Length")
    const contentRange = response.headers.get("Content-Range")
    
    if (contentLength) responseHeaders.set("Content-Length", contentLength)
    if (contentRange) responseHeaders.set("Content-Range", contentRange)

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error("[v0] YouTube stream error:", error)
    if (error instanceof YtDlpUnavailableError) {
      return NextResponse.json(
        {
          error: error.message,
          setup:
            "Install yt-dlp on the server and restart Melodia. Ubuntu: python3 -m pip install -U yt-dlp or apt install yt-dlp.",
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { error: "Failed to stream" }, 
      { status: 500 }
    )
  }
}

async function serveDownloadedFallback(
  videoId: string,
  quality: YtDownloadQuality,
  mode: YtDownloadMediaType,
  range: string | null,
  ytTrack: YTTrack | null
): Promise<NextResponse> {
  const download = await downloadYouTubeMedia(videoId, quality, mode)
  if (ytTrack) {
    queries.updateYTTrackCached.run(download.filePath, quality, mode, videoId)
  }
  return serveLocalFile(download.filePath, range)
}

async function getYtDlpStream(
  videoId: string,
  quality: YtDownloadQuality,
  mode: YtDownloadMediaType
): Promise<StreamFormat | null> {
  const stream = await getYouTubeDirectStream(videoId, quality, mode)
  return {
    url: stream.url,
    bitrate: QUALITY_BITRATES[quality] || 256,
    mimeType: stream.mimeType,
    quality,
    isVideo: mode === "video",
  }
}

function normalizeQuality(value: string | null): YtDownloadQuality {
  return STREAM_QUALITIES.has(value || "") ? (value as YtDownloadQuality) : "high"
}

function normalizeMode(value: string | null): YtDownloadMediaType {
  return STREAM_MODES.has(value || "") ? (value as YtDownloadMediaType) : "audio"
}

function shouldPreferYtDlpStream(): boolean {
  return Boolean(
    process.env.YT_DLP_STREAM_FIRST === "1" ||
      process.env.YT_DLP_COOKIES_PATH?.trim()
  )
}

function serveLocalFile(filePath: string, range: string | null): NextResponse {
  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  const mimeType = getMediaMimeType(filePath)
  
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-")
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
    const chunkSize = end - start + 1
    
    const fileStream = fs.createReadStream(filePath, { start, end })
    
    return new NextResponse(fileStream as any, {
      status: 206,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": chunkSize.toString(),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000",
      },
    })
  }
  
  const fileStream = fs.createReadStream(filePath)
  return new NextResponse(fileStream as any, {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": fileSize.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000",
    },
  })
}

/**
 * Get the best audio stream based on target bitrate
 */
async function getBestAudioStream(videoId: string, targetBitrate: number = 256): Promise<StreamFormat | null> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const result = await getInvidiousStream(instance, videoId, "audio", targetBitrate)
      if (result) return result
    } catch { continue }
  }

  for (const instance of PIPED_INSTANCES) {
    try {
      const result = await getPipedStream(instance, videoId, "audio", targetBitrate)
      if (result) return result
    } catch { continue }
  }

  return null
}

/**
 * Get video stream with audio
 */
async function getBestVideoStream(videoId: string, targetBitrate: number = 256): Promise<StreamFormat | null> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const result = await getInvidiousStream(instance, videoId, "video", targetBitrate)
      if (result) return result
    } catch { continue }
  }

  for (const instance of PIPED_INSTANCES) {
    try {
      const result = await getPipedStream(instance, videoId, "video", targetBitrate)
      if (result) return result
    } catch { continue }
  }

  return null
}

async function getInvidiousStream(
  instance: string, 
  videoId: string, 
  mode: "audio" | "video",
  targetBitrate: number
): Promise<StreamFormat | null> {
  const response = await fetch(`${instance}/api/v1/videos/${videoId}`, {
    headers: { 
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    // @ts-ignore
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) return null

  const data = await response.json()
  
  if (mode === "audio") {
    // Get audio-only adaptive formats
    const audioFormats = data.adaptiveFormats?.filter(
      (f: any) => f.type?.startsWith("audio/") && f.url
    )

    if (!audioFormats?.length) return null

    // Find best match for target bitrate
    const sorted = audioFormats.sort((a: any, b: any) => {
      const aBitrate = Math.round((a.bitrate || 0) / 1000)
      const bBitrate = Math.round((b.bitrate || 0) / 1000)
      
      // Prefer opus codec
      const aIsOpus = a.type?.includes("opus") ? 10 : 0
      const bIsOpus = b.type?.includes("opus") ? 10 : 0
      
      // Find closest to target without going over (if possible)
      const aScore = aBitrate <= targetBitrate ? aBitrate + aIsOpus : aBitrate - 1000
      const bScore = bBitrate <= targetBitrate ? bBitrate + bIsOpus : bBitrate - 1000
      
      return bScore - aScore
    })

    const best = sorted[0]
    
    return {
      url: best.url,
      bitrate: Math.round((best.bitrate || 0) / 1000),
      mimeType: best.type?.split(";")[0] || "audio/webm",
      quality: `${Math.round((best.bitrate || 0) / 1000)}kbps`,
      contentLength: best.contentLength,
    }
  } else {
    // Get video with audio (formatStreams has combined a/v)
    const videoFormats = data.formatStreams?.filter(
      (f: any) => f.url && f.type?.startsWith("video/")
    )

    if (!videoFormats?.length) return null

    // Sort by quality - prefer 720p or 1080p
    const sorted = videoFormats.sort((a: any, b: any) => {
      const aQuality = parseInt(a.qualityLabel) || 0
      const bQuality = parseInt(b.qualityLabel) || 0
      
      // Prefer 720p-1080p range
      const aScore = aQuality >= 720 && aQuality <= 1080 ? aQuality + 1000 : aQuality
      const bScore = bQuality >= 720 && bQuality <= 1080 ? bQuality + 1000 : bQuality
      
      return bScore - aScore
    })

    const best = sorted[0]
    
    return {
      url: best.url,
      bitrate: Math.round((best.bitrate || 0) / 1000),
      mimeType: best.type?.split(";")[0] || "video/mp4",
      quality: best.qualityLabel || "720p",
      isVideo: true,
    }
  }
}

async function getPipedStream(
  instance: string, 
  videoId: string, 
  mode: "audio" | "video",
  targetBitrate: number
): Promise<StreamFormat | null> {
  const response = await fetch(`${instance}/streams/${videoId}`, {
    headers: { 
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    // @ts-ignore
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) return null

  const data = await response.json()
  
  if (mode === "audio") {
    const audioStreams = data.audioStreams?.filter(
      (s: any) => s.url && s.mimeType?.startsWith("audio/")
    )

    if (!audioStreams?.length) return null

    const sorted = audioStreams.sort((a: any, b: any) => {
      const aBitrate = Math.round((a.bitrate || 0) / 1000)
      const bBitrate = Math.round((b.bitrate || 0) / 1000)
      
      const aIsOpus = a.codec === "opus" ? 10 : 0
      const bIsOpus = b.codec === "opus" ? 10 : 0
      
      const aScore = aBitrate <= targetBitrate ? aBitrate + aIsOpus : aBitrate - 1000
      const bScore = bBitrate <= targetBitrate ? bBitrate + bIsOpus : bBitrate - 1000
      
      return bScore - aScore
    })

    const best = sorted[0]
    
    return {
      url: best.url,
      bitrate: Math.round((best.bitrate || 0) / 1000),
      mimeType: best.mimeType || "audio/webm",
      quality: best.quality || `${Math.round((best.bitrate || 0) / 1000)}kbps`,
    }
  } else {
    const videoStreams = data.videoStreams?.filter(
      (s: any) => s.url && s.mimeType?.startsWith("video/") && s.videoOnly === false
    )

    if (!videoStreams?.length) return null

    const sorted = videoStreams.sort((a: any, b: any) => {
      const aQuality = parseInt(a.quality) || 0
      const bQuality = parseInt(b.quality) || 0
      
      const aScore = aQuality >= 720 && aQuality <= 1080 ? aQuality + 1000 : aQuality
      const bScore = bQuality >= 720 && bQuality <= 1080 ? bQuality + 1000 : bQuality
      
      return bScore - aScore
    })

    const best = sorted[0]
    
    return {
      url: best.url,
      bitrate: Math.round((best.bitrate || 0) / 1000),
      mimeType: best.mimeType || "video/mp4",
      quality: best.quality || "720p",
      isVideo: true,
    }
  }
}
