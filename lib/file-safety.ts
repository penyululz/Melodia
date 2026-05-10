import "server-only"

import fs from "fs"
import path from "path"
import type { Track } from "@/lib/db"

export type StorageKind = "upload" | "youtube" | "demo" | "scan" | "public" | "unknown"

const PATH_SEPARATOR_RE = /[;,]/

export function getAppRoot(): string {
  return process.cwd()
}

export function getPublicRoot(): string {
  return path.join(getAppRoot(), "public")
}

export function getPublicMusicRoot(): string {
  return path.join(getPublicRoot(), "music")
}

export function getUploadsRoot(): string {
  return path.join(getPublicMusicRoot(), "uploads")
}

export function getDemoRoot(): string {
  return path.join(getAppRoot(), "data", "demo")
}

export function getYouTubeDownloadRoot(): string {
  return path.join(getAppRoot(), "data", "downloads", "youtube")
}

export function getTranscodedRoot(): string {
  return path.join("data", "transcoded")
}

export function getAllowedScanRoots(): string[] {
  const roots = [getPublicMusicRoot()]
  const configured = [process.env.MUSIC_LIBRARY_PATH, process.env.MUSIC_SCAN_ROOTS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(PATH_SEPARATOR_RE))
    .map((value) => value.trim())
    .filter(Boolean)

  for (const item of configured) {
    roots.push(item)
  }

  return uniquePaths(roots.map((root) => path.resolve(/* turbopackIgnore: true */ root)))
}

export function resolveAllowedScanDirectory(input?: string | null): string {
  const allowedRoots = getAllowedScanRoots()
  const requested = input?.trim()
    ? path.resolve(/* turbopackIgnore: true */ input)
    : getPublicMusicRoot()

  if (!allowedRoots.some((root) => isPathInside(requested, root))) {
    throw new Error(
      `Scan path is outside allowed roots. Configure MUSIC_LIBRARY_PATH or MUSIC_SCAN_ROOTS to allow it.`
    )
  }

  return requested
}

export function isPathInside(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate)
  const resolvedRoot = path.resolve(root)
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

export function toPublicPath(filePath: string): string | null {
  const publicRoot = getPublicRoot()
  if (!isPathInside(filePath, publicRoot)) return null

  const relative = path.relative(publicRoot, filePath).split(path.sep).join("/")
  return `/${relative}`
}

export function isAllowedServedMediaPath(filePath: string): boolean {
  const roots = [
    ...getAllowedScanRoots(),
    getUploadsRoot(),
    getDemoRoot(),
    getYouTubeDownloadRoot(),
    getTranscodedRoot(),
  ]

  return roots.some((root) => isPathInside(filePath, root))
}

export function getOwnedTrackFilePath(track: Pick<Track, "file_path" | "storage_path" | "storage_kind">): string | null {
  const storagePath = track.storage_path ? path.resolve(track.storage_path) : null

  if (storagePath && isOwnedStorageKind(track.storage_kind) && isAllowedServedMediaPath(storagePath)) {
    return storagePath
  }

  if (track.file_path.startsWith("/music/uploads/")) {
    return path.join(getPublicRoot(), track.file_path.slice(1))
  }

  if (track.file_path.startsWith("/api/demo/media/")) {
    const parts = track.file_path.split("/").slice(-2)
    if (parts.length !== 2) return null
    const [mediaDir, fileName] = parts
    return path.join(getDemoRoot(), mediaDir, fileName)
  }

  return null
}

export function getOwnedTrackFilePaths(
  track: Pick<Track, "file_path" | "storage_path" | "storage_kind"> & { playback_path?: string | null }
): string[] {
  const paths = new Set<string>()
  const primary = getOwnedTrackFilePath(track)
  const playbackPath = track.playback_path ? path.resolve(track.playback_path) : null

  if (primary) paths.add(primary)
  if (playbackPath && isAllowedServedMediaPath(playbackPath)) paths.add(playbackPath)

  return [...paths]
}

export function safeUnlink(filePath: string | null): boolean {
  if (!filePath || !fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  return true
}

export function inferStorageKind(filePath: string): StorageKind {
  if (filePath.startsWith("/music/uploads/")) return "upload"
  if (filePath.startsWith("/api/demo/media/")) return "demo"
  if (filePath.startsWith("/api/youtube/stream/")) return "youtube"
  if (filePath.startsWith("/music/")) return "public"
  return "unknown"
}

function isOwnedStorageKind(kind: StorageKind | string | null | undefined): boolean {
  return kind === "upload" || kind === "youtube" || kind === "demo"
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of paths) {
    const key = process.platform === "win32" ? item.toLowerCase() : item
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}
