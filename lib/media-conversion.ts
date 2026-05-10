import "server-only"

import crypto from "crypto"
import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import {
  getFileExtension,
  getMediaMimeTypeFromPath,
  isAudioFile,
  isVideoFile,
} from "@/lib/format"
import { getTranscodedRoot } from "@/lib/file-safety"

export type BrowserPlaybackMedia = {
  filePath: string
  fileName: string
  mimeType: string
  mediaType: "audio" | "video"
}

const BROWSER_NATIVE_AUDIO = new Set([".mp3", ".m4a", ".aac", ".wav", ".wave"])

export async function ensureBrowserPlayableMedia(
  inputPath: string,
  originalName = path.basename(inputPath)
): Promise<BrowserPlaybackMedia | null> {
  if (isVideoFile(originalName)) {
    return transcodeMedia(inputPath, originalName, "video")
  }

  if (isAudioFile(originalName) && !BROWSER_NATIVE_AUDIO.has(getFileExtension(originalName))) {
    return transcodeMedia(inputPath, originalName, "audio")
  }

  return null
}

async function transcodeMedia(
  inputPath: string,
  originalName: string,
  mediaType: "audio" | "video"
): Promise<BrowserPlaybackMedia> {
  const ext = mediaType === "video" ? ".mp4" : ".mp3"
  const outputDir = path.join(getTranscodedRoot(), mediaType)
  fs.mkdirSync(/* turbopackIgnore: true */ outputDir, { recursive: true })

  const outputName = `${hashMediaFile(inputPath, originalName)}${ext}`
  const outputPath = path.join(outputDir, outputName)

  if (!fs.existsSync(/* turbopackIgnore: true */ outputPath)) {
    await runFfmpeg(buildFfmpegArgs(inputPath, outputPath, mediaType))
  }

  return {
    filePath: outputPath,
    fileName: outputName,
    mediaType,
    mimeType: getMediaMimeTypeFromPath(outputPath),
  }
}

function buildFfmpegArgs(inputPath: string, outputPath: string, mediaType: "audio" | "video"): string[] {
  if (mediaType === "video") {
    return [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      outputPath,
    ]
  }

  return [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "libmp3lame",
    "-q:a",
    "0",
    "-id3v2_version",
    "3",
    outputPath,
  ]
}

function runFfmpeg(args: string[]): Promise<void> {
  const command = getFfmpegCommand()

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
    })
    let stderr = ""

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000)
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(cleanFfmpegError(stderr) || `ffmpeg exited with code ${code}`))
    })
  })
}

function getFfmpegCommand(): string {
  return process.env.FFMPEG_PATH?.trim() || getBundledFfmpegPath() || "ffmpeg"
}

function getBundledFfmpegPath(): string | null {
  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
  const candidate = path.join("node_modules", "ffmpeg-static", executableName)

  return fs.existsSync(/* turbopackIgnore: true */ candidate) ? candidate : null
}

function hashMediaFile(filePath: string, originalName: string): string {
  const stat = fs.statSync(/* turbopackIgnore: true */ filePath)
  return crypto
    .createHash("sha256")
    .update(filePath)
    .update(originalName)
    .update(String(stat.size))
    .update(String(Math.round(stat.mtimeMs)))
    .digest("hex")
    .slice(0, 24)
}

function cleanFfmpegError(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6)
    .join("\n")
}
