import "server-only"

import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import { getMediaMimeTypeFromPath } from "@/lib/format"

export type YtDownloadQuality = "low" | "normal" | "high"
export type YtDownloadMediaType = "audio" | "video"

export interface YtDlpDownloadResult {
  filePath: string
  fileName: string
  size: number
  mimeType: string
  quality: YtDownloadQuality
  mediaType: YtDownloadMediaType
}

export interface YtDlpStreamResult {
  url: string
  mimeType: string
  quality: YtDownloadQuality
  mediaType: YtDownloadMediaType
}

export interface YtDlpSearchResult {
  videoId: string
  title: string
  artist: string
  duration: number | null
  thumbnailUrl: string | null
  thumbnailUrlHQ: string | null
}

interface YtDlpDownloadOptions {
  force?: boolean
}

interface YtDlpCommand {
  command: string
  prefixArgs: string[]
}

const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{6,32}$/
const MAX_CAPTURED_OUTPUT = 24_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

const AUDIO_FORMATS: Record<YtDownloadQuality, string> = {
  low: "bestaudio[abr<=64]/bestaudio/best",
  normal: "bestaudio[abr<=128]/bestaudio/best",
  high: "bestaudio[abr<=256]/bestaudio/best",
}

const VIDEO_FORMATS: Record<YtDownloadQuality, string> = {
  low: "best[ext=mp4][height<=360][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]",
  normal: "best[ext=mp4][height<=480][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]",
  high: "best[ext=mp4][height<=1080][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]",
}

const MEDIA_MIME_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
}

export class YtDlpUnavailableError extends Error {
  constructor() {
    super(
      "yt-dlp is not installed. Install yt-dlp and make sure it is on PATH, or set YT_DLP_PATH to the executable."
    )
    this.name = "YtDlpUnavailableError"
  }
}

export function isValidYouTubeVideoId(videoId: string): boolean {
  return YOUTUBE_VIDEO_ID_RE.test(videoId)
}

export function getYoutubeDownloadDir(): string {
  return path.join(process.cwd(), "data", "downloads", "youtube")
}

export function getAudioMimeType(filePath: string): string {
  return getMediaMimeType(filePath)
}

export function getMediaMimeType(filePath: string): string {
  return MEDIA_MIME_TYPES[path.extname(filePath).toLowerCase()] || getMediaMimeTypeFromPath(filePath)
}

export async function getYouTubeSubtitleVtt(videoId: string): Promise<string | null> {
  if (!isValidYouTubeVideoId(videoId)) {
    throw new Error("Invalid YouTube video ID")
  }

  const subtitleDir = path.join(getYoutubeDownloadDir(), "subtitles")
  fs.mkdirSync(subtitleDir, { recursive: true })

  const existing = findDownloadedSubtitle(subtitleDir, videoId)
  if (existing) return existing

  const url = `https://www.youtube.com/watch?v=${videoId}`
  const outputTemplate = path.join(subtitleDir, "%(id)s.%(ext)s")

  await runYtDlp([
    "--skip-download",
    "--no-playlist",
    "--no-progress",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    "en.*,en",
    "--sub-format",
    "vtt",
    "--convert-subs",
    "vtt",
    "--output",
    outputTemplate,
    url,
  ]).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    if (/subtitles|no subtitle|requested format/i.test(message)) return null
    throw error
  })

  return findDownloadedSubtitle(subtitleDir, videoId)
}

export async function downloadYouTubeAudio(
  videoId: string,
  quality: YtDownloadQuality = "high"
): Promise<YtDlpDownloadResult> {
  return downloadYouTubeMedia(videoId, quality, "audio")
}

export async function downloadYouTubeMedia(
  videoId: string,
  quality: YtDownloadQuality = "high",
  mediaType: YtDownloadMediaType = "audio",
  options: YtDlpDownloadOptions = {}
): Promise<YtDlpDownloadResult> {
  if (!isValidYouTubeVideoId(videoId)) {
    throw new Error("Invalid YouTube video ID")
  }

  const downloadDir = getDownloadDir(mediaType)
  fs.mkdirSync(downloadDir, { recursive: true })

  const existingFile = findDownloadedFile(downloadDir, videoId)
  if (existingFile && !options.force) {
    return toDownloadResult(existingFile, quality, mediaType)
  }
  if (existingFile && options.force) {
    fs.rmSync(existingFile, { force: true })
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`
  const outputTemplate = path.join(downloadDir, "%(id)s.%(ext)s")
  const ytDlpArgs = [
    "--no-playlist",
    "--no-progress",
    "--format",
    mediaType === "video" ? VIDEO_FORMATS[quality] : AUDIO_FORMATS[quality],
    "--output",
    outputTemplate,
    "--print",
    "after_move:filepath",
    url,
  ]

  const result = await runYtDlp(ytDlpArgs)
  const downloadedFile = pickDownloadedFile(downloadDir, videoId, result.stdout)

  if (!downloadedFile) {
    throw new Error("yt-dlp finished, but the downloaded file could not be found")
  }

  return toDownloadResult(downloadedFile, quality, mediaType)
}

export async function getYouTubeDirectStream(
  videoId: string,
  quality: YtDownloadQuality = "high",
  mediaType: YtDownloadMediaType = "audio"
): Promise<YtDlpStreamResult> {
  if (!isValidYouTubeVideoId(videoId)) {
    throw new Error("Invalid YouTube video ID")
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`
  const format = mediaType === "video" ? VIDEO_FORMATS[quality] : AUDIO_FORMATS[quality]
  const result = await runYtDlp([
    "--no-playlist",
    "--no-progress",
    "--format",
    format,
    "--get-url",
    url,
  ])

  const directUrl = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^https?:\/\//i.test(line))

  if (!directUrl) {
    throw new Error("yt-dlp could not resolve a playable stream URL")
  }

  return {
    url: directUrl,
    mimeType: mediaType === "video" ? "video/mp4" : "audio/webm",
    quality,
    mediaType,
  }
}

export async function searchYouTubeVideos(
  query: string,
  limit = 6
): Promise<YtDlpSearchResult[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 10)
  const result = await runYtDlp([
    "--skip-download",
    "--no-progress",
    "--no-warnings",
    "--socket-timeout",
    "10",
    "--extractor-retries",
    "1",
    "--flat-playlist",
    "--print",
    "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(thumbnail)s",
    `ytsearch${safeLimit}:${trimmedQuery}`,
  ])

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => toYtDlpSearchResult(line))
    .filter((entry): entry is YtDlpSearchResult => Boolean(entry))
}

function getDownloadDir(mediaType: YtDownloadMediaType): string {
  return mediaType === "video"
    ? path.join(getYoutubeDownloadDir(), "videos")
    : getYoutubeDownloadDir()
}

function getYtDlpCommands(): YtDlpCommand[] {
  const configuredPath = process.env.YT_DLP_PATH?.trim().replace(/^"|"$/g, "")
  if (configuredPath) {
    return [{ command: configuredPath, prefixArgs: [] }]
  }

  const commands: YtDlpCommand[] = [
    { command: "yt-dlp", prefixArgs: [] },
  ]

  if (process.platform === "win32") {
    commands.push({ command: "yt-dlp.exe", prefixArgs: [] })
    commands.push({ command: "py", prefixArgs: ["-m", "yt_dlp"] })
    commands.push({ command: "python", prefixArgs: ["-m", "yt_dlp"] })
  } else {
    commands.push({ command: "python3", prefixArgs: ["-m", "yt_dlp"] })
    commands.push({ command: "python", prefixArgs: ["-m", "yt_dlp"] })
  }

  return commands
}

async function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  let lastMissingError: Error | null = null

  for (const candidate of getYtDlpCommands()) {
    try {
      return await spawnYtDlp(candidate, args)
    } catch (error) {
      if (isMissingYtDlpError(error)) {
        lastMissingError = error instanceof Error ? error : new Error(String(error))
        continue
      }

      throw error
    }
  }

  throw lastMissingError || new YtDlpUnavailableError()
}

function spawnYtDlp(
  candidate: YtDlpCommand,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.command, [...candidate.prefixArgs, ...getYtDlpGlobalArgs(), ...args], {
      cwd: process.cwd(),
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      reject(new Error("yt-dlp timed out while downloading this track"))
    }, DOWNLOAD_TIMEOUT_MS)

    child.stdout.on("data", (chunk) => {
      stdout = appendCapturedOutput(stdout, chunk)
    })

    child.stderr.on("data", (chunk) => {
      stderr = appendCapturedOutput(stderr, chunk)
    })

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      if (error.code === "ENOENT") {
        reject(new YtDlpUnavailableError())
        return
      }

      reject(error)
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      if (candidate.prefixArgs.length > 0 && /No module named yt_dlp/i.test(stderr)) {
        reject(new YtDlpUnavailableError())
        return
      }

      reject(new Error(cleanYtDlpError(stderr) || `yt-dlp exited with code ${code}`))
    })
  })
}

function isMissingYtDlpError(error: unknown): boolean {
  return error instanceof YtDlpUnavailableError
}

function getYtDlpGlobalArgs(): string[] {
  const globalArgs: string[] = []
  const cookiesPath = cleanEnvValue(process.env.YT_DLP_COOKIES_PATH)
  const jsRuntime = cleanEnvValue(process.env.YT_DLP_JS_RUNTIME)

  if (cookiesPath) {
    globalArgs.push("--cookies", cookiesPath)
  }

  if (jsRuntime) {
    globalArgs.push("--js-runtimes", jsRuntime)
  }

  return globalArgs
}

function cleanEnvValue(value: string | undefined): string | null {
  const clean = value?.trim().replace(/^"|"$/g, "")
  return clean || null
}

function appendCapturedOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8")
  return next.length > MAX_CAPTURED_OUTPUT ? next.slice(-MAX_CAPTURED_OUTPUT) : next
}

function cleanYtDlpError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const errorLine = [...lines].reverse().find((line) => line.startsWith("ERROR:"))
  return errorLine || lines.slice(-4).join("\n")
}

function pickDownloadedFile(
  downloadDir: string,
  videoId: string,
  stdout: string
): string | null {
  const printedPath = stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .reverse()
    .find((line) => line && fs.existsSync(line))

  return printedPath || findDownloadedFile(downloadDir, videoId)
}

function findDownloadedFile(downloadDir: string, videoId: string): string | null {
  if (!fs.existsSync(downloadDir)) return null

  const fileName = fs
    .readdirSync(downloadDir)
    .find((name) => {
      if (!name.startsWith(`${videoId}.`)) return false
      return !name.endsWith(".part") && !name.endsWith(".ytdl")
    })

  return fileName ? path.join(downloadDir, fileName) : null
}

function findDownloadedSubtitle(subtitleDir: string, videoId: string): string | null {
  if (!fs.existsSync(subtitleDir)) return null

  const fileName = fs
    .readdirSync(subtitleDir)
    .filter((name) => name.startsWith(`${videoId}.`) && name.endsWith(".vtt"))
    .sort((left, right) => scoreSubtitleName(right) - scoreSubtitleName(left))[0]

  return fileName ? path.join(subtitleDir, fileName) : null
}

function scoreSubtitleName(fileName: string): number {
  let score = 0
  if (fileName.includes(".en.")) score += 20
  if (fileName.includes(".en-US.")) score += 30
  if (!fileName.includes(".auto.")) score += 10
  return score
}

function toDownloadResult(
  filePath: string,
  quality: YtDownloadQuality,
  mediaType: YtDownloadMediaType
): YtDlpDownloadResult {
  const stat = fs.statSync(filePath)

  return {
    filePath,
    fileName: path.basename(filePath),
    size: stat.size,
    mimeType: getAudioMimeType(filePath),
    quality,
    mediaType,
  }
}

function toYtDlpSearchResult(line: string): YtDlpSearchResult | null {
  const [videoId, title, durationValue, uploader, thumbnail] = line.split("\t")
  if (!videoId || !isValidYouTubeVideoId(videoId)) return null

  const duration = Number(durationValue)
  const thumbnailUrl = thumbnail && thumbnail !== "NA"
    ? thumbnail
    : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

  return {
    videoId,
    title: title && title !== "NA" ? title : "YouTube video",
    artist: uploader && uploader !== "NA" ? uploader : "YouTube",
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    thumbnailUrl,
    thumbnailUrlHQ: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
  }
}
